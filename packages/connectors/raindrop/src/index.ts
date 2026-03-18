import { z } from "zod";
import { RateLimiter } from "@trove/shared";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

const RaindropConfigSchema = z.object({
  /** Env var name for the Raindrop.io API token (default: RAINDROP_TOKEN) */
  token_env: z.string().default("RAINDROP_TOKEN"),
  /** Optional: only index specific collection IDs */
  collection_ids: z.array(z.number()).optional(),
});

const API_BASE = "https://api.raindrop.io/rest/v1";
const PER_PAGE = 50;

interface RaindropBookmark {
  _id: number;
  title: string;
  excerpt: string;
  link: string;
  domain: string;
  created: string;
  type: string; // "link" | "article" | "image" | "video" | "document" | "audio"
  tags: string[];
  highlights: string[];
  collection: { $id: number };
}

interface RaindropListResponse {
  result: boolean;
  items: RaindropBookmark[];
  count: number;
}

interface RaindropCollection {
  _id: number;
  title: string;
  count: number;
}

interface RaindropCollectionsResponse {
  result: boolean;
  items: RaindropCollection[];
}

const limiter = new RateLimiter(5);

/**
 * Fetch all bookmarks from a collection (or all, collectionId=0).
 */
async function fetchBookmarks(
  collectionId: number,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<RaindropBookmark[]> {
  const bookmarks: RaindropBookmark[] = [];
  let page = 0;

  while (true) {
    if (signal?.aborted) break;

    const url = `${API_BASE}/raindrops/${collectionId}?perpage=${PER_PAGE}&page=${page}`;
    await limiter.wait();
    const response = await fetch(url, { headers, signal });

    if (!response.ok) {
      await response.text().catch(() => { /* drain body */ });
      throw new Error(`Raindrop API error (${response.status})`);
    }

    const data = (await response.json()) as RaindropListResponse;
    bookmarks.push(...data.items);

    // No more pages when we get fewer items than requested
    if (data.items.length < PER_PAGE) break;
    page++;
  }

  return bookmarks;
}

/**
 * Fetch all collections to resolve names.
 */
async function fetchCollections(
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Map<number, string>> {
  const map = new Map<number, string>();

  try {
    await limiter.wait();
    const response = await fetch(`${API_BASE}/collections`, { headers, signal });
    if (!response.ok) return map;

    const data = (await response.json()) as RaindropCollectionsResponse;
    for (const col of data.items) {
      map.set(col._id, col.title);
    }
  } catch {
    // Non-fatal: we just won't have collection names in tags
  }

  return map;
}

const connector: Connector = {
  manifest: {
    name: "raindrop",
    version: "0.1.0",
    description: "Index Raindrop.io bookmarks with tags, highlights and metadata",
    configSchema: RaindropConfigSchema,
  },

  async validate(config) {
    const result = RaindropConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    const parsed = result.data;
    const token = process.env[parsed.token_env];
    if (!token) {
      return {
        valid: false,
        errors: [`Environment variable ${parsed.token_env} is not set`],
      };
    }
    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = RaindropConfigSchema.parse(config);
    const token = process.env[parsed.token_env];

    if (!token) {
      throw new Error(`Environment variable ${parsed.token_env} is not set`);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    // Fetch collection names for richer tags
    const collectionNames = await fetchCollections(headers, options.signal);

    // Determine which collections to index
    const collectionIds = parsed.collection_ids ?? [0]; // 0 = all bookmarks

    const allBookmarks: RaindropBookmark[] = [];
    for (const colId of collectionIds) {
      if (options.signal?.aborted) return;
      const bookmarks = await fetchBookmarks(colId, headers, options.signal);
      allBookmarks.push(...bookmarks);
    }

    // Deduplicate by _id (a bookmark can appear in multiple collection fetches)
    const seen = new Set<number>();
    const uniqueBookmarks: RaindropBookmark[] = [];
    for (const bm of allBookmarks) {
      if (!seen.has(bm._id)) {
        seen.add(bm._id);
        uniqueBookmarks.push(bm);
      }
    }

    let indexed = 0;

    for (const bm of uniqueBookmarks) {
      if (options.signal?.aborted) return;

      // Build tags: bookmark tags + collection name
      const tags = [...(bm.tags ?? [])];
      const collectionName = collectionNames.get(bm.collection.$id);
      if (collectionName) {
        tags.push(collectionName);
      }

      // Build content from excerpt + highlights
      const contentParts: string[] = [];
      if (bm.excerpt) contentParts.push(bm.excerpt);
      if (bm.highlights?.length) {
        contentParts.push(...bm.highlights);
      }
      const content = contentParts.length > 0 ? contentParts.join("\n\n") : undefined;

      const item: ContentItem = {
        id: `raindrop:${bm._id}`,
        source: "raindrop",
        type: "bookmark",
        title: bm.title,
        description: bm.excerpt || `Bookmark: ${bm.title}`,
        tags,
        uri: bm.link,
        metadata: {
          domain: bm.domain,
          created: bm.created,
          type: bm.type,
          highlights: bm.highlights,
        },
        indexedAt: new Date().toISOString(),
        content,
      };

      indexed++;
      options.onProgress?.(indexed, uniqueBookmarks.length);
      yield item;
    }
  },
};

export default connector;

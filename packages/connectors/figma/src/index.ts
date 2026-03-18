import { z } from "zod";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

const FigmaConfigSchema = z.object({
  /** Env var name for the Figma personal access token (default: FIGMA_TOKEN) */
  token_env: z.string().default("FIGMA_TOKEN"),
  /** Optional team IDs to scope indexing to specific teams */
  team_ids: z.array(z.string()).optional(),
  /** Whether to index individual components within files (default: true) */
  include_components: z.boolean().default(true),
});

const FIGMA_API_BASE = "https://api.figma.com/v1";

/** Minimum interval between requests to respect 30 req/min rate limit */
const RATE_LIMIT_INTERVAL_MS = 2_000;

interface FigmaUser {
  id: string;
  handle: string;
  email: string;
}

interface FigmaFileListEntry {
  key: string;
  name: string;
  thumbnail_url: string;
  last_modified: string;
}

interface FigmaFileListResponse {
  files: FigmaFileListEntry[];
  next_page_token?: string;
}

interface FigmaFileDetail {
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  version: string;
  editorType: string;
  document: FigmaNode;
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  description?: string;
  children?: FigmaNode[];
}

interface FigmaTeamProjectsResponse {
  projects: Array<{ id: string; name: string }>;
}

interface FigmaProjectFilesResponse {
  files: FigmaFileListEntry[];
}

/**
 * Simple rate limiter: tracks the last request time and waits if needed.
 */
class RateLimiter {
  private lastRequestTime = 0;

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < RATE_LIMIT_INTERVAL_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_INTERVAL_MS - elapsed),
      );
    }
    this.lastRequestTime = Date.now();
  }
}

/**
 * Make a rate-limited request to the Figma API.
 */
async function figmaFetch<T>(
  path: string,
  token: string,
  rateLimiter: RateLimiter,
  signal?: AbortSignal,
): Promise<T> {
  await rateLimiter.wait();

  const response = await fetch(`${FIGMA_API_BASE}${path}`, {
    headers: {
      "X-Figma-Token": token,
      "User-Agent": "Trove/0.1.0",
    },
    signal,
  });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        "Figma API rate limit exceeded or invalid token. Check your FIGMA_TOKEN.",
      );
    }
    throw new Error(
      `Figma API error (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as T;
}

/**
 * Extract tags from a file: lowercase words from name + page names.
 */
function extractTags(fileName: string, pageNames: string[]): string[] {
  const tags = new Set<string>();
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .split(/[\s\-_/.,]+/)
      .filter((t) => t.length > 1);

  for (const t of tokenize(fileName)) tags.add(t);
  for (const page of pageNames) {
    for (const t of tokenize(page)) tags.add(t);
  }
  tags.add("figma");
  tags.add("design");
  return [...tags];
}

/**
 * Recursively collect page names and component nodes from a Figma document tree.
 */
function collectNodes(node: FigmaNode): {
  pageNames: string[];
  components: FigmaNode[];
} {
  const pageNames: string[] = [];
  const components: FigmaNode[] = [];

  function walk(n: FigmaNode): void {
    if (n.type === "CANVAS") {
      pageNames.push(n.name);
    }
    if (n.type === "COMPONENT" || n.type === "COMPONENT_SET") {
      components.push(n);
    }
    if (n.children) {
      for (const child of n.children) walk(child);
    }
  }

  walk(node);
  return { pageNames, components };
}

/**
 * Fetch all recent files for the authenticated user (paginated).
 */
async function fetchRecentFiles(
  token: string,
  rateLimiter: RateLimiter,
  signal?: AbortSignal,
): Promise<FigmaFileListEntry[]> {
  const allFiles: FigmaFileListEntry[] = [];
  let pageToken: string | undefined;

  do {
    if (signal?.aborted) break;

    const params = new URLSearchParams({ page_size: "100" });
    if (pageToken) params.set("page_token", pageToken);

    const data = await figmaFetch<FigmaFileListResponse>(
      `/me/files?${params.toString()}`,
      token,
      rateLimiter,
      signal,
    );

    allFiles.push(...data.files);
    pageToken = data.next_page_token;
  } while (pageToken);

  return allFiles;
}

/**
 * Fetch files from specific team IDs via team projects endpoint.
 */
async function fetchTeamFiles(
  teamIds: string[],
  token: string,
  rateLimiter: RateLimiter,
  signal?: AbortSignal,
): Promise<FigmaFileListEntry[]> {
  const allFiles: FigmaFileListEntry[] = [];
  const seen = new Set<string>();

  for (const teamId of teamIds) {
    if (signal?.aborted) break;

    const projects = await figmaFetch<FigmaTeamProjectsResponse>(
      `/teams/${encodeURIComponent(teamId)}/projects`,
      token,
      rateLimiter,
      signal,
    );

    for (const project of projects.projects) {
      if (signal?.aborted) break;

      const projectFiles = await figmaFetch<FigmaProjectFilesResponse>(
        `/projects/${encodeURIComponent(project.id)}/files`,
        token,
        rateLimiter,
        signal,
      );

      for (const file of projectFiles.files) {
        if (!seen.has(file.key)) {
          seen.add(file.key);
          allFiles.push(file);
        }
      }
    }
  }

  return allFiles;
}

const connector: Connector = {
  manifest: {
    name: "figma",
    version: "0.1.0",
    description: "Index Figma design files and components via the REST API",
    configSchema: FigmaConfigSchema,
  },

  async validate(config) {
    const result = FigmaConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      };
    }

    const parsed = result.data;
    const token = process.env[parsed.token_env];
    if (!token) {
      return {
        valid: false,
        errors: [
          `Environment variable ${parsed.token_env} is not set. A Figma personal access token is required.`,
        ],
      };
    }

    // Verify token works by hitting /v1/me
    try {
      const rateLimiter = new RateLimiter();
      await figmaFetch<FigmaUser>("/me", token, rateLimiter);
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        errors: [
          `Failed to authenticate with Figma API: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = FigmaConfigSchema.parse(config);
    const token = process.env[parsed.token_env];
    if (!token) {
      throw new Error(
        `Environment variable ${parsed.token_env} is not set. A Figma personal access token is required.`,
      );
    }

    const rateLimiter = new RateLimiter();

    // Fetch file list — either from teams or from recent files
    const files =
      parsed.team_ids && parsed.team_ids.length > 0
        ? await fetchTeamFiles(
            parsed.team_ids,
            token,
            rateLimiter,
            options.signal,
          )
        : await fetchRecentFiles(token, rateLimiter, options.signal);

    let indexed = 0;

    for (const file of files) {
      if (options.signal?.aborted) return;

      // Respect since filter
      if (options.since && new Date(file.last_modified) < options.since) {
        continue;
      }

      // Fetch file details for pages/components
      let detail: FigmaFileDetail | undefined;
      try {
        detail = await figmaFetch<FigmaFileDetail>(
          `/files/${encodeURIComponent(file.key)}`,
          token,
          rateLimiter,
          options.signal,
        );
      } catch {
        // If we can't fetch details, still yield a basic item
      }

      const { pageNames, components } = detail
        ? collectNodes(detail.document)
        : { pageNames: [] as string[], components: [] as FigmaNode[] };

      const contentParts: string[] = [];
      if (pageNames.length > 0) {
        contentParts.push(`Pages: ${pageNames.join(", ")}`);
      }
      if (components.length > 0) {
        const componentNames = components.map((c) => c.name);
        contentParts.push(`Components: ${componentNames.join(", ")}`);
      }

      const tags = extractTags(file.name, pageNames);
      if (components.length > 0) tags.push("components");

      const fileItem: ContentItem = {
        id: `figma:${file.key}`,
        source: "figma",
        type: "document",
        title: file.name,
        description:
          detail?.name
            ? `Figma design file: ${detail.name}`
            : `Figma design file: ${file.name}`,
        tags,
        uri: `https://figma.com/file/${file.key}`,
        metadata: {
          lastModified: detail?.lastModified ?? file.last_modified,
          thumbnailUrl: detail?.thumbnailUrl ?? file.thumbnail_url,
          editorType: detail?.editorType ?? "unknown",
          version: detail?.version,
          pageCount: pageNames.length,
          componentCount: components.length,
        },
        indexedAt: new Date().toISOString(),
        content:
          contentParts.length > 0 ? contentParts.join("\n") : undefined,
      };

      indexed++;
      options.onProgress?.(indexed, files.length);
      yield fileItem;

      // Yield individual component items if enabled
      if (parsed.include_components && components.length > 0) {
        for (const comp of components) {
          if (options.signal?.aborted) return;

          const compTags = extractTags(comp.name, []);
          if (comp.type === "COMPONENT_SET") compTags.push("component-set");
          else compTags.push("component");

          const compItem: ContentItem = {
            id: `figma:${file.key}:${comp.id}`,
            source: "figma",
            type: "document",
            title: comp.name,
            description:
              comp.description ||
              `Figma component in ${file.name}`,
            tags: compTags,
            uri: `https://figma.com/file/${file.key}?node-id=${encodeURIComponent(comp.id)}`,
            metadata: {
              lastModified: detail?.lastModified ?? file.last_modified,
              parentFile: file.name,
              parentFileKey: file.key,
              nodeType: comp.type,
            },
            indexedAt: new Date().toISOString(),
            content: comp.description || undefined,
          };

          indexed++;
          options.onProgress?.(indexed);
          yield compItem;
        }
      }
    }
  },
};

export default connector;

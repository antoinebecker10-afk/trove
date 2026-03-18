import { z } from "zod";
import { RateLimiter } from "@trove/shared";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

const ConfluenceConfigSchema = z.object({
  /** Env var name for the Confluence API token (default: CONFLUENCE_TOKEN) */
  token_env: z.string().default("CONFLUENCE_TOKEN"),
  /** Atlassian domain, e.g. "mycompany" for mycompany.atlassian.net */
  domain: z.string().min(1),
  /** Env var name for the Confluence email (default: CONFLUENCE_EMAIL) */
  email_env: z.string().default("CONFLUENCE_EMAIL"),
  /** Optional space keys to filter */
  space_keys: z.array(z.string()).optional(),
});

interface ConfluencePage {
  id: string;
  title: string;
  status: string;
  spaceId: string;
  _links: {
    webui: string;
  };
  body?: {
    storage?: {
      value: string;
    };
  };
  labels?: {
    results: { name: string }[];
  };
}

interface ConfluencePageListResponse {
  results: ConfluencePage[];
  _links: {
    next?: string;
  };
}

interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
}

interface ConfluenceSpaceListResponse {
  results: ConfluenceSpace[];
  _links: {
    next?: string;
  };
}

function buildHeaders(email: string, token: string): Record<string, string> {
  const credentials = Buffer.from(`${email}:${token}`).toString("base64");
  return {
    Authorization: `Basic ${credentials}`,
    Accept: "application/json",
    "User-Agent": "Trove/0.1.0",
  };
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const limiter = new RateLimiter(3);

function apiBase(domain: string): string {
  return `https://${domain}.atlassian.net/wiki/api/v2`;
}

function webBase(domain: string): string {
  return `https://${domain}.atlassian.net/wiki`;
}

async function apiFetch(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  await limiter.wait();
  const response = await fetch(url, { headers, signal });
  if (!response.ok) {
    await response.text().catch(() => { /* drain body */ });
    throw new Error(`Confluence API error (${response.status})`);
  }
  return response;
}

async function fetchSpaces(
  domain: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<ConfluenceSpace[]> {
  const spaces: ConfluenceSpace[] = [];
  let url: string | null = `${apiBase(domain)}/spaces?limit=100`;

  while (url) {
    if (signal?.aborted) break;
    const response = await apiFetch(url, headers, signal);
    const data = (await response.json()) as ConfluenceSpaceListResponse;
    spaces.push(...data.results);
    url = data._links.next
      ? `https://${domain}.atlassian.net/wiki${data._links.next}`
      : null;
  }

  return spaces;
}

async function fetchPages(
  domain: string,
  headers: Record<string, string>,
  endpoint: string,
  signal?: AbortSignal,
): Promise<ConfluencePage[]> {
  const pages: ConfluencePage[] = [];
  let url: string | null = `${apiBase(domain)}/${endpoint}?limit=100`;

  while (url) {
    if (signal?.aborted) break;
    const response = await apiFetch(url, headers, signal);
    const data = (await response.json()) as ConfluencePageListResponse;
    pages.push(...data.results);
    url = data._links.next
      ? `https://${domain}.atlassian.net/wiki${data._links.next}`
      : null;
  }

  return pages;
}

async function fetchPageContent(
  domain: string,
  pageId: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const response = await apiFetch(
      `${apiBase(domain)}/pages/${encodeURIComponent(pageId)}?body-format=storage`,
      headers,
      signal,
    );
    const data = (await response.json()) as ConfluencePage;
    const html = data.body?.storage?.value;
    if (!html) return undefined;
    return stripHtmlTags(html);
  } catch {
    return undefined;
  }
}

async function fetchPageLabels(
  domain: string,
  pageId: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const response = await apiFetch(
      `${apiBase(domain)}/pages/${encodeURIComponent(pageId)}/labels`,
      headers,
      signal,
    );
    const data = (await response.json()) as { results: { name: string }[] };
    return data.results.map((l) => l.name);
  } catch {
    return [];
  }
}

const connector: Connector = {
  manifest: {
    name: "confluence",
    version: "0.1.0",
    description: "Index Confluence Cloud pages and blog posts",
    configSchema: ConfluenceConfigSchema,
  },

  async validate(config) {
    const result = ConfluenceConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    const parsed = result.data;
    const token = process.env[parsed.token_env];
    const email = process.env[parsed.email_env];
    if (!token) {
      return { valid: false, errors: [`Environment variable ${parsed.token_env} is not set`] };
    }
    if (!email) {
      return { valid: false, errors: [`Environment variable ${parsed.email_env} is not set`] };
    }
    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = ConfluenceConfigSchema.parse(config);
    const token = process.env[parsed.token_env];
    const email = process.env[parsed.email_env];
    if (!token) {
      throw new Error(`Environment variable ${parsed.token_env} is not set`);
    }
    if (!email) {
      throw new Error(`Environment variable ${parsed.email_env} is not set`);
    }

    const headers = buildHeaders(email, token);

    // Fetch spaces for name lookup and optional filtering
    const allSpaces = await fetchSpaces(parsed.domain, headers, options.signal);
    const spaceMap = new Map<string, ConfluenceSpace>();
    for (const space of allSpaces) {
      spaceMap.set(space.id, space);
    }

    const allowedSpaceIds = parsed.space_keys
      ? new Set(allSpaces.filter((s) => parsed.space_keys!.includes(s.key)).map((s) => s.id))
      : null;

    // Fetch pages and blog posts
    const [pages, blogPosts] = await Promise.all([
      fetchPages(parsed.domain, headers, "pages", options.signal),
      fetchPages(parsed.domain, headers, "blogposts", options.signal),
    ]);

    const allPages = [...pages, ...blogPosts];
    let indexed = 0;

    for (const page of allPages) {
      if (options.signal?.aborted) return;

      // Filter by space if configured
      if (allowedSpaceIds && !allowedSpaceIds.has(page.spaceId)) continue;

      const space = spaceMap.get(page.spaceId);
      const spaceName = space?.name ?? "Unknown";

      // Fetch content and labels
      const [content, labels] = await Promise.all([
        fetchPageContent(parsed.domain, page.id, headers, options.signal),
        fetchPageLabels(parsed.domain, page.id, headers, options.signal),
      ]);

      const tags = [spaceName, ...labels];
      const pageUrl = `${webBase(parsed.domain)}${page._links.webui}`;

      const item: ContentItem = {
        id: `confluence:${page.id}`,
        source: "confluence",
        type: "document",
        title: page.title,
        description: `Confluence page from ${spaceName}`,
        tags,
        uri: pageUrl,
        metadata: {
          spaceId: page.spaceId,
          spaceName,
          status: page.status,
          labels,
        },
        indexedAt: new Date().toISOString(),
        content,
      };

      indexed++;
      options.onProgress?.(indexed, allPages.length);
      yield item;
    }
  },
};

export default connector;

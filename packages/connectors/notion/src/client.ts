/**
 * Minimal Notion API client with built-in rate limiting and retry.
 * Uses raw fetch — zero external dependencies.
 */

import type {
  NotionPage,
  NotionBlock,
  NotionDatabase,
  PaginatedResponse,
  QueryResponse,
  BlockChildrenResponse,
  SearchResponse,
} from "./types.js";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const MAX_RETRIES = 3;
const RATE_LIMIT = 3; // requests per second

/** Token-bucket rate limiter: max N requests per second. */
class RateLimiter {
  private timestamps: number[] = [];

  async acquire(): Promise<void> {
    const now = Date.now();
    // Remove timestamps older than 1 second
    this.timestamps = this.timestamps.filter((t) => now - t < 1000);

    if (this.timestamps.length >= RATE_LIMIT) {
      const oldest = this.timestamps[0];
      const waitMs = 1000 - (now - oldest) + 10; // +10ms buffer
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    this.timestamps.push(Date.now());
  }
}

export class NotionClient {
  private token: string;
  private limiter = new RateLimiter();

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error("Aborted");
      await this.limiter.acquire();

      const res = await fetch(`${NOTION_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });

      if (res.ok) {
        return (await res.json()) as T;
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Notion API ${res.status}: Integration token is invalid or does not have access. ` +
            `Ensure the integration is connected to the relevant pages/databases in Notion settings.`,
        );
      }

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        lastError = new Error(`Notion API rate limited (attempt ${attempt + 1}/${MAX_RETRIES})`);
        continue;
      }

      if (res.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        lastError = new Error(`Notion API ${res.status}: server error`);
        continue;
      }

      // Other errors — don't retry. Don't leak response body.
      await res.text().catch(() => { /* drain body */ });
      throw new Error(`Notion API error (${res.status})`);
    }

    throw lastError ?? new Error("Notion API request failed after retries");
  }

  // -----------------------------------------------------------------------
  // High-level paginated methods
  // -----------------------------------------------------------------------

  /** Search the workspace for all pages and databases. */
  async *searchPages(signal?: AbortSignal): AsyncGenerator<NotionPage> {
    let cursor: string | undefined;

    do {
      if (signal?.aborted) return;

      const body: Record<string, unknown> = {
        filter: { value: "page", property: "object" },
        page_size: 100,
      };
      if (cursor) body.start_cursor = cursor;

      const res = await this.request<SearchResponse>("POST", "/search", body, signal);

      for (const result of res.results) {
        if (result.object === "page") yield result as NotionPage;
      }

      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);
  }

  /** Query all pages in a specific database. */
  async *queryDatabase(
    databaseId: string,
    since?: Date,
    signal?: AbortSignal,
  ): AsyncGenerator<NotionPage> {
    let cursor: string | undefined;

    do {
      if (signal?.aborted) return;

      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      // Incremental: filter by last_edited_time
      if (since) {
        body.filter = {
          timestamp: "last_edited_time",
          last_edited_time: { after: since.toISOString() },
        };
      }

      const res = await this.request<QueryResponse>(
        "POST",
        `/databases/${databaseId}/query`,
        body,
        signal,
      );

      for (const page of res.results) {
        yield page;
      }

      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);
  }

  /** Get all blocks (children) of a page or block, recursively up to maxDepth. */
  async getBlocks(
    blockId: string,
    maxDepth: number = 5,
    signal?: AbortSignal,
  ): Promise<NotionBlock[]> {
    if (maxDepth <= 0) return [];

    const blocks: NotionBlock[] = [];
    let cursor: string | undefined;

    do {
      if (signal?.aborted) return blocks;

      const path = `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
      const res = await this.request<BlockChildrenResponse>("GET", path, undefined, signal);

      for (const block of res.results) {
        blocks.push(block);

        // Recurse into children
        if (block.has_children && maxDepth > 1) {
          const children = await this.getBlocks(block.id, maxDepth - 1, signal);
          // Attach children to the block for rendering
          const blockData = block[block.type as keyof NotionBlock] as Record<string, unknown> | undefined;
          if (blockData && typeof blockData === "object") {
            (blockData as Record<string, unknown>).children = children;
          }
        }
      }

      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);

    return blocks;
  }

  /** Get a single database's metadata. */
  async getDatabase(databaseId: string, signal?: AbortSignal): Promise<NotionDatabase> {
    return this.request<NotionDatabase>("GET", `/databases/${databaseId}`, undefined, signal);
  }
}

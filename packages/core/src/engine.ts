import { mkdir } from "node:fs/promises";
import type {
  ContentItem,
  TroveConfig,
  SearchOptions,
  SearchResult,
  IndexStats,
} from "@trove/shared";
import { loadConfig, resolveDataDir } from "./config.js";
import { createStore, type Store } from "./store.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "./embeddings.js";
import { loadConnector } from "./plugin-loader.js";
import { redactSecrets } from "./redact.js";

export interface EngineOptions {
  /** Override config file search directory */
  cwd?: string;
  /** Override config entirely */
  config?: TroveConfig;
}

export class TroveEngine {
  private config: TroveConfig;
  private store: Store;
  private embeddings: EmbeddingProvider;
  private initialized = false;

  private constructor(
    config: TroveConfig,
    store: Store,
    embeddings: EmbeddingProvider,
  ) {
    this.config = config;
    this.store = store;
    this.embeddings = embeddings;
  }

  /**
   * Create and initialize a TroveEngine instance.
   */
  static async create(options: EngineOptions = {}): Promise<TroveEngine> {
    const config = options.config ?? (await loadConfig(options.cwd));
    const dataDir = resolveDataDir(config);
    await mkdir(dataDir, { recursive: true });

    const store = await createStore(config.storage, dataDir);
    const embeddings = createEmbeddingProvider(config.embeddings, {
      url: config.ollama_url,
      model: config.ollama_model,
    });

    const engine = new TroveEngine(config, store, embeddings);
    engine.initialized = true;
    return engine;
  }

  /**
   * Index content from all configured sources (or a specific one).
   */
  async index(
    sourceName?: string,
    options?: { signal?: AbortSignal; onProgress?: (count: number) => void },
  ): Promise<number> {
    this.assertInitialized();
    let totalIndexed = 0;

    const sources = sourceName
      ? this.config.sources.filter((s) => s.connector === sourceName)
      : this.config.sources;

    if (sources.length === 0) {
      throw new Error(
        sourceName
          ? `No source configured with connector "${sourceName}"`
          : "No sources configured in .trove.yml",
      );
    }

    for (const source of sources) {
      const connector = await loadConnector(source);

      // Validate config before indexing
      const validation = await connector.validate(source.config);
      if (!validation.valid) {
        throw new Error(
          `Connector "${source.connector}" config is invalid: ${validation.errors?.join(", ")}`,
        );
      }

      // Incremental indexing: load existing items to skip unchanged files
      const existingIndex = await this.store.getSourceIndex(source.connector);
      const seenIds = new Set<string>();

      const batch: ContentItem[] = [];
      const BATCH_SIZE = 50;

      for await (const item of connector.index(source.config, {
        signal: options?.signal,
      })) {
        seenIds.add(item.id);

        // Skip if item exists with same modification date (incremental)
        const existingModified = existingIndex.get(item.id);
        const itemModified = item.metadata?.modified as string | undefined;
        if (existingModified && itemModified && existingModified === itemModified) {
          totalIndexed++;
          options?.onProgress?.(totalIndexed);
          continue; // unchanged — skip embedding + storage
        }

        batch.push(item);

        if (batch.length >= BATCH_SIZE) {
          await this.embedAndStore(batch);
          totalIndexed += batch.length;
          options?.onProgress?.(totalIndexed);
          batch.length = 0;
        }
      }

      // Flush remaining items
      if (batch.length > 0) {
        await this.embedAndStore(batch);
        totalIndexed += batch.length;
        options?.onProgress?.(totalIndexed);
      }

      // Remove items that no longer exist in the source (deleted files)
      const removedIds = [...existingIndex.keys()].filter(id => !seenIds.has(id));
      if (removedIds.length > 0) {
        await this.store.removeItems(removedIds);
      }
    }

    return totalIndexed;
  }

  /**
   * Search across all indexed content.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    this.assertInitialized();

    const sanitized = sanitizeQuery(query);
    if (!sanitized) return [];

    const limit = options.limit ?? 10;

    // Generate embedding for query
    const [queryEmbedding] = await this.embeddings.embed([sanitized]);

    let results = await this.store.search(queryEmbedding, limit * 2);

    // Apply filters
    if (options.type) {
      results = results.filter((r) => r.item.type === options.type);
    }
    if (options.source) {
      results = results.filter((r) => r.item.source === options.source);
    }

    return results.slice(0, limit);
  }

  /**
   * Full-text keyword search (no embeddings needed).
   */
  async keywordSearch(
    query: string,
    options: SearchOptions = {},
  ): Promise<ContentItem[]> {
    this.assertInitialized();

    const sanitized = sanitizeQuery(query);
    if (!sanitized) return [];

    const terms = sanitized.toLowerCase().split(/\s+/);
    let items = await this.store.getAllItems();

    if (options.type) {
      items = items.filter((i) => i.type === options.type);
    }
    if (options.source) {
      items = items.filter((i) => i.source === options.source);
    }

    // Score items: AND match first, then OR fallback
    const andMatches = items.filter((item) => {
      const haystack =
        `${item.title} ${item.description} ${item.tags.join(" ")} ${item.uri} ${item.content ?? ""}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });

    if (andMatches.length > 0) return andMatches;

    // Fallback: OR matching, sorted by number of matching terms (best first)
    const orMatches = items
      .map((item) => {
        const haystack =
          `${item.title} ${item.description} ${item.tags.join(" ")} ${item.uri} ${item.content ?? ""}`.toLowerCase();
        const matchCount = terms.filter((term) => haystack.includes(term)).length;
        return { item, matchCount };
      })
      .filter(({ matchCount }) => matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount)
      .map(({ item }) => item);

    return orMatches;
  }

  /**
   * Get a single content item by ID.
   */
  async getItem(id: string): Promise<ContentItem | null> {
    this.assertInitialized();
    return this.store.getItem(id);
  }

  /**
   * Get index statistics.
   */
  async getStats(): Promise<IndexStats> {
    this.assertInitialized();
    return this.store.getStats();
  }

  /**
   * Get all indexed items (no embeddings/content stripped — caller should handle).
   */
  async getAllItems(): Promise<ContentItem[]> {
    this.assertInitialized();
    return this.store.getAllItems();
  }

  /**
   * Get the current config (sanitized — no secrets).
   */
  getConfig(): TroveConfig {
    return { ...this.config };
  }

  private async embedAndStore(items: ContentItem[]): Promise<void> {
    // Redact secrets from content before storing — API keys, passwords,
    // private keys, credit card numbers, etc. are replaced with [REDACTED:type]
    let totalRedacted = 0;
    for (const item of items) {
      if (item.content) {
        const { redacted, count } = redactSecrets(item.content);
        if (count > 0) {
          item.content = redacted;
          totalRedacted += count;
        }
      }
      if (item.description) {
        const { redacted, count } = redactSecrets(item.description);
        if (count > 0) {
          item.description = redacted;
          totalRedacted += count;
        }
      }
    }
    if (totalRedacted > 0) {
      console.error(`[trove] Redacted ${totalRedacted} secret(s) from indexed content`);
    }

    // Embed metadata (title, description, tags, path segments) — NEVER send
    // file content to external APIs. Content may contain credentials or keys.
    // URI path segments are included for better discoverability (folder names).
    const textsToEmbed = items.map((item) => {
      // Extract meaningful path segments (last 4 dirs + filename) from URI
      const pathSegments = item.uri
        .split(/[/\\]/)
        .filter((s) => s.length > 0)
        .slice(-5)
        .join(" ");
      return `${item.title} ${item.description} ${item.tags.join(" ")} ${pathSegments}`;
    });

    try {
      const embeddings = await this.embeddings.embed(textsToEmbed);
      for (let i = 0; i < items.length; i++) {
        items[i].embedding = embeddings[i];
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[trove] Embedding failed (keyword search still works): ${msg}`);
    }

    await this.store.upsertItems(items);
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error("TroveEngine not initialized. Call TroveEngine.create() first.");
    }
  }
}

/**
 * Sanitize a search query: trim, limit length, strip control chars.
 */
function sanitizeQuery(query: string): string {
  return query
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 500);
}

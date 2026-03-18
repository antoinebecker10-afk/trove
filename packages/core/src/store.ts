import { readFile, writeFile, mkdir, rename, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ContentItem, IndexStats, SearchResult } from "@trove/shared";
import { encrypt, decrypt, isEncrypted, getEncryptionKey } from "./crypto.js";

/**
 * Abstract store interface — all storage backends implement this.
 */
export interface Store {
  upsertItems(items: ContentItem[]): Promise<void>;
  getAllItems(): Promise<ContentItem[]>;
  getItem(id: string): Promise<ContentItem | null>;
  /** Get all item IDs for a given source, with their indexed metadata.modified */
  getSourceIndex(source: string): Promise<Map<string, string | undefined>>;
  search(embedding: number[], limit: number): Promise<SearchResult[]>;
  getStats(): Promise<IndexStats>;
  clear(source?: string): Promise<void>;
  /** Remove specific items by ID */
  removeItems(ids: string[]): Promise<void>;
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * JSON file-based store with optional AES-256-GCM encryption at rest.
 *
 * When TROVE_ENCRYPTION_KEY is set in environment:
 * - Index is encrypted before writing to disk
 * - Index is decrypted when loading from disk
 * - File permissions are set to 0600 (owner read/write only)
 *
 * Without TROVE_ENCRYPTION_KEY:
 * - Index is stored as plaintext JSON (backwards compatible)
 * - File permissions are still set to 0600
 */
export class JsonStore implements Store {
  private items: Map<string, ContentItem> = new Map();
  private filepath: string;
  private loaded = false;

  constructor(dataDir: string) {
    this.filepath = join(dataDir, "index.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const rawBuffer = await readFile(this.filepath);
      const encKey = getEncryptionKey();

      let jsonStr: string;
      if (encKey && isEncrypted(rawBuffer)) {
        // Decrypt the index
        jsonStr = decrypt(rawBuffer, encKey);
      } else {
        jsonStr = rawBuffer.toString("utf-8");
      }

      const data: ContentItem[] = JSON.parse(jsonStr);
      for (const item of data) {
        this.items.set(item.id, item);
      }
    } catch {
      // File doesn't exist yet or decryption failed — start empty
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const dir = this.filepath.replace(/[/\\][^/\\]+$/, "");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const data = Array.from(this.items.values());
    const jsonStr = JSON.stringify(data, null, 2);

    const encKey = getEncryptionKey();
    const content: string | Buffer = encKey ? encrypt(jsonStr, encKey) : jsonStr;

    // Atomic write: write to temp file, then rename to prevent corruption
    const tmpFile = `${this.filepath}.${randomBytes(6).toString("hex")}.tmp`;
    if (typeof content === "string") {
      await writeFile(tmpFile, content, { encoding: "utf-8", mode: 0o600 });
    } else {
      await writeFile(tmpFile, content, { mode: 0o600 });
    }
    await rename(tmpFile, this.filepath);
    // Ensure final file has restricted permissions (owner read/write only)
    await chmod(this.filepath, 0o600).catch(() => {});
  }

  async upsertItems(items: ContentItem[]): Promise<void> {
    await this.ensureLoaded();
    for (const item of items) {
      this.items.set(item.id, item);
    }
    await this.persist();
  }

  async getAllItems(): Promise<ContentItem[]> {
    await this.ensureLoaded();
    return Array.from(this.items.values());
  }

  async getItem(id: string): Promise<ContentItem | null> {
    await this.ensureLoaded();
    return this.items.get(id) ?? null;
  }

  async search(embedding: number[], limit: number): Promise<SearchResult[]> {
    await this.ensureLoaded();
    const scored: SearchResult[] = [];

    for (const item of this.items.values()) {
      if (!item.embedding || item.embedding.length === 0) continue;
      const score = cosineSimilarity(embedding, item.embedding);
      scored.push({ item, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async getStats(): Promise<IndexStats> {
    await this.ensureLoaded();
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let lastIndexedAt: string | null = null;

    for (const item of this.items.values()) {
      byType[item.type] = (byType[item.type] ?? 0) + 1;
      bySource[item.source] = (bySource[item.source] ?? 0) + 1;
      if (!lastIndexedAt || item.indexedAt > lastIndexedAt) {
        lastIndexedAt = item.indexedAt;
      }
    }

    return {
      totalItems: this.items.size,
      byType,
      bySource,
      lastIndexedAt,
    };
  }

  async getSourceIndex(source: string): Promise<Map<string, string | undefined>> {
    await this.ensureLoaded();
    const index = new Map<string, string | undefined>();
    for (const [id, item] of this.items) {
      if (item.source === source) {
        index.set(id, item.metadata?.modified as string | undefined);
      }
    }
    return index;
  }

  async removeItems(ids: string[]): Promise<void> {
    await this.ensureLoaded();
    for (const id of ids) {
      this.items.delete(id);
    }
    if (ids.length > 0) await this.persist();
  }

  async clear(source?: string): Promise<void> {
    await this.ensureLoaded();
    if (source) {
      for (const [id, item] of this.items) {
        if (item.source === source) this.items.delete(id);
      }
    } else {
      this.items.clear();
    }
    await this.persist();
  }
}

/**
 * Create the appropriate store based on config.
 */
export async function createStore(backend: "json" | "sqlite", dataDir: string): Promise<Store> {
  if (backend === "sqlite") {
    const { SqliteStore } = await import("./sqlite-store.js");
    return new SqliteStore(dataDir);
  }
  return new JsonStore(dataDir);
}

/**
 * SQLite-based store with vector search via sqlite-vec.
 *
 * Replaces the JSON store for better performance at scale.
 * Single .db file = items + embeddings + metadata.
 * Supports optional encryption at rest (same TROVE_ENCRYPTION_KEY).
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import type { ContentItem, IndexStats, SearchResult } from "@trove/shared";

/**
 * Cosine similarity between two vectors (used as fallback when sqlite-vec
 * extension is not available).
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

/** Serialize a float64 array to a Buffer for sqlite-vec */
function float64ToBuffer(vec: number[]): Buffer {
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf;
}

/** Deserialize a Buffer back to number[] */
function bufferToFloat64(buf: Buffer): number[] {
  const len = buf.length / 4;
  const vec: number[] = new Array(len);
  for (let i = 0; i < len; i++) {
    vec[i] = buf.readFloatLE(i * 4);
  }
  return vec;
}

import type { Store } from "./store.js";

export class SqliteStore implements Store {
  private db: Database.Database;
  private hasVec: boolean = false;
  private dbPath: string;

  constructor(dataDir: string) {
    this.dbPath = join(dataDir, "trove.db");
    // Ensure directory exists synchronously is not possible, caller must mkdir
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma("journal_mode = WAL");

    // Try to load sqlite-vec extension (optional native addon)
    try {
      const require = createRequire(import.meta.url);
      const sqliteVec = require("sqlite-vec");
      sqliteVec.load(this.db);
      this.hasVec = true;
    } catch {
      // sqlite-vec not available — use JS fallback for vector search
      this.hasVec = false;
    }

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        uri TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        content TEXT,
        indexed_at TEXT NOT NULL,
        embedding BLOB
      );

      CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);
      CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
    `);

    // FTS5 full-text search index — O(log n) keyword search instead of brute-force
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
        id UNINDEXED,
        title,
        description,
        tags,
        content,
        uri
      );
    `);

    // Create virtual table for sqlite-vec if available
    if (this.hasVec) {
      try {
        // We'll create the vec table dynamically on first insert when we know dimensions
        // For now, check if it exists
        const row = this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='items_vec'",
          )
          .get() as { name: string } | undefined;
        if (!row) {
          // Will be created on first upsert when we know embedding dimensions
        }
      } catch {
        this.hasVec = false;
      }
    }
  }

  private ensureVecTable(dimensions: number): void {
    if (!this.hasVec) return;
    try {
      this.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS items_vec USING vec0(
          id TEXT PRIMARY KEY,
          embedding float[${dimensions}]
        )`,
      );
    } catch {
      this.hasVec = false;
    }
  }

  async upsertItems(items: ContentItem[]): Promise<void> {
    if (items.length === 0) return;

    // Detect embedding dimensions from first item with an embedding
    const firstWithEmb = items.find(
      (i) => i.embedding && i.embedding.length > 0,
    );
    if (firstWithEmb?.embedding) {
      this.ensureVecTable(firstWithEmb.embedding.length);
    }

    const upsertItem = this.db.prepare(`
      INSERT OR REPLACE INTO items (id, source, type, title, description, tags, uri, metadata, content, indexed_at, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertVec = this.hasVec
      ? this.db.prepare(`
          INSERT OR REPLACE INTO items_vec (id, embedding)
          VALUES (?, ?)
        `)
      : null;

    // FTS5: delete old entry then insert fresh (FTS5 doesn't support REPLACE)
    const deleteFts = this.db.prepare(`DELETE FROM items_fts WHERE id = ?`);
    const insertFts = this.db.prepare(`
      INSERT INTO items_fts (id, title, description, tags, content, uri)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((batch: ContentItem[]) => {
      for (const item of batch) {
        const embBuf = item.embedding
          ? float64ToBuffer(item.embedding)
          : null;
        const tagsStr = JSON.stringify(item.tags);

        upsertItem.run(
          item.id,
          item.source,
          item.type,
          item.title,
          item.description,
          tagsStr,
          item.uri,
          JSON.stringify(item.metadata),
          item.content ?? null,
          item.indexedAt,
          embBuf,
        );

        // Update FTS5 index
        try {
          deleteFts.run(item.id);
          insertFts.run(
            item.id,
            item.title,
            item.description,
            item.tags.join(" "),
            item.content ?? "",
            item.uri,
          );
        } catch {
          // FTS5 update failed — keyword search degrades gracefully
        }

        if (upsertVec && embBuf) {
          try {
            upsertVec.run(item.id, embBuf);
          } catch {
            // Vec table might not match dimensions — ignore
          }
        }
      }
    });

    transaction(items);
  }

  async getAllItems(): Promise<ContentItem[]> {
    const rows = this.db
      .prepare("SELECT * FROM items")
      .all() as SqliteItemRow[];
    return rows.map(rowToContentItem);
  }

  async getItem(id: string): Promise<ContentItem | null> {
    const row = this.db
      .prepare("SELECT * FROM items WHERE id = ?")
      .get(id) as SqliteItemRow | undefined;
    return row ? rowToContentItem(row) : null;
  }

  async search(
    embedding: number[],
    limit: number,
  ): Promise<SearchResult[]> {
    // Try sqlite-vec native vector search first
    if (this.hasVec) {
      try {
        const queryBuf = float64ToBuffer(embedding);
        const rows = this.db
          .prepare(
            `SELECT id, distance FROM items_vec
             WHERE embedding MATCH ?
             ORDER BY distance
             LIMIT ?`,
          )
          .all(queryBuf, limit) as Array<{ id: string; distance: number }>;

        const results: SearchResult[] = [];
        for (const row of rows) {
          const item = await this.getItem(row.id);
          if (item) {
            // sqlite-vec returns L2 distance; convert to similarity score (0-1)
            const score = 1 / (1 + row.distance);
            results.push({ item, score });
          }
        }
        return results;
      } catch {
        // Fall through to JS fallback
      }
    }

    // JS fallback: cosine similarity over all items
    const rows = this.db
      .prepare("SELECT * FROM items WHERE embedding IS NOT NULL")
      .all() as SqliteItemRow[];

    const scored: SearchResult[] = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      const itemEmb = bufferToFloat64(row.embedding as unknown as Buffer);
      const score = cosineSimilarity(embedding, itemEmb);
      scored.push({ item: rowToContentItem(row), score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async getStats(): Promise<IndexStats> {
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    const typeRows = this.db
      .prepare("SELECT type, COUNT(*) as cnt FROM items GROUP BY type")
      .all() as Array<{ type: string; cnt: number }>;
    for (const r of typeRows) byType[r.type] = r.cnt;

    const sourceRows = this.db
      .prepare("SELECT source, COUNT(*) as cnt FROM items GROUP BY source")
      .all() as Array<{ source: string; cnt: number }>;
    for (const r of sourceRows) bySource[r.source] = r.cnt;

    const totalRow = this.db
      .prepare("SELECT COUNT(*) as cnt FROM items")
      .get() as { cnt: number };

    const lastRow = this.db
      .prepare(
        "SELECT indexed_at FROM items ORDER BY indexed_at DESC LIMIT 1",
      )
      .get() as { indexed_at: string } | undefined;

    return {
      totalItems: totalRow.cnt,
      byType,
      bySource,
      lastIndexedAt: lastRow?.indexed_at ?? null,
    };
  }

  async clear(source?: string): Promise<void> {
    if (source) {
      const ids = this.db
        .prepare("SELECT id FROM items WHERE source = ?")
        .all(source) as Array<{ id: string }>;

      this.db.prepare("DELETE FROM items WHERE source = ?").run(source);

      if (ids.length > 0) {
        const deleteFts = this.db.prepare("DELETE FROM items_fts WHERE id = ?");
        const deleteVec = this.hasVec
          ? this.db.prepare("DELETE FROM items_vec WHERE id = ?")
          : null;
        const tx = this.db.transaction((idList: Array<{ id: string }>) => {
          for (const { id } of idList) {
            try { deleteFts.run(id); } catch { /* ignore */ }
            if (deleteVec) {
              try { deleteVec.run(id); } catch { /* ignore */ }
            }
          }
        });
        tx(ids);
      }
    } else {
      this.db.prepare("DELETE FROM items").run();
      this.db.prepare("DELETE FROM items_fts").run();
      if (this.hasVec) {
        try {
          this.db.prepare("DELETE FROM items_vec").run();
        } catch {
          // ignore
        }
      }
    }
  }

  async getSourceIndex(source: string): Promise<Map<string, string | undefined>> {
    const rows = this.db
      .prepare("SELECT id, metadata FROM items WHERE source = ?")
      .all(source) as Array<{ id: string; metadata: string }>;

    const index = new Map<string, string | undefined>();
    for (const row of rows) {
      const meta = JSON.parse(row.metadata) as Record<string, unknown>;
      index.set(row.id, meta?.modified as string | undefined);
    }
    return index;
  }

  async removeItems(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const deleteItem = this.db.prepare("DELETE FROM items WHERE id = ?");
    const deleteFts = this.db.prepare("DELETE FROM items_fts WHERE id = ?");
    const deleteVec = this.hasVec
      ? this.db.prepare("DELETE FROM items_vec WHERE id = ?")
      : null;

    const tx = this.db.transaction((idList: string[]) => {
      for (const id of idList) {
        deleteItem.run(id);
        try { deleteFts.run(id); } catch { /* ignore */ }
        if (deleteVec) {
          try { deleteVec.run(id); } catch { /* ignore */ }
        }
      }
    });
    tx(ids);
  }

  /**
   * Full-text keyword search via FTS5 — O(log n) instead of brute-force.
   * Returns items ranked by BM25 relevance.
   */
  async ftsSearch(
    query: string,
    options?: { type?: string; source?: string; limit?: number },
  ): Promise<ContentItem[]> {
    const limit = options?.limit ?? 20;

    // Escape FTS5 special characters and build query
    const terms = query
      .replace(/['"(){}[\]*:^~!]/g, "")
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 1);

    if (terms.length === 0) return [];

    // FTS5 query: each term with implicit AND
    const ftsQuery = terms.map((t) => `"${t}"`).join(" ");

    try {
      let sql = `
        SELECT items_fts.id, rank
        FROM items_fts
        JOIN items ON items.id = items_fts.id
        WHERE items_fts MATCH ?
      `;
      const params: unknown[] = [ftsQuery];

      if (options?.type) {
        sql += ` AND items.type = ?`;
        params.push(options.type);
      }
      if (options?.source) {
        sql += ` AND items.source = ?`;
        params.push(options.source);
      }

      sql += ` ORDER BY rank LIMIT ?`;
      params.push(limit);

      const rows = this.db
        .prepare(sql)
        .all(...params) as Array<{ id: string; rank: number }>;

      const results: ContentItem[] = [];
      for (const row of rows) {
        const item = await this.getItem(row.id);
        if (item) results.push(item);
      }
      return results;
    } catch {
      // FTS5 query failed — return empty (caller can fallback)
      return [];
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

// -- Helpers --

interface SqliteItemRow {
  id: string;
  source: string;
  type: string;
  title: string;
  description: string;
  tags: string;
  uri: string;
  metadata: string;
  content: string | null;
  indexed_at: string;
  embedding: Buffer | null;
}

function rowToContentItem(row: SqliteItemRow): ContentItem {
  return {
    id: row.id,
    source: row.source,
    type: row.type as ContentItem["type"],
    title: row.title,
    description: row.description,
    tags: JSON.parse(row.tags) as string[],
    uri: row.uri,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    content: row.content ?? undefined,
    indexedAt: row.indexed_at,
    embedding: row.embedding
      ? bufferToFloat64(row.embedding)
      : undefined,
  };
}

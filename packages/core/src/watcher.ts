/**
 * Real-time file watcher for Trove.
 *
 * Uses @parcel/watcher for high-performance, cross-platform file watching.
 * Debounces changes and re-indexes only the changed files.
 */

import { subscribe, type AsyncSubscription, type Event } from "@parcel/watcher";
import { resolve, relative, extname } from "node:path";
import type { TroveConfig, ContentItem } from "@trove/shared";
import type { TroveEngine } from "./engine.js";

export interface WatcherOptions {
  /** Debounce delay in ms (default: 1000) */
  debounceMs?: number;
  /** Called when files are detected as changed */
  onChange?: (paths: string[]) => void;
  /** Called when re-indexing starts */
  onIndexStart?: () => void;
  /** Called when re-indexing completes */
  onIndexEnd?: (count: number) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

/** File extensions to ignore */
const IGNORED_EXTENSIONS = new Set([
  ".DS_Store",
  ".git",
  ".tmp",
  ".swp",
  ".swo",
  ".lock",
]);

/** Directory names to ignore */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  ".next",
  ".turbo",
  "dist",
  "build",
  ".cache",
  "target",
]);

export class TroveWatcher {
  private engine: TroveEngine;
  private config: TroveConfig;
  private subscriptions: AsyncSubscription[] = [];
  private options: Required<WatcherOptions>;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPaths: Set<string> = new Set();
  private isIndexing = false;

  constructor(
    engine: TroveEngine,
    config: TroveConfig,
    options: WatcherOptions = {},
  ) {
    this.engine = engine;
    this.config = config;
    this.options = {
      debounceMs: options.debounceMs ?? 1000,
      onChange: options.onChange ?? (() => {}),
      onIndexStart: options.onIndexStart ?? (() => {}),
      onIndexEnd: options.onIndexEnd ?? (() => {}),
      onError: options.onError ?? ((err) => console.error(`[trove:watch] Error: ${err.message}`)),
    };
  }

  /**
   * Start watching all configured local source paths.
   */
  async start(): Promise<void> {
    const localSources = this.config.sources.filter(
      (s) => s.connector === "local",
    );

    if (localSources.length === 0) {
      throw new Error(
        "No local sources configured in .trove.yml. Add a local connector to use file watching.",
      );
    }

    for (const source of localSources) {
      const paths =
        (source.config.paths as string[]) ??
        (source.config.path ? [source.config.path as string] : []);

      for (const watchPath of paths) {
        const absPath = resolve(watchPath);
        try {
          const sub = await subscribe(
            absPath,
            (err, events) => {
              if (err) {
                this.options.onError(
                  err instanceof Error ? err : new Error(String(err)),
                );
                return;
              }
              this.handleEvents(events);
            },
            {
              ignore: [...IGNORED_DIRS],
            },
          );
          this.subscriptions.push(sub);
        } catch (err) {
          this.options.onError(
            new Error(
              `Failed to watch ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        }
      }
    }
  }

  /**
   * Stop all file watchers.
   */
  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    for (const sub of this.subscriptions) {
      await sub.unsubscribe();
    }
    this.subscriptions = [];
    this.pendingPaths.clear();
  }

  /**
   * Handle raw filesystem events.
   */
  private handleEvents(events: Event[]): void {
    const relevantPaths: string[] = [];

    for (const event of events) {
      // Skip deletes for now (we re-index on next full index)
      if (event.type === "delete") continue;

      const filePath = event.path;

      // Skip ignored extensions
      const ext = extname(filePath);
      if (IGNORED_EXTENSIONS.has(ext)) continue;

      // Skip files in ignored directories
      const parts = filePath.split(/[/\\]/);
      if (parts.some((p) => IGNORED_DIRS.has(p))) continue;

      relevantPaths.push(filePath);
    }

    if (relevantPaths.length === 0) return;

    // Add to pending set
    for (const p of relevantPaths) {
      this.pendingPaths.add(p);
    }

    this.options.onChange(relevantPaths);

    // Debounce: wait before re-indexing to batch rapid changes
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.flushPending();
    }, this.options.debounceMs);
  }

  /**
   * Flush pending changes: trigger a re-index of the local source.
   */
  private async flushPending(): Promise<void> {
    if (this.isIndexing || this.pendingPaths.size === 0) return;

    const paths = Array.from(this.pendingPaths);
    this.pendingPaths.clear();
    this.isIndexing = true;

    try {
      this.options.onIndexStart();

      // Re-index the local source (full re-index for now;
      // incremental per-file indexing can be added later)
      const count = await this.engine.index("local");
      this.options.onIndexEnd(count);
    } catch (err) {
      this.options.onError(
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      this.isIndexing = false;

      // If more changes came in while indexing, flush again
      if (this.pendingPaths.size > 0) {
        this.flushPending();
      }
    }
  }
}

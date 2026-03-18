import { z } from "zod";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Claude Code connector — indexes conversation history, projects, and
 * session data from the local Claude Code CLI (~/.claude/).
 *
 * No API token needed — reads local files only.
 */

const ClaudeCodeConfigSchema = z.object({
  /** Path to Claude Code data directory */
  data_dir: z.string().default("~/.claude"),
  /** Index conversation history (history.jsonl) */
  include_history: z.boolean().default(true),
  /** Index session data (full conversation transcripts) */
  include_sessions: z.boolean().default(true),
  /** Index project memories */
  include_memories: z.boolean().default(true),
  /** Max history entries */
  max_entries: z.number().min(1).max(50000).default(5000),
  /** Days of history to index */
  since_days: z.number().min(1).max(3650).default(90),
});

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

interface HistoryEntry {
  display: string;
  timestamp: number;
  project?: string;
  sessionId?: string;
  pastedContents?: Record<string, unknown>;
}

const connector: Connector = {
  manifest: {
    name: "claude-code",
    version: "0.1.0",
    description:
      "Index Claude Code conversations, projects, and memories — make your AI coding sessions searchable",
    configSchema: ClaudeCodeConfigSchema,
  },

  async validate(config) {
    const result = ClaudeCodeConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = ClaudeCodeConfigSchema.parse(config);
    const dataDir = expandHome(parsed.data_dir);
    let indexed = 0;
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - parsed.since_days);
    const sinceMs = sinceDate.getTime();

    // ── Index conversation history (history.jsonl) ───────────────────
    if (parsed.include_history) {
      const historyPath = join(dataDir, "history.jsonl");
      try {
        const raw = await readFile(historyPath, "utf-8");
        const lines = raw
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => {
            try { return JSON.parse(l) as HistoryEntry; }
            catch { return null; }
          })
          .filter((e): e is HistoryEntry => e !== null)
          .filter((e) => e.timestamp >= sinceMs)
          .slice(-parsed.max_entries);

        // Group by session
        const sessions = new Map<string, HistoryEntry[]>();
        for (const entry of lines) {
          const key = entry.sessionId ?? `no-session-${entry.timestamp}`;
          const list = sessions.get(key) ?? [];
          list.push(entry);
          sessions.set(key, list);
        }

        for (const [sessionId, entries] of sessions) {
          if (options.signal?.aborted) return;

          const firstEntry = entries[0];
          const lastEntry = entries[entries.length - 1];
          const project = firstEntry.project ?? "unknown";
          const projectName = project.split(/[\\/]/).pop() ?? project;

          const content = entries
            .map((e) => e.display)
            .filter(Boolean)
            .join("\n\n")
            .slice(0, 8000);

          const title = entries[0].display?.slice(0, 120) ?? "Claude Code session";

          yield {
            id: `claude-code:history:${sessionId}`,
            source: "claude-code",
            type: "document",
            title,
            description: `${entries.length} prompts in ${projectName} — Claude Code session`,
            tags: ["claude-code", "conversation", "ai", projectName],
            uri: historyPath,
            metadata: {
              sessionId,
              project,
              projectName,
              promptCount: entries.length,
              firstTimestamp: new Date(firstEntry.timestamp).toISOString(),
              modified: new Date(lastEntry.timestamp).toISOString(),
            },
            indexedAt: new Date().toISOString(),
            content,
          };
          indexed++;
          options.onProgress?.(indexed);
        }
      } catch {
        // history.jsonl not found — skip
      }
    }

    // ── Index project memories ────────────────────────────────────────
    if (parsed.include_memories) {
      const projectsDir = join(dataDir, "projects");
      let projectDirs: string[];
      try {
        projectDirs = await readdir(projectsDir);
      } catch {
        projectDirs = [];
      }

      for (const projDir of projectDirs) {
        if (options.signal?.aborted) return;

        const memoryDir = join(projectsDir, projDir, "memory");
        let memFiles: string[];
        try {
          memFiles = await readdir(memoryDir);
        } catch {
          continue;
        }

        for (const memFile of memFiles) {
          if (!memFile.endsWith(".md") || memFile === "MEMORY.md") continue;
          if (options.signal?.aborted) return;

          try {
            const content = await readFile(join(memoryDir, memFile), "utf-8");
            if (!content.trim()) continue;

            // Extract name from frontmatter
            const nameMatch = content.match(/^---[\s\S]*?name:\s*(.+)/m);
            const descMatch = content.match(/^---[\s\S]*?description:\s*(.+)/m);
            const title = nameMatch?.[1]?.trim() ?? memFile.replace(".md", "");
            const description = descMatch?.[1]?.trim() ?? `Memory from ${projDir}`;

            const projectName = projDir
              .replace(/^[Cc]--/, "")
              .replace(/-/g, "/")
              .split("/")
              .pop() ?? projDir;

            yield {
              id: `claude-code:memory:${projDir}:${memFile}`,
              source: "claude-code",
              type: "document",
              title,
              description,
              tags: ["claude-code", "memory", projectName],
              uri: join(memoryDir, memFile),
              metadata: {
                project: projDir,
                projectName,
                file: memFile,
                modified: new Date().toISOString(),
              },
              indexedAt: new Date().toISOString(),
              content,
            };
            indexed++;
            options.onProgress?.(indexed);
          } catch {
            continue;
          }
        }
      }
    }

    // ── Index sessions (full transcripts) ─────────────────────────────
    if (parsed.include_sessions) {
      const sessionsDir = join(dataDir, "sessions");
      let sessionFiles: string[];
      try {
        sessionFiles = await readdir(sessionsDir);
      } catch {
        sessionFiles = [];
      }

      for (const file of sessionFiles) {
        if (!file.endsWith(".jsonl") && !file.endsWith(".json")) continue;
        if (options.signal?.aborted) return;

        try {
          const raw = await readFile(join(sessionsDir, file), "utf-8");
          const lines = raw
            .split("\n")
            .filter((l) => l.trim())
            .slice(0, 200); // Cap lines per session

          if (lines.length === 0) continue;

          // Extract user messages for searchable content
          const userMessages: string[] = [];
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.role === "user" && parsed.content) {
                const text = typeof parsed.content === "string"
                  ? parsed.content
                  : Array.isArray(parsed.content)
                    ? parsed.content.map((c: { text?: string }) => c.text ?? "").join(" ")
                    : "";
                if (text.trim()) userMessages.push(text.slice(0, 500));
              }
            } catch { /* skip malformed lines */ }
          }

          if (userMessages.length === 0) continue;

          const sessionId = file.replace(/\.(jsonl|json)$/, "");
          const content = userMessages.join("\n\n").slice(0, 8000);
          const title = userMessages[0]?.slice(0, 120) ?? "Claude Code session";

          yield {
            id: `claude-code:session:${sessionId}`,
            source: "claude-code",
            type: "document",
            title,
            description: `${userMessages.length} user messages — full session transcript`,
            tags: ["claude-code", "session", "transcript"],
            uri: join(sessionsDir, file),
            metadata: {
              sessionId,
              messageCount: userMessages.length,
              modified: new Date().toISOString(),
            },
            indexedAt: new Date().toISOString(),
            content,
          };
          indexed++;
          options.onProgress?.(indexed);
        } catch {
          continue;
        }
      }
    }
  },
};

export default connector;

import { z } from "zod";
import { RateLimiter } from "@trove/shared";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

/**
 * OpenClaw connector — indexes conversations, memories, and skills
 * from your OpenClaw AI assistant instance.
 *
 * Supports two modes:
 * 1. **API mode** (recommended): connects to OpenClaw's REST gateway (port 18789)
 * 2. **Local mode**: reads session logs and memory files directly from ~/.openclaw/
 *
 * Auth: Bearer token from OpenClaw gateway config.
 */

const OpenClawConfigSchema = z.object({
  /** Environment variable holding the OpenClaw API token */
  token_env: z.string().default("OPENCLAW_TOKEN"),
  /** OpenClaw gateway URL */
  url: z.string().default("http://localhost:18789"),
  /** Index conversation history */
  include_conversations: z.boolean().default(true),
  /** Index long-term memories */
  include_memories: z.boolean().default(true),
  /** Index installed skills (SKILL.md files) */
  include_skills: z.boolean().default(true),
  /** Max conversations to index (most recent first) */
  max_conversations: z.number().min(1).max(10000).default(500),
  /** Days of history to index */
  since_days: z.number().min(1).max(3650).default(90),
});

const limiter = new RateLimiter(5);

interface OpenClawSession {
  id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  messages?: OpenClawMessage[];
}

interface OpenClawMessage {
  role: string;
  content: string;
  timestamp?: string;
}

interface OpenClawMemory {
  id: string;
  content: string;
  created_at?: string;
  category?: string;
}

interface OpenClawSkill {
  name: string;
  description?: string;
  version?: string;
  path?: string;
  content?: string;
}

async function apiFetch<T>(
  url: string,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  await limiter.wait();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal,
  });
  if (!res.ok) {
    throw new Error(`OpenClaw API ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const connector: Connector = {
  manifest: {
    name: "openclaw",
    version: "0.1.0",
    description:
      "Index OpenClaw conversations, memories, and skills — make your AI assistant's history searchable",
    configSchema: OpenClawConfigSchema,
  },

  async validate(config) {
    const result = OpenClawConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    const token = process.env[result.data.token_env];
    if (!token) {
      return {
        valid: false,
        errors: [`Missing environment variable: ${result.data.token_env}`],
      };
    }
    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = OpenClawConfigSchema.parse(config);
    const token = process.env[parsed.token_env];

    if (!token) {
      throw new Error(`Missing environment variable: ${parsed.token_env}`);
    }

    const baseUrl = parsed.url.replace(/\/$/, "");
    let indexed = 0;
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - parsed.since_days);

    // ── Index conversations ──────────────────────────────────────────
    if (parsed.include_conversations) {
      try {
        const sessions = await apiFetch<OpenClawSession[]>(
          `${baseUrl}/api/sessions?limit=${parsed.max_conversations}`,
          token,
          options.signal,
        );

        for (const session of sessions) {
          if (options.signal?.aborted) return;

          const updatedAt = session.updated_at ?? session.created_at;
          if (updatedAt && new Date(updatedAt) < sinceDate) continue;

          // Fetch full conversation if messages not included
          let messages = session.messages;
          if (!messages) {
            try {
              const full = await apiFetch<OpenClawSession>(
                `${baseUrl}/api/sessions/${session.id}`,
                token,
                options.signal,
              );
              messages = full.messages;
            } catch {
              messages = [];
            }
          }

          // Build searchable content from messages
          const content = (messages ?? [])
            .filter((m) => m.content && m.content.length > 0)
            .map((m) => `[${m.role}] ${m.content}`)
            .join("\n\n")
            .slice(0, 10000); // Cap content length

          const title =
            session.title ??
            (messages?.[0]?.content?.slice(0, 100) || "Untitled conversation");

          const description =
            messages && messages.length > 0
              ? `${messages.length} messages — ${messages[0]?.content?.slice(0, 200) ?? ""}`
              : "OpenClaw conversation";

          yield {
            id: `openclaw:conv:${session.id}`,
            source: "openclaw",
            type: "document",
            title,
            description,
            tags: ["conversation", "openclaw", "ai-agent"],
            uri: `${baseUrl}/chat/${session.id}`,
            metadata: {
              messageCount: messages?.length ?? 0,
              createdAt: session.created_at,
              modified: updatedAt,
            },
            indexedAt: new Date().toISOString(),
            content,
          };
          indexed++;
          options.onProgress?.(indexed);
        }
      } catch (err) {
        // API might not support /api/sessions — try local file fallback
        console.error("[trove] OpenClaw conversations API error:", err);
        yield* indexLocalSessions(baseUrl, sinceDate, options, () => {
          indexed++;
          options.onProgress?.(indexed);
        });
      }
    }

    // ── Index memories ───────────────────────────────────────────────
    if (parsed.include_memories) {
      try {
        const memories = await apiFetch<OpenClawMemory[]>(
          `${baseUrl}/api/memories`,
          token,
          options.signal,
        );

        for (const mem of memories) {
          if (options.signal?.aborted) return;

          yield {
            id: `openclaw:mem:${mem.id}`,
            source: "openclaw",
            type: "document",
            title: mem.content.slice(0, 100),
            description: mem.category
              ? `Memory (${mem.category}): ${mem.content.slice(0, 200)}`
              : `Memory: ${mem.content.slice(0, 200)}`,
            tags: ["memory", "openclaw", ...(mem.category ? [mem.category] : [])],
            uri: `${baseUrl}/memories`,
            metadata: {
              category: mem.category,
              createdAt: mem.created_at,
              modified: mem.created_at,
            },
            indexedAt: new Date().toISOString(),
            content: mem.content,
          };
          indexed++;
          options.onProgress?.(indexed);
        }
      } catch {
        // Memories endpoint not available — skip silently
      }
    }

    // ── Index skills ─────────────────────────────────────────────────
    if (parsed.include_skills) {
      try {
        const skills = await apiFetch<OpenClawSkill[]>(
          `${baseUrl}/api/skills`,
          token,
          options.signal,
        );

        for (const skill of skills) {
          if (options.signal?.aborted) return;

          yield {
            id: `openclaw:skill:${skill.name}`,
            source: "openclaw",
            type: "document",
            title: `Skill: ${skill.name}`,
            description: skill.description ?? `OpenClaw skill: ${skill.name}`,
            tags: ["skill", "openclaw", skill.name],
            uri: skill.path ?? `${baseUrl}/skills/${skill.name}`,
            metadata: {
              version: skill.version,
              modified: new Date().toISOString(),
            },
            indexedAt: new Date().toISOString(),
            content: skill.content ?? skill.description,
          };
          indexed++;
          options.onProgress?.(indexed);
        }
      } catch {
        // Skills endpoint not available — skip silently
      }
    }
  },
};

/**
 * Fallback: read session logs from local filesystem (~/.openclaw/agents/).
 * Used when the REST API is not available.
 */
async function* indexLocalSessions(
  _baseUrl: string,
  sinceDate: Date,
  options: IndexOptions,
  onItem: () => void,
): AsyncGenerator<ContentItem> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");

  const agentsDir = join(homedir(), ".openclaw", "agents");

  let agents: string[];
  try {
    agents = await readdir(agentsDir);
  } catch {
    return; // No local OpenClaw data
  }

  for (const agentId of agents) {
    if (options.signal?.aborted) return;

    const sessionsDir = join(agentsDir, agentId, "sessions");
    let files: string[];
    try {
      files = await readdir(sessionsDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      if (options.signal?.aborted) return;

      try {
        const raw = await readFile(join(sessionsDir, file), "utf-8");
        const lines = raw
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        if (lines.length === 0) continue;

        const firstMsg = lines[0];
        const lastMsg = lines[lines.length - 1];
        const timestamp = lastMsg?.timestamp ?? firstMsg?.timestamp;

        if (timestamp && new Date(timestamp) < sinceDate) continue;

        const content = lines
          .filter((l: { role?: string; content?: string }) => l.content)
          .map((l: { role?: string; content?: string }) => `[${l.role ?? "?"}] ${l.content}`)
          .join("\n\n")
          .slice(0, 10000);

        const title =
          lines.find((l: { role?: string }) => l.role === "user")?.content?.slice(0, 100) ??
          "OpenClaw session";

        const sessionId = file.replace(".jsonl", "");

        yield {
          id: `openclaw:conv:${sessionId}`,
          source: "openclaw",
          type: "document",
          title,
          description: `${lines.length} messages — local session`,
          tags: ["conversation", "openclaw", "ai-agent"],
          uri: join(sessionsDir, file),
          metadata: {
            messageCount: lines.length,
            agentId,
            modified: timestamp,
          },
          indexedAt: new Date().toISOString(),
          content,
        };
        onItem();
      } catch {
        continue;
      }
    }
  }
}

export default connector;

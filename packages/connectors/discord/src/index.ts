import { z } from "zod";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DiscordConfigSchema = z.object({
  /** Env var name holding the bot token (default: DISCORD_TOKEN) */
  token_env: z.string().default("DISCORD_TOKEN"),
  /** Limit indexing to specific guild (server) IDs */
  guild_ids: z.array(z.string()).optional(),
  /** Channel types to index */
  channel_types: z
    .array(z.enum(["text", "forum", "announcement"]))
    .default(["text"]),
  /** Whether to index pinned messages */
  include_pins: z.boolean().default(true),
  /** Max messages to fetch per channel */
  messages_limit: z.number().int().min(1).max(10000).default(500),
  /** Only index messages from the last N days */
  since_days: z.number().int().min(1).default(30),
});

type DiscordConfig = z.infer<typeof DiscordConfigSchema>;

// ---------------------------------------------------------------------------
// Discord API types
// ---------------------------------------------------------------------------

interface DiscordGuild {
  id: string;
  name: string;
}

/** Subset of Discord channel types we care about */
const CHANNEL_TYPE_MAP: Record<string, number[]> = {
  text: [0],
  forum: [15],
  announcement: [5],
};

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  guild_id?: string;
}

interface DiscordUser {
  id: string;
  username: string;
  bot?: boolean;
}

interface DiscordReaction {
  emoji: { name: string };
  count: number;
}

interface DiscordAttachment {
  id: string;
  filename: string;
  url: string;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  attachments: DiscordAttachment[];
  reactions?: DiscordReaction[];
  pinned: boolean;
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

interface RateLimitState {
  remaining: number;
  resetAt: number; // epoch ms
}

function parseRateLimitHeaders(headers: Headers): Partial<RateLimitState> {
  const remaining = headers.get("X-RateLimit-Remaining");
  const reset = headers.get("X-RateLimit-Reset");
  return {
    remaining: remaining !== null ? Number(remaining) : undefined,
    resetAt: reset !== null ? Number(reset) * 1000 : undefined,
  };
}

async function waitForRateLimit(state: RateLimitState): Promise<void> {
  if (state.remaining > 0) return;
  const waitMs = Math.max(0, state.resetAt - Date.now()) + 250; // 250ms buffer
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const BASE_URL = "https://discord.com/api/v10";

async function discordFetch<T>(
  path: string,
  token: string,
  signal?: AbortSignal,
  rateLimit?: RateLimitState,
): Promise<{ data: T; rateLimit: RateLimitState }> {
  if (rateLimit) {
    await waitForRateLimit(rateLimit);
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": "Trove/0.1.0",
    },
    signal,
  });

  if (!response.ok) {
    // Consume body to avoid leak
    await response.text().catch(() => {});

    if (response.status === 429) {
      // Rate limited — parse Retry-After and retry once
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : 5000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return discordFetch<T>(path, token, signal);
    }

    throw new Error(`Discord API error (${response.status}) on ${path}`);
  }

  const rl = parseRateLimitHeaders(response.headers);
  const data = (await response.json()) as T;

  return {
    data,
    rateLimit: {
      remaining: rl.remaining ?? 10,
      resetAt: rl.resetAt ?? Date.now() + 1000,
    },
  };
}

async function fetchGuilds(
  token: string,
  signal?: AbortSignal,
): Promise<DiscordGuild[]> {
  const { data } = await discordFetch<DiscordGuild[]>(
    "/users/@me/guilds",
    token,
    signal,
  );
  return data;
}

async function fetchChannels(
  guildId: string,
  token: string,
  signal?: AbortSignal,
): Promise<DiscordChannel[]> {
  const { data } = await discordFetch<DiscordChannel[]>(
    `/guilds/${guildId}/channels`,
    token,
    signal,
  );
  return data;
}

async function fetchPinnedMessages(
  channelId: string,
  token: string,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const { data } = await discordFetch<DiscordMessage[]>(
    `/channels/${channelId}/pins`,
    token,
    signal,
  );
  return new Set(data.map((m) => m.id));
}

/**
 * Fetch messages from a channel with pagination (newest first, using `before`).
 * Stops when reaching `limit` messages or when messages are older than `sinceDate`.
 */
async function fetchMessages(
  channelId: string,
  token: string,
  limit: number,
  sinceDate: Date,
  signal?: AbortSignal,
): Promise<DiscordMessage[]> {
  const allMessages: DiscordMessage[] = [];
  let before: string | undefined;
  let rl: RateLimitState | undefined;

  while (allMessages.length < limit) {
    if (signal?.aborted) break;

    const remaining = Math.min(100, limit - allMessages.length);
    let path = `/channels/${channelId}/messages?limit=${remaining}`;
    if (before) path += `&before=${before}`;

    const result = await discordFetch<DiscordMessage[]>(path, token, signal, rl);
    rl = result.rateLimit;
    const batch = result.data;

    if (batch.length === 0) break;

    let hitDateLimit = false;
    for (const msg of batch) {
      if (new Date(msg.timestamp) < sinceDate) {
        hitDateLimit = true;
        break;
      }
      allMessages.push(msg);
    }

    if (hitDateLimit) break;
    if (batch.length < remaining) break;

    before = batch[batch.length - 1].id;
  }

  return allMessages;
}

// ---------------------------------------------------------------------------
// URL metadata fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch og:title and og:description from a URL to enrich Discord link messages.
 * Returns null on timeout or error — never blocks indexing.
 */
async function fetchUrlMeta(url: string): Promise<{ title?: string; description?: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Trove/0.1.0 (link preview)" },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();
    // Extract og:title or <title>
    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    // Extract og:description or meta description
    const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1];
    return { title: ogTitle?.trim(), description: ogDesc?.trim() };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function messageToContentItem(
  msg: DiscordMessage,
  guildId: string,
  guildName: string,
  channelName: string,
  isPinned: boolean,
): Promise<ContentItem> {
  const firstLine = msg.content.split("\n")[0]?.trim();
  let title = firstLine && firstLine.length > 0
    ? firstLine.slice(0, 100)
    : `Message in #${channelName}`;

  let description = msg.content.slice(0, 200) || "(no text content)";

  const tags: string[] = [guildName, `#${channelName}`, msg.author.username];
  if (msg.reactions) {
    for (const r of msg.reactions) {
      if (r.emoji.name) tags.push(r.emoji.name);
    }
  }
  if (isPinned) tags.push("pinned");

  // Extract URLs, fetch meta tags, and enrich content
  const urlMatches = msg.content.match(/https?:\/\/[^\s)>]+/g) ?? [];
  const linkPreviews: string[] = [];
  for (const url of urlMatches) {
    try {
      const u = new URL(url);
      tags.push(u.hostname.replace("www.", ""));
      const segments = u.pathname.split("/").filter(s => s.length > 1 && s.length < 40);
      tags.push(...segments);
    } catch { /* invalid URL */ }
    tags.push("link");

    // Fetch page meta for enrichment
    const meta = await fetchUrlMeta(url);
    if (meta) {
      if (meta.title) {
        // Add title words as tags for searchability
        const words = meta.title.toLowerCase().split(/[\s\-_/|:]+/).filter(w => w.length > 2);
        tags.push(...words);
        linkPreviews.push(`[${meta.title}](${url})`);
        // Use page title as item title if message is just a URL
        if (msg.content.trim() === url) {
          title = meta.title.slice(0, 100);
        }
      }
      if (meta.description) {
        const descWords = meta.description.toLowerCase().split(/[\s\-_/|:]+/).filter(w => w.length > 2);
        tags.push(...descWords.slice(0, 15));
        linkPreviews.push(meta.description.slice(0, 200));
        if (description === url || description === "(no text content)") {
          description = meta.description.slice(0, 200);
        }
      }
    }
  }

  const attachmentUrls = msg.attachments.map((a) => a.url);
  const content = msg.content
    + (linkPreviews.length > 0 ? "\n\n--- Link previews ---\n" + linkPreviews.join("\n") : "")
    + (attachmentUrls.length > 0 ? "\n\nAttachments:\n" + attachmentUrls.join("\n") : "");

  return {
    id: `discord:${msg.channel_id}:${msg.id}`,
    source: "discord",
    type: "document",
    title,
    description,
    tags,
    uri: `https://discord.com/channels/${guildId}/${msg.channel_id}/${msg.id}`,
    metadata: {
      author: msg.author.username,
      authorId: msg.author.id,
      timestamp: msg.timestamp,
      attachmentsCount: msg.attachments.length,
      reactions: msg.reactions?.map((r) => ({
        emoji: r.emoji.name,
        count: r.count,
      })) ?? [],
      isPinned,
      guildId,
      guildName,
      channelName,
    },
    indexedAt: new Date().toISOString(),
    content,
  };
}

function getAllowedChannelTypes(types: string[]): Set<number> {
  const allowed = new Set<number>();
  for (const t of types) {
    const nums = CHANNEL_TYPE_MAP[t];
    if (nums) for (const n of nums) allowed.add(n);
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

const connector: Connector = {
  manifest: {
    name: "discord",
    version: "0.1.0",
    description: "Index Discord server messages, pins and attachments",
    configSchema: DiscordConfigSchema,
  },

  async validate(config) {
    const result = DiscordConfigSchema.safeParse(config);
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
          `Environment variable ${parsed.token_env} is not set. A Discord bot token is required.`,
        ],
      };
    }

    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = DiscordConfigSchema.parse(config);
    const token = process.env[parsed.token_env];
    if (!token) {
      throw new Error(
        `Environment variable ${parsed.token_env} is not set. A Discord bot token is required.`,
      );
    }

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - parsed.since_days);

    const allowedTypes = getAllowedChannelTypes(parsed.channel_types);

    // Fetch guilds
    let guilds = await fetchGuilds(token, options.signal);
    if (parsed.guild_ids && parsed.guild_ids.length > 0) {
      const allowed = new Set(parsed.guild_ids);
      guilds = guilds.filter((g) => allowed.has(g.id));
    }

    let indexed = 0;

    for (const guild of guilds) {
      if (options.signal?.aborted) return;

      const channels = await fetchChannels(guild.id, token, options.signal);
      const filteredChannels = channels.filter((c) => allowedTypes.has(c.type));

      for (const channel of filteredChannels) {
        if (options.signal?.aborted) return;

        try {
          // Fetch pinned message IDs if configured
          let pinnedIds = new Set<string>();
          if (parsed.include_pins) {
            pinnedIds = await fetchPinnedMessages(
              channel.id,
              token,
              options.signal,
            );
          }

          // Fetch messages
          const messages = await fetchMessages(
            channel.id,
            token,
            parsed.messages_limit,
            sinceDate,
            options.signal,
          );

          for (const msg of messages) {
            // Skip bot messages
            if (msg.author.bot) continue;

            const item = await messageToContentItem(
              msg,
              guild.id,
              guild.name,
              channel.name,
              pinnedIds.has(msg.id),
            );

            indexed++;
            options.onProgress?.(indexed);
            yield item;
          }
        } catch (err) {
          // Skip channels the bot cannot access (403 Forbidden, 50001 Missing Access)
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("403") || msg.includes("50001")) {
            continue;
          }
          throw err;
        }
      }
    }
  },
};

export default connector;

// Re-export for testing
export {
  DiscordConfigSchema,
  parseRateLimitHeaders,
  messageToContentItem,
  getAllowedChannelTypes,
};
export type {
  DiscordConfig,
  DiscordGuild,
  DiscordChannel,
  DiscordMessage,
  DiscordUser,
  DiscordAttachment,
  DiscordReaction,
};

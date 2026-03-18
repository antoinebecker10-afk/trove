import { z } from "zod";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SlackConfigSchema = z.object({
  /** Env var name holding the Slack Bot/User token (default: SLACK_TOKEN) */
  token_env: z.string().default("SLACK_TOKEN"),
  /** Specific channel names or IDs to index. Empty = all accessible channels */
  channels: z.array(z.string()).optional(),
  /** Index channel bookmarks */
  include_bookmarks: z.boolean().default(true),
  /** Index starred items */
  include_stars: z.boolean().default(true),
  /** Max messages to fetch per channel */
  messages_limit: z.number().int().positive().default(1000),
  /** Only index messages from the last N days */
  since_days: z.number().int().positive().default(30),
});

export type SlackConfig = z.infer<typeof SlackConfigSchema>;

// ---------------------------------------------------------------------------
// Slack API types (minimal, only what we need)
// ---------------------------------------------------------------------------

interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
  is_archived: boolean;
  topic?: { value: string };
  purpose?: { value: string };
}

interface SlackMessage {
  type: string;
  ts: string;
  user?: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{ name: string; count: number }>;
  permalink?: string;
}

interface SlackBookmark {
  id: string;
  channel_id: string;
  title: string;
  link: string;
  emoji?: string;
  type: string;
  created: number;
}

interface SlackStarItem {
  type: string;
  message?: SlackMessage;
  channel?: string;
  file?: { id: string; name: string; permalink: string };
}

interface SlackResponse {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
}

interface ConversationsListResponse extends SlackResponse {
  channels: SlackChannel[];
}

interface ConversationsHistoryResponse extends SlackResponse {
  messages: SlackMessage[];
  has_more: boolean;
}

interface ConversationsRepliesResponse extends SlackResponse {
  messages: SlackMessage[];
}

interface BookmarksListResponse extends SlackResponse {
  bookmarks: SlackBookmark[];
}

interface StarsListResponse extends SlackResponse {
  items: SlackStarItem[];
  paging?: { pages: number; page: number };
}

interface UsersInfoResponse extends SlackResponse {
  user?: { real_name?: string; name?: string };
}

interface ChatPermalinkResponse extends SlackResponse {
  permalink?: string;
}

// ---------------------------------------------------------------------------
// Slack API helpers
// ---------------------------------------------------------------------------

const SLACK_BASE = "https://slack.com/api";

async function slackFetch<T extends SlackResponse>(
  method: string,
  token: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`${SLACK_BASE}/${method}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    signal,
  });

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "5");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return slackFetch<T>(method, token, params, signal);
    }
    throw new Error(`Slack API HTTP error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as T;
  if (!data.ok) {
    throw new Error(`Slack API error in ${method}: ${data.error ?? "unknown"}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// User cache — resolve user IDs to display names
// ---------------------------------------------------------------------------

const userCache = new Map<string, string>();

async function resolveUser(
  userId: string,
  token: string,
  signal?: AbortSignal,
): Promise<string> {
  if (userCache.has(userId)) return userCache.get(userId)!;
  try {
    const res = await slackFetch<UsersInfoResponse>(
      "users.info",
      token,
      { user: userId },
      signal,
    );
    const name = res.user?.real_name ?? res.user?.name ?? userId;
    userCache.set(userId, name);
    return name;
  } catch {
    userCache.set(userId, userId);
    return userId;
  }
}

// ---------------------------------------------------------------------------
// Permalink helper
// ---------------------------------------------------------------------------

async function getPermalink(
  channelId: string,
  messageTs: string,
  token: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const res = await slackFetch<ChatPermalinkResponse>(
      "chat.getPermalink",
      token,
      { channel: channelId, message_ts: messageTs },
      signal,
    );
    return res.permalink ?? "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Paginated fetchers
// ---------------------------------------------------------------------------

async function fetchChannels(
  token: string,
  signal?: AbortSignal,
): Promise<SlackChannel[]> {
  const channels: SlackChannel[] = [];
  let cursor = "";

  do {
    if (signal?.aborted) break;
    const params: Record<string, string> = {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
    };
    if (cursor) params.cursor = cursor;

    const res = await slackFetch<ConversationsListResponse>(
      "conversations.list",
      token,
      params,
      signal,
    );
    channels.push(...res.channels);
    cursor = res.response_metadata?.next_cursor ?? "";
  } while (cursor);

  return channels;
}

async function fetchMessages(
  channelId: string,
  token: string,
  limit: number,
  oldest: string,
  signal?: AbortSignal,
): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];
  let cursor = "";

  do {
    if (signal?.aborted) break;
    const batchSize = Math.min(200, limit - messages.length);
    if (batchSize <= 0) break;

    const params: Record<string, string> = {
      channel: channelId,
      limit: String(batchSize),
      oldest,
    };
    if (cursor) params.cursor = cursor;

    const res = await slackFetch<ConversationsHistoryResponse>(
      "conversations.history",
      token,
      params,
      signal,
    );
    messages.push(...res.messages);
    cursor = res.response_metadata?.next_cursor ?? "";

    if (!res.has_more || messages.length >= limit) break;
  } while (cursor);

  return messages.slice(0, limit);
}

async function fetchThreadReplies(
  channelId: string,
  threadTs: string,
  token: string,
  signal?: AbortSignal,
): Promise<SlackMessage[]> {
  try {
    const res = await slackFetch<ConversationsRepliesResponse>(
      "conversations.replies",
      token,
      { channel: channelId, ts: threadTs, limit: "100" },
      signal,
    );
    // First message is the parent — skip it
    return res.messages.slice(1);
  } catch {
    return [];
  }
}

async function fetchBookmarks(
  channelId: string,
  token: string,
  signal?: AbortSignal,
): Promise<SlackBookmark[]> {
  try {
    const res = await slackFetch<BookmarksListResponse>(
      "bookmarks.list",
      token,
      { channel_id: channelId },
      signal,
    );
    return res.bookmarks;
  } catch {
    // bookmarks.list may not be available for all plans
    return [];
  }
}

async function fetchStars(
  token: string,
  signal?: AbortSignal,
): Promise<SlackStarItem[]> {
  const items: SlackStarItem[] = [];
  let page = 1;

  do {
    if (signal?.aborted) break;
    const res = await slackFetch<StarsListResponse>(
      "stars.list",
      token,
      { count: "100", page: String(page) },
      signal,
    );
    items.push(...res.items);
    const totalPages = res.paging?.pages ?? 1;
    if (page >= totalPages) break;
    page++;
  } while (true);

  return items;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstLine(text: string, max = 120): string {
  const line = text.split("\n")[0].trim();
  return line.length > max ? line.slice(0, max) + "..." : line;
}

function messagePreview(text: string, max = 300): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

const connector: Connector = {
  manifest: {
    name: "slack",
    version: "0.1.0",
    description: "Index Slack messages, bookmarks, and starred items",
    configSchema: SlackConfigSchema,
  },

  async validate(config) {
    const result = SlackConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    const parsed = result.data;
    const token = process.env[parsed.token_env];
    if (!token) {
      return {
        valid: false,
        errors: [`Environment variable ${parsed.token_env} is not set`],
      };
    }
    if (!token.startsWith("xoxb-") && !token.startsWith("xoxp-")) {
      return {
        valid: false,
        errors: [
          `Token in ${parsed.token_env} must be a Slack Bot token (xoxb-) or User token (xoxp-)`,
        ],
      };
    }
    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = SlackConfigSchema.parse(config);
    const token = process.env[parsed.token_env];
    if (!token) {
      throw new Error(`Environment variable ${parsed.token_env} is not set`);
    }

    const sinceTs = String(
      Math.floor(Date.now() / 1000) - parsed.since_days * 86400,
    );

    // Clear user cache between runs
    userCache.clear();

    // ----- Channels -----
    let channels = await fetchChannels(token, options.signal);

    // Filter to requested channels if specified
    if (parsed.channels && parsed.channels.length > 0) {
      const wanted = new Set(parsed.channels.map((c) => c.toLowerCase()));
      channels = channels.filter(
        (ch) =>
          wanted.has(ch.id.toLowerCase()) || wanted.has(ch.name.toLowerCase()),
      );
    }

    let indexed = 0;

    for (const channel of channels) {
      if (options.signal?.aborted) return;

      // ----- Messages -----
      const messages = await fetchMessages(
        channel.id,
        token,
        parsed.messages_limit,
        sinceTs,
        options.signal,
      );

      for (const msg of messages) {
        if (options.signal?.aborted) return;
        // Skip bot join/leave messages etc.
        if (msg.type !== "message" || !msg.text) continue;

        const userName = msg.user
          ? await resolveUser(msg.user, token, options.signal)
          : "unknown";

        // Build content: message text + thread replies
        let content = msg.text;
        if (msg.thread_ts && msg.thread_ts === msg.ts && (msg.reply_count ?? 0) > 0) {
          const replies = await fetchThreadReplies(
            channel.id,
            msg.thread_ts,
            token,
            options.signal,
          );
          for (const reply of replies) {
            const replyUser = reply.user
              ? await resolveUser(reply.user, token, options.signal)
              : "unknown";
            content += `\n[${replyUser}]: ${reply.text}`;
          }
        }

        const permalink = await getPermalink(
          channel.id,
          msg.ts,
          token,
          options.signal,
        );

        const reactionNames = (msg.reactions ?? []).map((r) => r.name);
        const tags = [
          channel.name,
          userName,
          ...reactionNames,
        ];

        const item: ContentItem = {
          id: `slack:${channel.id}:${msg.ts}`,
          source: "slack",
          type: "document",
          title: firstLine(msg.text),
          description: messagePreview(msg.text),
          tags,
          uri: permalink,
          metadata: {
            channel: channel.name,
            channelId: channel.id,
            user: userName,
            userId: msg.user,
            timestamp: msg.ts,
            reactions: msg.reactions ?? [],
            threadTs: msg.thread_ts,
            replyCount: msg.reply_count ?? 0,
          },
          indexedAt: new Date().toISOString(),
          content,
        };

        indexed++;
        options.onProgress?.(indexed);
        yield item;
      }

      // ----- Bookmarks -----
      if (parsed.include_bookmarks) {
        const bookmarks = await fetchBookmarks(
          channel.id,
          token,
          options.signal,
        );

        for (const bm of bookmarks) {
          if (options.signal?.aborted) return;

          const item: ContentItem = {
            id: `slack:bookmark:${bm.id}`,
            source: "slack",
            type: "bookmark",
            title: bm.title,
            description: `Bookmark in #${channel.name}: ${bm.title}`,
            tags: [channel.name, bm.type],
            uri: bm.link,
            metadata: {
              channel: channel.name,
              channelId: channel.id,
              bookmarkType: bm.type,
              emoji: bm.emoji,
              created: bm.created,
            },
            indexedAt: new Date().toISOString(),
          };

          indexed++;
          options.onProgress?.(indexed);
          yield item;
        }
      }
    }

    // ----- Stars -----
    if (parsed.include_stars) {
      const stars = await fetchStars(token, options.signal);

      for (const star of stars) {
        if (options.signal?.aborted) return;

        if (star.type === "message" && star.message && star.channel) {
          const userName = star.message.user
            ? await resolveUser(star.message.user, token, options.signal)
            : "unknown";

          const permalink = await getPermalink(
            star.channel,
            star.message.ts,
            token,
            options.signal,
          );

          const item: ContentItem = {
            id: `slack:star:${star.channel}:${star.message.ts}`,
            source: "slack",
            type: "document",
            title: `[Starred] ${firstLine(star.message.text)}`,
            description: messagePreview(star.message.text),
            tags: ["starred", userName],
            uri: permalink,
            metadata: {
              channel: star.channel,
              user: userName,
              userId: star.message.user,
              timestamp: star.message.ts,
              reactions: star.message.reactions ?? [],
            },
            indexedAt: new Date().toISOString(),
            content: star.message.text,
          };

          indexed++;
          options.onProgress?.(indexed);
          yield item;
        } else if (star.type === "file" && star.file) {
          const item: ContentItem = {
            id: `slack:star:file:${star.file.id}`,
            source: "slack",
            type: "document",
            title: `[Starred] ${star.file.name}`,
            description: `Starred file: ${star.file.name}`,
            tags: ["starred", "file"],
            uri: star.file.permalink,
            metadata: {
              fileId: star.file.id,
              fileName: star.file.name,
            },
            indexedAt: new Date().toISOString(),
          };

          indexed++;
          options.onProgress?.(indexed);
          yield item;
        }
      }
    }
  },
};

export default connector;
export { SlackConfigSchema, slackFetch };

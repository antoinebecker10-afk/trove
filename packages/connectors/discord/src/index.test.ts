import { describe, it, expect, vi, beforeEach } from "vitest";
import connector, {
  DiscordConfigSchema,
  parseRateLimitHeaders,
  messageToContentItem,
  getAllowedChannelTypes,
} from "./index.js";
import type {
  DiscordMessage,
  DiscordGuild,
  DiscordChannel,
} from "./index.js";

// ---------------------------------------------------------------------------
// Unit tests — pure functions
// ---------------------------------------------------------------------------

describe("DiscordConfigSchema", () => {
  it("applies defaults for minimal config", () => {
    const result = DiscordConfigSchema.parse({});
    expect(result.token_env).toBe("DISCORD_TOKEN");
    expect(result.channel_types).toEqual(["text"]);
    expect(result.include_pins).toBe(true);
    expect(result.messages_limit).toBe(500);
    expect(result.since_days).toBe(30);
    expect(result.guild_ids).toBeUndefined();
  });

  it("accepts full config", () => {
    const result = DiscordConfigSchema.parse({
      token_env: "MY_DISCORD_TOKEN",
      guild_ids: ["111", "222"],
      channel_types: ["text", "forum"],
      include_pins: false,
      messages_limit: 100,
      since_days: 7,
    });
    expect(result.guild_ids).toEqual(["111", "222"]);
    expect(result.include_pins).toBe(false);
  });

  it("rejects invalid channel type", () => {
    expect(() =>
      DiscordConfigSchema.parse({ channel_types: ["voice"] }),
    ).toThrow();
  });

  it("rejects messages_limit out of range", () => {
    expect(() =>
      DiscordConfigSchema.parse({ messages_limit: 0 }),
    ).toThrow();
    expect(() =>
      DiscordConfigSchema.parse({ messages_limit: 99999 }),
    ).toThrow();
  });
});

describe("parseRateLimitHeaders", () => {
  it("extracts remaining and reset", () => {
    const headers = new Headers({
      "X-RateLimit-Remaining": "3",
      "X-RateLimit-Reset": "1700000000",
    });
    const result = parseRateLimitHeaders(headers);
    expect(result.remaining).toBe(3);
    expect(result.resetAt).toBe(1700000000000);
  });

  it("returns undefined when headers are absent", () => {
    const headers = new Headers({});
    const result = parseRateLimitHeaders(headers);
    expect(result.remaining).toBeUndefined();
    expect(result.resetAt).toBeUndefined();
  });
});

describe("getAllowedChannelTypes", () => {
  it("maps text to type 0", () => {
    expect(getAllowedChannelTypes(["text"])).toEqual(new Set([0]));
  });

  it("maps multiple types", () => {
    const result = getAllowedChannelTypes(["text", "forum", "announcement"]);
    expect(result).toEqual(new Set([0, 15, 5]));
  });

  it("ignores unknown types", () => {
    expect(getAllowedChannelTypes(["unknown" as string])).toEqual(new Set());
  });
});

describe("messageToContentItem", () => {
  const baseMsg: DiscordMessage = {
    id: "msg1",
    channel_id: "ch1",
    author: { id: "u1", username: "alice" },
    content: "Hello world\nSecond line here",
    timestamp: "2025-01-15T10:00:00.000Z",
    attachments: [],
    reactions: [{ emoji: { name: "thumbsup" }, count: 3 }],
    pinned: false,
  };

  it("builds correct id and uri", () => {
    const item = messageToContentItem(baseMsg, "g1", "MyServer", "general", false);
    expect(item.id).toBe("discord:ch1:msg1");
    expect(item.uri).toBe("https://discord.com/channels/g1/ch1/msg1");
  });

  it("uses first line as title", () => {
    const item = messageToContentItem(baseMsg, "g1", "MyServer", "general", false);
    expect(item.title).toBe("Hello world");
  });

  it("falls back to channel name when content is empty", () => {
    const emptyMsg = { ...baseMsg, content: "" };
    const item = messageToContentItem(emptyMsg, "g1", "MyServer", "general", false);
    expect(item.title).toBe("Message in #general");
  });

  it("truncates description to 200 chars", () => {
    const longMsg = { ...baseMsg, content: "x".repeat(300) };
    const item = messageToContentItem(longMsg, "g1", "MyServer", "general", false);
    expect(item.description.length).toBe(200);
  });

  it("includes tags: server, channel, author, reactions, pinned", () => {
    const item = messageToContentItem(baseMsg, "g1", "MyServer", "general", true);
    expect(item.tags).toContain("MyServer");
    expect(item.tags).toContain("#general");
    expect(item.tags).toContain("alice");
    expect(item.tags).toContain("thumbsup");
    expect(item.tags).toContain("pinned");
  });

  it("appends attachment URLs to content", () => {
    const msgWithAttach: DiscordMessage = {
      ...baseMsg,
      attachments: [
        { id: "a1", filename: "file.png", url: "https://cdn.discord.com/file.png" },
      ],
    };
    const item = messageToContentItem(msgWithAttach, "g1", "MyServer", "general", false);
    expect(item.content).toContain("https://cdn.discord.com/file.png");
    expect((item.metadata as Record<string, unknown>).attachmentsCount).toBe(1);
  });

  it("sets source and type correctly", () => {
    const item = messageToContentItem(baseMsg, "g1", "MyServer", "general", false);
    expect(item.source).toBe("discord");
    expect(item.type).toBe("document");
  });

  it("stores metadata fields", () => {
    const item = messageToContentItem(baseMsg, "g1", "MyServer", "general", true);
    const meta = item.metadata as Record<string, unknown>;
    expect(meta.author).toBe("alice");
    expect(meta.timestamp).toBe("2025-01-15T10:00:00.000Z");
    expect(meta.isPinned).toBe(true);
    expect(meta.guildName).toBe("MyServer");
  });
});

// ---------------------------------------------------------------------------
// Connector manifest & validate
// ---------------------------------------------------------------------------

describe("connector.manifest", () => {
  it("has correct name and version", () => {
    expect(connector.manifest.name).toBe("discord");
    expect(connector.manifest.version).toBe("0.1.0");
  });
});

describe("connector.validate", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns valid when token env is set", async () => {
    vi.stubEnv("DISCORD_TOKEN", "test-token");
    const result = await connector.validate({});
    expect(result.valid).toBe(true);
  });

  it("returns error when token env is missing", async () => {
    delete process.env.DISCORD_TOKEN;
    const result = await connector.validate({});
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain("DISCORD_TOKEN");
  });

  it("returns error for invalid config", async () => {
    const result = await connector.validate({ channel_types: ["voice"] });
    expect(result.valid).toBe(false);
  });

  it("checks custom token_env", async () => {
    vi.stubEnv("MY_TOKEN", "tok");
    const result = await connector.validate({ token_env: "MY_TOKEN" });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Connector.index — integration test with mocked fetch
// ---------------------------------------------------------------------------

describe("connector.index", () => {
  const guilds: DiscordGuild[] = [{ id: "g1", name: "TestServer" }];
  const channels: DiscordChannel[] = [
    { id: "ch1", name: "general", type: 0, guild_id: "g1" },
    { id: "ch2", name: "voice-chat", type: 2, guild_id: "g1" }, // voice, should be skipped
  ];
  const messages: DiscordMessage[] = [
    {
      id: "m1",
      channel_id: "ch1",
      author: { id: "u1", username: "alice" },
      content: "Hello from Discord!",
      timestamp: new Date().toISOString(),
      attachments: [],
      pinned: false,
    },
    {
      id: "m2",
      channel_id: "ch1",
      author: { id: "u2", username: "bot-user", bot: true },
      content: "I am a bot",
      timestamp: new Date().toISOString(),
      attachments: [],
      pinned: false,
    },
  ];
  const pins: DiscordMessage[] = [
    { ...messages[0], pinned: true },
  ];

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("DISCORD_TOKEN", "fake-token");
    vi.restoreAllMocks();
  });

  function mockFetch() {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();

      let body: unknown;

      if (url.includes("/users/@me/guilds")) {
        body = guilds;
      } else if (url.includes("/guilds/g1/channels")) {
        body = channels;
      } else if (url.includes("/channels/ch1/pins")) {
        body = pins;
      } else if (url.includes("/channels/ch1/messages")) {
        body = messages;
      } else {
        body = [];
      }

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": "10",
          "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
        },
      });
    });
  }

  it("yields only non-bot messages", async () => {
    mockFetch();
    const items: unknown[] = [];
    for await (const item of connector.index({}, { signal: undefined })) {
      items.push(item);
    }
    // Only alice's message, bot is skipped
    expect(items).toHaveLength(1);
    expect((items[0] as { id: string }).id).toBe("discord:ch1:m1");
  });

  it("filters guilds by guild_ids config", async () => {
    mockFetch();
    const items: unknown[] = [];
    for await (const item of connector.index(
      { guild_ids: ["other-guild"] },
      { signal: undefined },
    )) {
      items.push(item);
    }
    expect(items).toHaveLength(0);
  });

  it("skips non-text channels", async () => {
    const spy = mockFetch();
    const items: unknown[] = [];
    for await (const item of connector.index({}, { signal: undefined })) {
      items.push(item);
    }
    // Should never fetch messages for ch2 (voice)
    const messageRequests = spy.mock.calls.filter(([url]) =>
      String(url).includes("/channels/ch2/messages"),
    );
    expect(messageRequests).toHaveLength(0);
  });

  it("marks pinned messages", async () => {
    mockFetch();
    const items: unknown[] = [];
    for await (const item of connector.index({}, { signal: undefined })) {
      items.push(item);
    }
    const first = items[0] as { metadata: Record<string, unknown>; tags: string[] };
    expect(first.metadata.isPinned).toBe(true);
    expect(first.tags).toContain("pinned");
  });

  it("calls onProgress", async () => {
    mockFetch();
    const progress = vi.fn();
    const items: unknown[] = [];
    for await (const item of connector.index({}, { onProgress: progress })) {
      items.push(item);
    }
    expect(progress).toHaveBeenCalledWith(1);
  });

  it("respects abort signal", async () => {
    mockFetch();
    const controller = new AbortController();
    controller.abort();
    const items: unknown[] = [];
    for await (const item of connector.index(
      {},
      { signal: controller.signal },
    )) {
      items.push(item);
    }
    expect(items).toHaveLength(0);
  });

  it("throws when token is missing", async () => {
    delete process.env.DISCORD_TOKEN;
    const gen = connector.index({}, {});
    await expect(gen.next()).rejects.toThrow("DISCORD_TOKEN");
  });
});

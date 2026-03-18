import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { IndexOptions } from "@trove/shared";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CHANNELS = [
  {
    id: "C001",
    name: "general",
    is_member: true,
    is_archived: false,
    topic: { value: "General discussion" },
  },
  {
    id: "C002",
    name: "random",
    is_member: true,
    is_archived: false,
    topic: { value: "Random stuff" },
  },
];

const MOCK_MESSAGES = [
  {
    type: "message",
    ts: "1700000001.000100",
    user: "U001",
    text: "Hello world!\nThis is a multi-line message.",
    reactions: [{ name: "thumbsup", count: 2 }],
  },
  {
    type: "message",
    ts: "1700000002.000200",
    user: "U002",
    text: "Thread starter",
    thread_ts: "1700000002.000200",
    reply_count: 1,
  },
  {
    type: "message",
    ts: "1700000003.000300",
    user: undefined,
    text: "", // empty — should be skipped
  },
];

const MOCK_REPLIES = [
  {
    type: "message",
    ts: "1700000002.000200",
    user: "U002",
    text: "Thread starter",
  },
  {
    type: "message",
    ts: "1700000002.000201",
    user: "U001",
    text: "Thread reply",
  },
];

const MOCK_BOOKMARKS = [
  {
    id: "BM001",
    channel_id: "C001",
    title: "Important Link",
    link: "https://example.com",
    type: "link",
    created: 1700000000,
  },
];

const MOCK_STARS = [
  {
    type: "message",
    channel: "C001",
    message: {
      type: "message",
      ts: "1700000010.000100",
      user: "U001",
      text: "Starred message content",
      reactions: [],
    },
  },
  {
    type: "file",
    file: {
      id: "F001",
      name: "design.png",
      permalink: "https://slack.com/files/F001",
    },
  },
];

const MOCK_USERS: Record<string, { real_name: string; name: string }> = {
  U001: { real_name: "Alice", name: "alice" },
  U002: { real_name: "Bob", name: "bob" },
};

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

function createFetchMock() {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    const method = u.pathname.replace("/api/", "");

    let body: Record<string, unknown>;

    switch (method) {
      case "conversations.list":
        body = { ok: true, channels: MOCK_CHANNELS };
        break;
      case "conversations.history":
        body = { ok: true, messages: MOCK_MESSAGES, has_more: false };
        break;
      case "conversations.replies":
        body = { ok: true, messages: MOCK_REPLIES };
        break;
      case "bookmarks.list":
        body = { ok: true, bookmarks: MOCK_BOOKMARKS };
        break;
      case "stars.list":
        body = { ok: true, items: MOCK_STARS, paging: { pages: 1, page: 1 } };
        break;
      case "users.info": {
        const userId = u.searchParams.get("user") ?? "";
        const user = MOCK_USERS[userId];
        body = user
          ? { ok: true, user }
          : { ok: false, error: "user_not_found" };
        break;
      }
      case "chat.getPermalink": {
        const ch = u.searchParams.get("channel");
        const ts = u.searchParams.get("message_ts");
        body = {
          ok: true,
          permalink: `https://workspace.slack.com/archives/${ch}/p${ts?.replace(".", "")}`,
        };
        break;
      }
      default:
        body = { ok: false, error: "unknown_method" };
    }

    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => body,
      text: async (): Promise<string> => JSON.stringify(body),
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("@trove/connector-slack", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof createFetchMock>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = createFetchMock();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    process.env.SLACK_TOKEN = "xoxb-test-token-12345";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SLACK_TOKEN;
  });

  // Lazy import so the module picks up the mocked fetch
  async function loadConnector() {
    const mod = await import("./index.js");
    return mod.default;
  }

  describe("validate", () => {
    it("passes with valid config and token set", async () => {
      const connector = await loadConnector();
      const result = await connector.validate({});
      expect(result.valid).toBe(true);
    });

    it("fails when token env var is missing", async () => {
      delete process.env.SLACK_TOKEN;
      const connector = await loadConnector();
      const result = await connector.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("SLACK_TOKEN");
    });

    it("fails when token has wrong prefix", async () => {
      process.env.SLACK_TOKEN = "invalid-token";
      const connector = await loadConnector();
      const result = await connector.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("xoxb-");
    });

    it("fails with invalid config shape", async () => {
      const connector = await loadConnector();
      const result = await connector.validate({ messages_limit: -5 });
      expect(result.valid).toBe(false);
    });

    it("accepts custom token_env", async () => {
      process.env.MY_SLACK = "xoxp-custom-token";
      const connector = await loadConnector();
      const result = await connector.validate({ token_env: "MY_SLACK" });
      expect(result.valid).toBe(true);
      delete process.env.MY_SLACK;
    });
  });

  describe("index — messages", () => {
    it("yields message items with correct fields", async () => {
      const connector = await loadConnector();
      const opts: IndexOptions = {};
      const items = [];

      for await (const item of connector.index(
        { include_bookmarks: false, include_stars: false },
        opts,
      )) {
        if (item.id.startsWith("slack:C")) items.push(item);
      }

      // 2 channels x messages — but empty messages are skipped, and each
      // channel gets the same mock messages (2 valid ones), so 2 * 2 = 4
      expect(items.length).toBe(4);

      const first = items[0];
      expect(first.source).toBe("slack");
      expect(first.type).toBe("document");
      expect(first.id).toBe("slack:C001:1700000001.000100");
      expect(first.title).toBe("Hello world!");
      expect(first.tags).toContain("general");
      expect(first.tags).toContain("Alice");
      expect(first.tags).toContain("thumbsup");
      expect(first.metadata.channel).toBe("general");
      expect(first.metadata.user).toBe("Alice");
      expect(first.uri).toContain("slack.com");
      expect(first.content).toBe("Hello world!\nThis is a multi-line message.");
    });

    it("includes thread replies in content", async () => {
      const connector = await loadConnector();
      const items = [];

      for await (const item of connector.index(
        { include_bookmarks: false, include_stars: false },
        {},
      )) {
        if (item.id === "slack:C001:1700000002.000200") {
          items.push(item);
        }
      }

      expect(items.length).toBe(1);
      expect(items[0].content).toContain("Thread reply");
      expect(items[0].content).toContain("[Alice]");
    });

    it("filters to specified channels", async () => {
      const connector = await loadConnector();
      const items = [];

      for await (const item of connector.index(
        { channels: ["general"], include_bookmarks: false, include_stars: false },
        {},
      )) {
        items.push(item);
      }

      // Only general channel messages (2 valid)
      expect(items.length).toBe(2);
      expect(items.every((i) => i.tags.includes("general"))).toBe(true);
    });
  });

  describe("index — bookmarks", () => {
    it("yields bookmark items", async () => {
      const connector = await loadConnector();
      const items = [];

      for await (const item of connector.index(
        { include_stars: false, channels: ["general"] },
        {},
      )) {
        if (item.type === "bookmark") items.push(item);
      }

      expect(items.length).toBe(1);
      expect(items[0].id).toBe("slack:bookmark:BM001");
      expect(items[0].title).toBe("Important Link");
      expect(items[0].uri).toBe("https://example.com");
      expect(items[0].tags).toContain("general");
    });

    it("skips bookmarks when include_bookmarks is false", async () => {
      const connector = await loadConnector();
      const items = [];

      for await (const item of connector.index(
        { include_bookmarks: false, include_stars: false },
        {},
      )) {
        if (item.type === "bookmark") items.push(item);
      }

      expect(items.length).toBe(0);
    });
  });

  describe("index — stars", () => {
    it("yields starred message and file items", async () => {
      const connector = await loadConnector();
      const items = [];

      for await (const item of connector.index(
        { include_bookmarks: false, channels: ["nonexistent"] },
        {},
      )) {
        if (item.id.startsWith("slack:star:")) items.push(item);
      }

      expect(items.length).toBe(2);

      const starredMsg = items.find((i) => i.id.includes("1700000010"));
      expect(starredMsg).toBeDefined();
      expect(starredMsg!.title).toContain("[Starred]");
      expect(starredMsg!.content).toBe("Starred message content");

      const starredFile = items.find((i) => i.id.includes("file:F001"));
      expect(starredFile).toBeDefined();
      expect(starredFile!.title).toContain("design.png");
    });

    it("skips stars when include_stars is false", async () => {
      const connector = await loadConnector();
      const items = [];

      for await (const item of connector.index(
        { include_bookmarks: false, include_stars: false },
        {},
      )) {
        if (item.id.startsWith("slack:star:")) items.push(item);
      }

      expect(items.length).toBe(0);
    });
  });

  describe("index — abort", () => {
    it("respects abort signal", async () => {
      const connector = await loadConnector();
      const controller = new AbortController();
      const items = [];

      // Abort after first item
      let count = 0;
      for await (const item of connector.index(
        { include_bookmarks: false, include_stars: false },
        { signal: controller.signal },
      )) {
        items.push(item);
        count++;
        if (count >= 1) controller.abort();
      }

      // Should have stopped early
      expect(items.length).toBeLessThanOrEqual(2);
    });
  });

  describe("index — progress", () => {
    it("calls onProgress callback", async () => {
      const connector = await loadConnector();
      const progressCalls: number[] = [];

      for await (const _item of connector.index(
        { include_bookmarks: false, include_stars: false, channels: ["general"] },
        { onProgress: (n) => progressCalls.push(n) },
      )) {
        // consume
      }

      expect(progressCalls.length).toBeGreaterThan(0);
      // Should be monotonically increasing
      for (let i = 1; i < progressCalls.length; i++) {
        expect(progressCalls[i]).toBeGreaterThan(progressCalls[i - 1]);
      }
    });
  });

  describe("manifest", () => {
    it("has correct manifest fields", async () => {
      const connector = await loadConnector();
      expect(connector.manifest.name).toBe("slack");
      expect(connector.manifest.version).toBe("0.1.0");
      expect(connector.manifest.configSchema).toBeDefined();
    });
  });

  describe("rate limiting", () => {
    it("retries on 429 response", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn(async (url: string) => {
        const u = new URL(url);
        const method = u.pathname.replace("/api/", "");

        if (method === "conversations.list" && callCount === 0) {
          callCount++;
          return {
            ok: false,
            status: 429,
            headers: new Headers({ "Retry-After": "0" }),
            json: async () => ({ ok: false }),
            text: async (): Promise<string> => "rate limited",
          };
        }

        // Delegate to normal mock for retries
        return mockFetch(url);
      }) as unknown as typeof fetch;

      const connector = await loadConnector();
      const items = [];
      for await (const item of connector.index(
        { include_bookmarks: false, include_stars: false, channels: ["general"] },
        {},
      )) {
        items.push(item);
      }

      // Should succeed after retry
      expect(items.length).toBeGreaterThan(0);
    });
  });
});

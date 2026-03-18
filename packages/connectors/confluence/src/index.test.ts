import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import connector from "./index.js";
import type { IndexOptions, ContentItem } from "@trove/shared";

function mockFetch(responses: Map<string, unknown>) {
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    for (const [pattern, body] of responses) {
      if (urlStr.includes(pattern)) {
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
          headers: new Headers(),
        } as Response;
      }
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => "Not found",
      headers: new Headers(),
    } as Response;
  });
}

const DOMAIN = "testco";

const FAKE_SPACE = {
  id: "space-1",
  key: "ENG",
  name: "Engineering",
};

const FAKE_PAGE = {
  id: "page-101",
  title: "Getting Started",
  status: "current",
  spaceId: "space-1",
  _links: { webui: "/spaces/ENG/pages/101/Getting+Started" },
};

const FAKE_BLOG = {
  id: "blog-201",
  title: "Release Notes v2",
  status: "current",
  spaceId: "space-1",
  _links: { webui: "/spaces/ENG/blog/201/Release+Notes" },
};

const FAKE_PAGE_CONTENT = {
  id: "page-101",
  title: "Getting Started",
  body: {
    storage: {
      value: "<p>Hello <strong>world</strong>!</p><p>Welcome &amp; enjoy.</p>",
    },
  },
};

const FAKE_LABELS = {
  results: [{ name: "onboarding" }, { name: "guide" }],
};

describe("connector-confluence", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.CONFLUENCE_TOKEN = "fake_token";
    process.env.CONFLUENCE_EMAIL = "user@example.com";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe("manifest", () => {
    it("has correct name and version", () => {
      expect(connector.manifest.name).toBe("confluence");
      expect(connector.manifest.version).toBe("0.1.0");
    });
  });

  describe("validate", () => {
    it("returns valid for correct config", async () => {
      const result = await connector.validate({ domain: DOMAIN });
      expect(result.valid).toBe(true);
    });

    it("returns invalid when domain is missing", async () => {
      const result = await connector.validate({});
      expect(result.valid).toBe(false);
    });

    it("returns invalid when token env is missing", async () => {
      delete process.env.CONFLUENCE_TOKEN;
      const result = await connector.validate({ domain: DOMAIN });
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain("CONFLUENCE_TOKEN");
    });

    it("returns invalid when email env is missing", async () => {
      delete process.env.CONFLUENCE_EMAIL;
      const result = await connector.validate({ domain: DOMAIN });
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain("CONFLUENCE_EMAIL");
    });

    it("respects custom env var names", async () => {
      delete process.env.CONFLUENCE_TOKEN;
      delete process.env.CONFLUENCE_EMAIL;
      process.env.MY_TOKEN = "tok";
      process.env.MY_EMAIL = "me@co.com";
      const result = await connector.validate({
        domain: DOMAIN,
        token_env: "MY_TOKEN",
        email_env: "MY_EMAIL",
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("index", () => {
    it("yields content items from pages and blog posts", async () => {
      const responses = new Map<string, unknown>();
      responses.set("/spaces?", { results: [FAKE_SPACE], _links: {} });
      responses.set("/pages?", { results: [FAKE_PAGE], _links: {} });
      responses.set("/blogposts?", { results: [FAKE_BLOG], _links: {} });
      responses.set(`/pages/${FAKE_PAGE.id}?body-format`, FAKE_PAGE_CONTENT);
      responses.set(`/pages/${FAKE_PAGE.id}/labels`, FAKE_LABELS);
      // Blog content/labels
      responses.set(`/pages/${FAKE_BLOG.id}?body-format`, {
        id: FAKE_BLOG.id,
        title: FAKE_BLOG.title,
        body: { storage: { value: "<h1>Release</h1><p>New features</p>" } },
      });
      responses.set(`/pages/${FAKE_BLOG.id}/labels`, { results: [] });

      globalThis.fetch = mockFetch(responses);

      const items: ContentItem[] = [];
      for await (const item of connector.index({ domain: DOMAIN }, {})) {
        items.push(item);
      }

      expect(items).toHaveLength(2);

      // Check page item
      const pageItem = items.find((i) => i.id === "confluence:page-101")!;
      expect(pageItem.source).toBe("confluence");
      expect(pageItem.type).toBe("document");
      expect(pageItem.title).toBe("Getting Started");
      expect(pageItem.tags).toContain("Engineering");
      expect(pageItem.tags).toContain("onboarding");
      expect(pageItem.tags).toContain("guide");
      expect(pageItem.uri).toContain("testco.atlassian.net/wiki");
      expect(pageItem.content).toContain("Hello world!");
      expect(pageItem.content).toContain("Welcome & enjoy.");
      // HTML tags should be stripped
      expect(pageItem.content).not.toContain("<p>");
      expect(pageItem.content).not.toContain("<strong>");
    });

    it("filters by space_keys", async () => {
      const otherSpace = { id: "space-2", key: "HR", name: "Human Resources" };
      const otherPage = {
        id: "page-301",
        title: "HR Policy",
        status: "current",
        spaceId: "space-2",
        _links: { webui: "/spaces/HR/pages/301" },
      };

      const responses = new Map<string, unknown>();
      responses.set("/spaces?", { results: [FAKE_SPACE, otherSpace], _links: {} });
      responses.set("/pages?", { results: [FAKE_PAGE, otherPage], _links: {} });
      responses.set("/blogposts?", { results: [], _links: {} });
      responses.set(`/pages/${FAKE_PAGE.id}?body-format`, FAKE_PAGE_CONTENT);
      responses.set(`/pages/${FAKE_PAGE.id}/labels`, { results: [] });

      globalThis.fetch = mockFetch(responses);

      const items: ContentItem[] = [];
      for await (const item of connector.index({ domain: DOMAIN, space_keys: ["ENG"] }, {})) {
        items.push(item);
      }

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("Getting Started");
    });

    it("calls onProgress with correct total", async () => {
      const responses = new Map<string, unknown>();
      responses.set("/spaces?", { results: [FAKE_SPACE], _links: {} });
      responses.set("/pages?", { results: [FAKE_PAGE], _links: {} });
      responses.set("/blogposts?", { results: [], _links: {} });
      responses.set(`/pages/${FAKE_PAGE.id}?body-format`, FAKE_PAGE_CONTENT);
      responses.set(`/pages/${FAKE_PAGE.id}/labels`, { results: [] });

      globalThis.fetch = mockFetch(responses);

      const progress = vi.fn();
      const items: ContentItem[] = [];
      for await (const item of connector.index({ domain: DOMAIN }, { onProgress: progress })) {
        items.push(item);
      }

      expect(progress).toHaveBeenCalledWith(1, 1);
    });

    it("throws when token env is missing", async () => {
      delete process.env.CONFLUENCE_TOKEN;
      const gen = connector.index({ domain: DOMAIN }, {});
      await expect(gen.next()).rejects.toThrow("CONFLUENCE_TOKEN");
    });

    it("throws when email env is missing", async () => {
      delete process.env.CONFLUENCE_EMAIL;
      const gen = connector.index({ domain: DOMAIN }, {});
      await expect(gen.next()).rejects.toThrow("CONFLUENCE_EMAIL");
    });
  });

  describe("stripHtmlTags (via content)", () => {
    it("strips HTML entities correctly", async () => {
      const responses = new Map<string, unknown>();
      responses.set("/spaces?", { results: [FAKE_SPACE], _links: {} });
      responses.set("/pages?", { results: [FAKE_PAGE], _links: {} });
      responses.set("/blogposts?", { results: [], _links: {} });
      responses.set(`/pages/${FAKE_PAGE.id}?body-format`, {
        id: FAKE_PAGE.id,
        body: { storage: { value: "A &lt; B &gt; C &amp; D &quot;E&quot; F&#39;s" } },
      });
      responses.set(`/pages/${FAKE_PAGE.id}/labels`, { results: [] });

      globalThis.fetch = mockFetch(responses);

      const items: ContentItem[] = [];
      for await (const item of connector.index({ domain: DOMAIN }, {})) {
        items.push(item);
      }

      expect(items[0].content).toBe("A < B > C & D \"E\" F's");
    });
  });
});

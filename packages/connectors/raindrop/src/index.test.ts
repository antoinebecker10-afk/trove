import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import connector from "./index.js";

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

const FAKE_TOKEN = "raindrop-test-token-1234";

function mockJsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers(),
  } as unknown as Response;
}

const sampleBookmark = {
  _id: 12345,
  title: "TypeScript Handbook",
  excerpt: "The TypeScript Handbook is a comprehensive guide to the language.",
  link: "https://www.typescriptlang.org/docs/handbook/",
  domain: "typescriptlang.org",
  created: "2025-01-10T08:00:00Z",
  type: "article",
  tags: ["typescript", "docs"],
  highlights: ["TypeScript is a typed superset of JavaScript"],
  collection: { $id: 100 },
};

const sampleBookmark2 = {
  _id: 67890,
  title: "Rust Book",
  excerpt: "The Rust Programming Language book.",
  link: "https://doc.rust-lang.org/book/",
  domain: "doc.rust-lang.org",
  created: "2025-02-05T14:00:00Z",
  type: "link",
  tags: ["rust"],
  highlights: [],
  collection: { $id: 200 },
};

const collectionsResponse = {
  result: true,
  items: [
    { _id: 100, title: "Programming", count: 10 },
    { _id: 200, title: "Learning", count: 5 },
  ],
};

describe("connector-raindrop", () => {
  describe("manifest", () => {
    it("has correct name and version", () => {
      expect(connector.manifest.name).toBe("raindrop");
      expect(connector.manifest.version).toBe("0.1.0");
    });
  });

  describe("validate", () => {
    beforeEach(() => {
      vi.stubEnv("RAINDROP_TOKEN", FAKE_TOKEN);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("accepts valid config with defaults", async () => {
      const result = await connector.validate({});
      expect(result.valid).toBe(true);
    });

    it("accepts config with collection_ids", async () => {
      const result = await connector.validate({
        collection_ids: [100, 200],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects when token env var is not set", async () => {
      delete process.env.RAINDROP_TOKEN;
      const result = await connector.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("RAINDROP_TOKEN");
    });
  });

  describe("index", () => {
    beforeEach(() => {
      vi.stubEnv("RAINDROP_TOKEN", FAKE_TOKEN);
      vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it("indexes bookmarks from all collections", async () => {
      vi.mocked(fetch)
        // collections call
        .mockResolvedValueOnce(mockJsonResponse(collectionsResponse))
        // raindrops/0 call (all bookmarks)
        .mockResolvedValueOnce(mockJsonResponse({
          result: true,
          items: [sampleBookmark, sampleBookmark2],
          count: 2,
        }));

      const items = await collect(connector.index({}, { signal: undefined }));

      expect(items).toHaveLength(2);

      const tsItem = items.find((i) => i.title === "TypeScript Handbook")!;
      expect(tsItem.id).toBe("raindrop:12345");
      expect(tsItem.source).toBe("raindrop");
      expect(tsItem.type).toBe("bookmark");
      expect(tsItem.uri).toBe("https://www.typescriptlang.org/docs/handbook/");
      expect(tsItem.tags).toContain("typescript");
      expect(tsItem.tags).toContain("docs");
      expect(tsItem.tags).toContain("Programming"); // collection name
      expect(tsItem.metadata.domain).toBe("typescriptlang.org");
      expect(tsItem.metadata.type).toBe("article");
      expect(tsItem.content).toContain("comprehensive guide");
      expect(tsItem.content).toContain("typed superset");

      const rustItem = items.find((i) => i.title === "Rust Book")!;
      expect(rustItem.id).toBe("raindrop:67890");
      expect(rustItem.tags).toContain("Learning");
      expect(rustItem.metadata.highlights).toEqual([]);
    });

    it("indexes specific collections only", async () => {
      vi.mocked(fetch)
        // collections call
        .mockResolvedValueOnce(mockJsonResponse(collectionsResponse))
        // raindrops/100 call
        .mockResolvedValueOnce(mockJsonResponse({
          result: true,
          items: [sampleBookmark],
          count: 1,
        }));

      const items = await collect(
        connector.index({ collection_ids: [100] }, { signal: undefined }),
      );

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("TypeScript Handbook");

      // Verify we called the correct collection endpoint
      const fetchCalls = vi.mocked(fetch).mock.calls;
      const raindropCall = fetchCalls.find((c) =>
        (c[0] as string).includes("/raindrops/100"),
      );
      expect(raindropCall).toBeDefined();
    });

    it("deduplicates bookmarks across collections", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockJsonResponse(collectionsResponse))
        // Collection 100
        .mockResolvedValueOnce(mockJsonResponse({
          result: true,
          items: [sampleBookmark],
          count: 1,
        }))
        // Collection 200 — same bookmark appears
        .mockResolvedValueOnce(mockJsonResponse({
          result: true,
          items: [sampleBookmark],
          count: 1,
        }));

      const items = await collect(
        connector.index({ collection_ids: [100, 200] }, { signal: undefined }),
      );

      expect(items).toHaveLength(1);
    });

    it("handles pagination", async () => {
      // Create 50 bookmarks to trigger pagination check
      const page1 = Array.from({ length: 50 }, (_, i) => ({
        ...sampleBookmark,
        _id: i + 1,
        title: `Bookmark ${i + 1}`,
      }));
      const page2 = [{ ...sampleBookmark, _id: 51, title: "Bookmark 51" }];

      vi.mocked(fetch)
        .mockResolvedValueOnce(mockJsonResponse(collectionsResponse))
        .mockResolvedValueOnce(mockJsonResponse({ result: true, items: page1, count: 51 }))
        .mockResolvedValueOnce(mockJsonResponse({ result: true, items: page2, count: 51 }));

      const items = await collect(connector.index({}, { signal: undefined }));
      expect(items).toHaveLength(51);
    });

    it("throws on missing token", async () => {
      delete process.env.RAINDROP_TOKEN;
      await expect(
        collect(connector.index({}, { signal: undefined })),
      ).rejects.toThrow("RAINDROP_TOKEN");
    });

    it("throws on API error", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockJsonResponse(collectionsResponse))
        .mockResolvedValueOnce(mockJsonResponse({}, false, 403));

      await expect(
        collect(connector.index({}, { signal: undefined })),
      ).rejects.toThrow("Raindrop API error (403)");
    });

    it("calls onProgress callback", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockJsonResponse(collectionsResponse))
        .mockResolvedValueOnce(mockJsonResponse({
          result: true,
          items: [sampleBookmark],
          count: 1,
        }));

      const progress = vi.fn();
      await collect(connector.index({}, { signal: undefined, onProgress: progress }));

      expect(progress).toHaveBeenCalledWith(1, 1);
    });

    it("handles bookmark with no excerpt or highlights", async () => {
      const bareBookmark = {
        ...sampleBookmark,
        _id: 999,
        excerpt: "",
        highlights: [],
      };

      vi.mocked(fetch)
        .mockResolvedValueOnce(mockJsonResponse(collectionsResponse))
        .mockResolvedValueOnce(mockJsonResponse({
          result: true,
          items: [bareBookmark],
          count: 1,
        }));

      const items = await collect(connector.index({}, { signal: undefined }));
      expect(items[0].content).toBeUndefined();
      expect(items[0].description).toBe("Bookmark: TypeScript Handbook");
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ContentItem, IndexOptions } from "@trove/shared";
import connector from "./index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockFetch(responses: Record<string, unknown>) {
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    for (const [pattern, body] of Object.entries(responses)) {
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
      json: async () => ({ error: "Not found" }),
      text: async () => "Not found",
      headers: new Headers(),
    } as Response;
  });
}

async function collectItems(
  config: Record<string, unknown>,
  options: IndexOptions = {},
): Promise<ContentItem[]> {
  const items: ContentItem[] = [];
  for await (const item of connector.index(config, options)) {
    items.push(item);
  }
  return items;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_USER = { id: "u1", handle: "designer", email: "d@test.com" };

const MOCK_FILE_LIST = {
  files: [
    {
      key: "abc123",
      name: "My Design",
      thumbnail_url: "https://figma.com/thumb/abc123",
      last_modified: "2025-06-01T10:00:00Z",
    },
    {
      key: "def456",
      name: "App Screens",
      thumbnail_url: "https://figma.com/thumb/def456",
      last_modified: "2025-05-15T08:00:00Z",
    },
  ],
};

const MOCK_FILE_DETAIL_ABC = {
  name: "My Design",
  lastModified: "2025-06-01T10:00:00Z",
  thumbnailUrl: "https://figma.com/thumb/abc123",
  version: "42",
  editorType: "figma",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [
      {
        id: "1:1",
        name: "Page 1",
        type: "CANVAS",
        children: [
          {
            id: "2:1",
            name: "Button",
            type: "COMPONENT",
            description: "Primary button component",
          },
          {
            id: "2:2",
            name: "Card",
            type: "COMPONENT_SET",
            description: "Card variants",
            children: [],
          },
        ],
      },
      {
        id: "1:2",
        name: "Page 2",
        type: "CANVAS",
        children: [],
      },
    ],
  },
};

const MOCK_FILE_DETAIL_DEF = {
  name: "App Screens",
  lastModified: "2025-05-15T08:00:00Z",
  thumbnailUrl: "https://figma.com/thumb/def456",
  version: "10",
  editorType: "figma",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [
      {
        id: "1:1",
        name: "Home",
        type: "CANVAS",
        children: [],
      },
    ],
  },
};

const MOCK_TEAM_PROJECTS = {
  projects: [{ id: "proj1", name: "Team Project" }],
};

const MOCK_PROJECT_FILES = {
  files: [MOCK_FILE_LIST.files[0]],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("@trove/connector-figma", () => {
  let originalFetch: typeof globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.FIGMA_TOKEN = "test-token-123";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── Validate ──────────────────────────────────────────────────────────────

  describe("validate", () => {
    it("rejects invalid config", async () => {
      const result = await connector.validate({ token_env: 42 });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it("rejects missing token env var", async () => {
      delete process.env.FIGMA_TOKEN;
      const result = await connector.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("FIGMA_TOKEN");
    });

    it("validates successfully with working token", async () => {
      globalThis.fetch = mockFetch({ "/me": MOCK_USER });
      const result = await connector.validate({});
      expect(result.valid).toBe(true);
    });

    it("rejects when API call fails", async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
        headers: new Headers(),
      })) as unknown as typeof fetch;

      const result = await connector.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("authenticate");
    });
  });

  // ── Manifest ──────────────────────────────────────────────────────────────

  describe("manifest", () => {
    it("has correct name and version", () => {
      expect(connector.manifest.name).toBe("figma");
      expect(connector.manifest.version).toBe("0.1.0");
    });
  });

  // ── Index ─────────────────────────────────────────────────────────────────

  describe("index", () => {
    it("indexes files and components from recent files", async () => {
      globalThis.fetch = mockFetch({
        "/me/files": MOCK_FILE_LIST,
        "/files/abc123": MOCK_FILE_DETAIL_ABC,
        "/files/def456": MOCK_FILE_DETAIL_DEF,
      });

      const items = await collectItems({});

      // 2 files + 2 components from abc123
      expect(items.length).toBe(4);

      // First item: file
      const fileItem = items[0];
      expect(fileItem.id).toBe("figma:abc123");
      expect(fileItem.source).toBe("figma");
      expect(fileItem.type).toBe("document");
      expect(fileItem.title).toBe("My Design");
      expect(fileItem.uri).toBe("https://figma.com/file/abc123");
      expect(fileItem.metadata.editorType).toBe("figma");
      expect(fileItem.metadata.version).toBe("42");
      expect(fileItem.metadata.pageCount).toBe(2);
      expect(fileItem.metadata.componentCount).toBe(2);
      expect(fileItem.content).toContain("Page 1");
      expect(fileItem.content).toContain("Button");
      expect(fileItem.tags).toContain("figma");
      expect(fileItem.tags).toContain("design");

      // Component items
      const buttonItem = items[1];
      expect(buttonItem.id).toBe("figma:abc123:2:1");
      expect(buttonItem.title).toBe("Button");
      expect(buttonItem.description).toBe("Primary button component");
      expect(buttonItem.tags).toContain("component");
      expect(buttonItem.uri).toContain("node-id=");

      const cardItem = items[2];
      expect(cardItem.id).toBe("figma:abc123:2:2");
      expect(cardItem.title).toBe("Card");
      expect(cardItem.tags).toContain("component-set");

      // Second file
      const screenItem = items[3];
      expect(screenItem.id).toBe("figma:def456");
      expect(screenItem.title).toBe("App Screens");
    });

    it("skips components when include_components is false", async () => {
      globalThis.fetch = mockFetch({
        "/me/files": MOCK_FILE_LIST,
        "/files/abc123": MOCK_FILE_DETAIL_ABC,
        "/files/def456": MOCK_FILE_DETAIL_DEF,
      });

      const items = await collectItems({ include_components: false });
      // Only 2 file items, no components
      expect(items.length).toBe(2);
      expect(items.every((i) => !i.id.includes(":"))).toBe(false);
      expect(
        items.every(
          (i) => i.id === `figma:${i.id.split(":")[1]}`,
        ),
      ).toBe(true);
    });

    it("respects since filter", async () => {
      globalThis.fetch = mockFetch({
        "/me/files": MOCK_FILE_LIST,
        "/files/abc123": MOCK_FILE_DETAIL_ABC,
      });

      const items = await collectItems(
        {},
        { since: new Date("2025-05-20T00:00:00Z") },
      );

      // Only abc123 (June 1) passes, def456 (May 15) is filtered out
      const fileItems = items.filter(
        (i) => !i.id.includes(":") || i.id.split(":").length === 2,
      );
      expect(fileItems.length).toBe(1);
      expect(fileItems[0].id).toBe("figma:abc123");
    });

    it("uses team_ids when provided", async () => {
      globalThis.fetch = mockFetch({
        "/teams/team1/projects": MOCK_TEAM_PROJECTS,
        "/projects/proj1/files": MOCK_PROJECT_FILES,
        "/files/abc123": MOCK_FILE_DETAIL_ABC,
      });

      const items = await collectItems({ team_ids: ["team1"] });

      // 1 file + 2 components
      expect(items.length).toBe(3);
      expect(items[0].id).toBe("figma:abc123");
    });

    it("calls onProgress callback", async () => {
      globalThis.fetch = mockFetch({
        "/me/files": { files: [MOCK_FILE_LIST.files[1]] },
        "/files/def456": MOCK_FILE_DETAIL_DEF,
      });

      const progressCalls: Array<[number, number | undefined]> = [];
      await collectItems(
        {},
        {
          onProgress: (indexed, total) => {
            progressCalls.push([indexed, total]);
          },
        },
      );

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[0][0]).toBe(1);
    });

    it("throws when token env var is missing", async () => {
      delete process.env.FIGMA_TOKEN;
      await expect(collectItems({})).rejects.toThrow("FIGMA_TOKEN");
    });

    it("uses custom token_env", async () => {
      delete process.env.FIGMA_TOKEN;
      process.env.MY_FIGMA = "custom-token";

      globalThis.fetch = mockFetch({
        "/me/files": { files: [] },
      });

      const items = await collectItems({ token_env: "MY_FIGMA" });
      expect(items.length).toBe(0);

      // Verify the token was used in the request
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalled();
      const callArgs = fetchMock.mock.calls[0];
      expect(callArgs[1].headers["X-Figma-Token"]).toBe("custom-token");
    });

    it("handles file detail fetch failure gracefully", async () => {
      const fetchFn = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("/me/files")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ files: [MOCK_FILE_LIST.files[1]] }),
            text: async () => "",
            headers: new Headers(),
          } as Response;
        }
        // Fail on file detail
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => "Internal Server Error",
          headers: new Headers(),
        } as Response;
      });
      globalThis.fetch = fetchFn as unknown as typeof fetch;

      const items = await collectItems({});
      // Should still yield the file item with basic info
      expect(items.length).toBe(1);
      expect(items[0].id).toBe("figma:def456");
      expect(items[0].title).toBe("App Screens");
    });

    it("stops on abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      globalThis.fetch = mockFetch({
        "/me/files": MOCK_FILE_LIST,
      });

      const items = await collectItems({}, { signal: controller.signal });
      expect(items.length).toBe(0);
    });
  });
});

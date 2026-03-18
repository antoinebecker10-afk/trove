import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @trove/shared to provide a no-delay RateLimiter
vi.mock("@trove/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@trove/shared")>();
  return {
    ...actual,
    RateLimiter: class {
      async wait() { /* no-op for tests */ }
    },
  };
});

// Mock the Notion SDK client
const mockSearch = vi.fn();
const mockBlocksChildrenList = vi.fn();
const mockDatabasesQuery = vi.fn();

vi.mock("@notionhq/client", () => ({
  Client: class {
    search = mockSearch;
    blocks = { children: { list: mockBlocksChildrenList } };
    databases = { query: mockDatabasesQuery };
  },
}));

import connector from "./index.js";

function notionPage(id: string, title: string, overrides?: Record<string, unknown>) {
  return {
    id,
    object: "page",
    url: `https://notion.so/${id}`,
    archived: false,
    created_time: "2026-01-01T00:00:00Z",
    last_edited_time: "2026-03-01T00:00:00Z",
    created_by: { id: "u1" },
    last_edited_by: { id: "u2" },
    icon: null,
    cover: null,
    parent: { type: "workspace", workspace: true },
    properties: {
      Name: { id: "title", type: "title", title: [{ type: "text", plain_text: title, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false }, href: null }] },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTION_TOKEN = "secret_test_token";
});

describe("manifest", () => {
  it("has correct name", () => {
    expect(connector.manifest.name).toBe("notion");
  });
});

describe("validate", () => {
  it("validates with token present", async () => {
    const result = await connector.validate({});
    expect(result.valid).toBe(true);
  });

  it("fails when token env is missing", async () => {
    delete process.env.NOTION_TOKEN;
    const result = await connector.validate({});
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toContain("NOTION_TOKEN");
  });

  it("fails with invalid config", async () => {
    // token_env must be a string; passing a number triggers Zod validation error
    const result = await connector.validate({ token_env: 123 });
    expect(result.valid).toBe(false);
  });
});

describe("index", () => {
  it("indexes pages from workspace search", async () => {
    mockSearch.mockResolvedValueOnce({
      results: [notionPage("p1", "Page One"), notionPage("p2", "Page Two")],
      has_more: false,
      next_cursor: null,
    });

    // Blocks for page 1
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [{
        id: "b1",
        type: "paragraph",
        has_children: false,
        archived: false,
        paragraph: {
          rich_text: [{ type: "text", plain_text: "Hello", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false }, href: null }],
          color: "default",
        },
      }],
      has_more: false,
      next_cursor: null,
    });

    // Blocks for page 2
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [],
      has_more: false,
      next_cursor: null,
    });

    const items = [];
    for await (const item of connector.index({}, { signal: undefined })) {
      items.push(item);
    }

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("notion:p1");
    expect(items[0].title).toBe("Page One");
    expect(items[0].source).toBe("notion");
    expect(items[0].type).toBe("document");
    expect(items[0].content).toContain("Hello");
    expect(items[1].id).toBe("notion:p2");
  });

  it("indexes all pages including archived from search", async () => {
    // The connector currently yields all pages from search results
    mockSearch.mockResolvedValueOnce({
      results: [notionPage("p1", "Active"), notionPage("p2", "Archived", { archived: true })],
      has_more: false,
      next_cursor: null,
    });

    // Blocks for page 1
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [],
      has_more: false,
      next_cursor: null,
    });

    // Blocks for page 2
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [],
      has_more: false,
      next_cursor: null,
    });

    const items = [];
    for await (const item of connector.index({}, { signal: undefined })) {
      items.push(item);
    }

    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Active");
    expect(items[1].title).toBe("Archived");
  });

  it("indexes all pages regardless of title patterns", async () => {
    mockSearch.mockResolvedValueOnce({
      results: [notionPage("p1", "Draft: WIP"), notionPage("p2", "Published Post")],
      has_more: false,
      next_cursor: null,
    });

    // Blocks for both pages
    mockBlocksChildrenList
      .mockResolvedValueOnce({ results: [], has_more: false, next_cursor: null })
      .mockResolvedValueOnce({ results: [], has_more: false, next_cursor: null });

    const items = [];
    for await (const item of connector.index({}, { signal: undefined })) {
      items.push(item);
    }

    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Draft: WIP");
    expect(items[1].title).toBe("Published Post");
  });

  it("indexes from specific database", async () => {
    mockDatabasesQuery.mockResolvedValueOnce({
      results: [notionPage("p1", "Task 1", { parent: { type: "database_id", database_id: "db-1" } })],
      has_more: false,
      next_cursor: null,
    });

    // Blocks for page
    mockBlocksChildrenList.mockResolvedValueOnce({
      results: [],
      has_more: false,
      next_cursor: null,
    });

    const items = [];
    for await (const item of connector.index({ database_ids: ["db-1"] }, { signal: undefined })) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("notion:p1");
    expect(items[0].title).toBe("Task 1");
  });
});

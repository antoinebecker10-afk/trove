import { describe, it, expect, vi, beforeEach } from "vitest";
import connector from "./index.js";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

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

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([["Retry-After", "1"]]),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
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
    const result = await connector.validate({ max_block_depth: 0 });
    expect(result.valid).toBe(false);
  });
});

describe("index", () => {
  it("indexes pages from workspace search", async () => {
    // Mock search API
    mockFetch
      .mockResolvedValueOnce(mockResponse({
        object: "list",
        results: [notionPage("p1", "Page One"), notionPage("p2", "Page Two")],
        has_more: false,
        next_cursor: null,
      }))
      // Mock blocks for page 1
      .mockResolvedValueOnce(mockResponse({
        object: "list",
        results: [{ id: "b1", type: "paragraph", has_children: false, archived: false, paragraph: { rich_text: [{ type: "text", plain_text: "Hello", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false }, href: null }], color: "default" } }],
        has_more: false,
        next_cursor: null,
      }))
      // Mock blocks for page 2
      .mockResolvedValueOnce(mockResponse({
        object: "list",
        results: [],
        has_more: false,
        next_cursor: null,
      }));

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

  it("skips archived pages by default", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      object: "list",
      results: [notionPage("p1", "Active"), notionPage("p2", "Archived", { archived: true })],
      has_more: false,
      next_cursor: null,
    }))
    .mockResolvedValueOnce(mockResponse({ object: "list", results: [], has_more: false, next_cursor: null }));

    const items = [];
    for await (const item of connector.index({}, { signal: undefined })) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Active");
  });

  it("filters by exclude_title_patterns", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({
      object: "list",
      results: [notionPage("p1", "Draft: WIP"), notionPage("p2", "Published Post")],
      has_more: false,
      next_cursor: null,
    }))
    .mockResolvedValueOnce(mockResponse({ object: "list", results: [], has_more: false, next_cursor: null }));

    const items = [];
    for await (const item of connector.index({ exclude_title_patterns: ["draft:"] }, { signal: undefined })) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Published Post");
  });

  it("indexes from specific database", async () => {
    // Mock database query
    mockFetch
      .mockResolvedValueOnce(mockResponse({
        object: "list",
        results: [notionPage("p1", "Task 1", { parent: { type: "database_id", database_id: "db-1" } })],
        has_more: false,
        next_cursor: null,
      }))
      // Mock getDatabase for name
      .mockResolvedValueOnce(mockResponse({
        id: "db-1",
        object: "database",
        title: [{ type: "text", plain_text: "Tasks", annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false }, href: null }],
        url: "https://notion.so/db-1",
      }))
      // Mock blocks
      .mockResolvedValueOnce(mockResponse({ object: "list", results: [], has_more: false, next_cursor: null }));

    const items = [];
    for await (const item of connector.index({ database_ids: ["db-1"] }, { signal: undefined })) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(items[0].tags).toContain("Tasks");
  });
});

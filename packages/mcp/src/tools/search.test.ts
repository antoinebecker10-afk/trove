import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerSearchTool } from "./search.js";

function createMockEngine() {
  return {
    search: vi.fn().mockResolvedValue([]),
    keywordSearch: vi.fn().mockResolvedValue([]),
    getItem: vi.fn().mockResolvedValue(null),
    getStats: vi.fn().mockResolvedValue({
      totalItems: 0,
      byType: {},
      bySource: {},
      lastIndexedAt: null,
    }),
    getConfig: vi.fn().mockReturnValue({
      storage: "json",
      data_dir: "~/.trove",
      embeddings: "local",
      sources: [],
    }),
    index: vi.fn().mockResolvedValue(0),
  };
}

function createMockServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    tool: vi.fn((name: string, _desc: string, _schema: any, handler: Function) => {
      tools[name] = { handler };
    }),
    _tools: tools,
  };
}

describe("registerSearchTool", () => {
  let server: ReturnType<typeof createMockServer>;
  let engine: ReturnType<typeof createMockEngine>;

  beforeEach(() => {
    server = createMockServer();
    engine = createMockEngine();
    registerSearchTool(server as any, engine as any);
  });

  it("registers the trove_search tool", () => {
    expect(server.tool).toHaveBeenCalledWith(
      "trove_search",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns semantic search results", async () => {
    engine.search.mockResolvedValue([
      {
        item: {
          title: "utils.ts",
          type: "file",
          description: "Utility functions",
          uri: "/home/user/utils.ts",
          tags: ["ts"],
          metadata: { size: 1024 },
        },
        score: 0.95,
      },
    ]);

    const handler = server._tools["trove_search"].handler;
    const result = await handler({ query: "utility functions", limit: 10 });

    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].title).toBe("utils.ts");
    expect(parsed.results[0].relevance).toBe(0.95);
  });

  it("falls back to keyword search when semantic returns empty", async () => {
    engine.search.mockResolvedValue([]);
    engine.keywordSearch.mockResolvedValue([
      {
        title: "readme.md",
        type: "file",
        description: "Project readme",
        uri: "/home/user/readme.md",
        tags: ["md"],
        metadata: {},
      },
    ]);

    const handler = server._tools["trove_search"].handler;
    const result = await handler({ query: "readme", limit: 10 });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].title).toBe("readme.md");
  });

  it("returns a message when no results found", async () => {
    engine.search.mockResolvedValue([]);
    engine.keywordSearch.mockResolvedValue([]);

    const handler = server._tools["trove_search"].handler;
    const result = await handler({ query: "nonexistent", limit: 10 });

    expect(result.content[0].text).toContain("No results found");
  });
});

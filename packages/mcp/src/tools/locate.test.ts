import { describe, it, expect, vi } from "vitest";
import { registerLocateTool } from "./locate.js";

function createMockServer() {
  const tools: Record<string, { handler: Function }> = {};
  return {
    tool: vi.fn((name: string, _desc: string, _schema: any, handler: Function) => {
      tools[name] = { handler };
    }),
    _tools: tools,
  };
}

describe("registerLocateTool", () => {
  it("returns locations without file content", async () => {
    const server = createMockServer();
    const engine = {
      search: vi.fn().mockResolvedValue([
        {
          item: {
            title: "config.ts",
            type: "file",
            uri: "/home/user/config.ts",
          },
          score: 0.88,
        },
      ]),
      keywordSearch: vi.fn(),
    };

    registerLocateTool(server as any, engine as any);

    const handler = server._tools["trove_locate"].handler;
    const result = await handler({ query: "config", limit: 10 });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].title).toBe("config.ts");
    expect(parsed.results[0].uri).toBe("/home/user/config.ts");
    expect(parsed.results[0].relevance).toBe(0.88);
    // No file_content or content fields
    expect(parsed.results[0].file_content).toBeUndefined();
    expect(parsed.results[0].content).toBeUndefined();
  });

  it("falls back to keyword search", async () => {
    const server = createMockServer();
    const engine = {
      search: vi.fn().mockResolvedValue([]),
      keywordSearch: vi.fn().mockResolvedValue([
        {
          title: "readme.md",
          type: "file",
          uri: "/home/user/readme.md",
        },
      ]),
    };

    registerLocateTool(server as any, engine as any);

    const handler = server._tools["trove_locate"].handler;
    const result = await handler({ query: "readme", limit: 10 });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].title).toBe("readme.md");
  });

  it("returns message when nothing found", async () => {
    const server = createMockServer();
    const engine = {
      search: vi.fn().mockResolvedValue([]),
      keywordSearch: vi.fn().mockResolvedValue([]),
    };

    registerLocateTool(server as any, engine as any);

    const handler = server._tools["trove_locate"].handler;
    const result = await handler({ query: "nonexistent", limit: 10 });

    expect(result.content[0].text).toContain("Nothing found");
  });
});

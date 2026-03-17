import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TroveEngine } from "@trove/core";

/**
 * trove_locate — Lightweight version: just return paths, no content.
 * Fast. For when Claude just needs to know WHERE something is.
 */
export function registerLocateTool(server: McpServer, engine: TroveEngine): void {
  server.tool(
    "trove_locate",
    "Find content and return only file paths/URIs (no content). " +
      "Use this when you just need to know where a file lives.",
    {
      query: z.string().describe("What to search for"),
      type: z
        .enum(["github", "file", "image", "video", "document", "bookmark"])
        .optional(),
      limit: z.number().min(1).max(50).default(10),
    },
    async ({ query, type, limit }) => {
      let results = await engine.search(query, { type, limit });

      if (results.length === 0) {
        const kwResults = await engine.keywordSearch(query, { type, limit });
        results = kwResults.map((item) => ({ item, score: 1 }));
      }

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: `Nothing found for "${query}".` }],
        };
      }

      const locations = results.map(({ item, score }) => ({
        title: item.title,
        type: item.type,
        uri: item.uri,
        relevance: Math.round(score * 100) / 100,
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(locations, null, 2) }],
      };
    },
  );
}

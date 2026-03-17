import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TroveEngine } from "@trove/core";

const TEXT_EXTS = new Set([
  ".md", ".txt", ".ts", ".js", ".tsx", ".jsx", ".py", ".rs", ".go",
  ".toml", ".yaml", ".yml", ".json", ".css", ".html", ".xml", ".csv",
  ".sh", ".bash", ".zsh", ".bpmn", ".sql",
]);

const MAX_READ_SIZE = 500_000;

/**
 * trove_find — The "just get me that file" tool.
 * Claude says "find the BPMN diagram for invoice validation",
 * Trove searches, finds the best match, and returns the path + content.
 * One tool call = search + open. No intermediate steps.
 */
export function registerFindAndOpenTool(server: McpServer, engine: TroveEngine): void {
  server.tool(
    "trove_find",
    "Search for content by natural language and return the best match with its real file path and contents. " +
      "This is the primary way to retrieve files — describe what you need and Trove finds it.",
    {
      query: z.string().describe("Natural language description of what you're looking for"),
      type: z
        .enum(["github", "file", "image", "video", "document", "bookmark"])
        .optional()
        .describe("Narrow to a specific content type"),
      read: z
        .boolean()
        .default(true)
        .describe("Read and return text file contents"),
    },
    async ({ query, type, read }) => {
      // Semantic search first
      let results = await engine.search(query, { type, limit: 5 });

      // Fall back to keyword if semantic returns nothing
      if (results.length === 0) {
        const kwResults = await engine.keywordSearch(query, { type, limit: 5 });
        results = kwResults.map((item) => ({ item, score: 1 }));
      }

      if (results.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Nothing found for "${query}". Try reindexing: trove index`,
          }],
        };
      }

      // Build response with paths and optionally content
      const items = await Promise.all(
        results.map(async ({ item, score }) => {
          const entry: Record<string, unknown> = {
            title: item.title,
            type: item.type,
            uri: item.uri,
            source: item.source,
            description: item.description,
            tags: item.tags,
            relevance: Math.round(score * 100) / 100,
            metadata: item.metadata,
          };

          // Read file content for the top result if requested
          if (read && item.source === "local" && item.type === "file") {
            const ext = extname(item.uri).toLowerCase();
            if (TEXT_EXTS.has(ext)) {
              try {
                const content = await readFile(item.uri, "utf-8");
                entry.file_content = content.length <= MAX_READ_SIZE
                  ? content
                  : content.slice(0, MAX_READ_SIZE);
                if (content.length > MAX_READ_SIZE) entry.truncated = true;
              } catch {
                // Can't read — just return the path
              }
            }
          }

          // Include indexed content for non-local sources
          if (read && item.content) {
            entry.indexed_content = item.content;
          }

          return entry;
        }),
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            { match_count: items.length, results: items },
            null,
            2,
          ),
        }],
      };
    },
  );
}

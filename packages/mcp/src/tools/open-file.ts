import { z } from "zod";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TroveEngine } from "@trove/core";

const TEXT_EXTS = new Set([
  ".md", ".txt", ".ts", ".js", ".tsx", ".jsx", ".py", ".rs", ".go",
  ".toml", ".yaml", ".yml", ".json", ".css", ".html", ".xml", ".csv",
  ".sh", ".bash", ".zsh", ".env", ".gitignore", ".bpmn", ".sql",
]);

const MAX_READ_SIZE = 1_000_000; // 1MB safety limit

/**
 * trove_open — The core tool. Claude asks "find my terrain screenshot",
 * Trove returns the exact path + content (if text). No hosting, no copy.
 * Claude can then read/use the file directly.
 */
export function registerOpenFileTool(server: McpServer, engine: TroveEngine): void {
  server.tool(
    "trove_open",
    "Find a content item by ID and return its location + contents (for text files). " +
      "Use this to access files Trove has indexed — it returns the real path, not a copy.",
    {
      id: z.string().describe("Content item ID (e.g. local:/path/to/file or github:user/repo)"),
      include_content: z
        .boolean()
        .default(true)
        .describe("If true, read and return file content for text files"),
    },
    async ({ id, include_content }) => {
      const item = await engine.getItem(id);
      if (!item) {
        return {
          content: [{ type: "text" as const, text: `Item not found: "${id}"` }],
          isError: true,
        };
      }

      const result: Record<string, unknown> = {
        title: item.title,
        type: item.type,
        uri: item.uri,
        source: item.source,
        description: item.description,
        tags: item.tags,
        metadata: item.metadata,
      };

      // For local files, read content if requested and it's a text file
      if (include_content && item.source === "local" && item.type === "file") {
        const ext = extname(item.uri).toLowerCase();
        if (TEXT_EXTS.has(ext)) {
          try {
            const content = await readFile(item.uri, "utf-8");
            if (content.length <= MAX_READ_SIZE) {
              result.file_content = content;
            } else {
              result.file_content = content.slice(0, MAX_READ_SIZE);
              result.truncated = true;
            }
          } catch {
            result.file_content = null;
            result.read_error = "Could not read file";
          }
        }
      }

      // For GitHub items, include the indexed README/content
      if (include_content && item.content) {
        result.indexed_content = item.content;
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

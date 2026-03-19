import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TroveEngine } from "@trove/core";
import { registerSearchTool } from "./tools/search.js";
import { registerListSourcesTool } from "./tools/list-sources.js";
import { registerGetContentTool } from "./tools/get-content.js";
import { registerReindexTool } from "./tools/reindex.js";
import { registerOpenFileTool } from "./tools/open-file.js";
import { registerFindAndOpenTool } from "./tools/find-and-open.js";
import { registerLocateTool } from "./tools/locate.js";
import { registerFindMultiTool } from "./tools/find-multi.js";

export interface TroveMcpOptions {
  cwd?: string;
}

/**
 * Create and start the Trove MCP server.
 * All output goes to stderr — stdout is reserved for JSON-RPC.
 */
export async function startMcpServer(options: TroveMcpOptions = {}): Promise<void> {
  // All logging must go to stderr (stdout = JSON-RPC channel)
  const log = (...args: unknown[]) => console.error("[trove-mcp]", ...args);

  log("Initializing Trove engine...");
  const engine = await TroveEngine.create({ cwd: options.cwd });

  const server = new McpServer({
    name: "trove",
    version: "0.1.0",
  });

  // Register all tools
  registerSearchTool(server, engine);
  registerListSourcesTool(server, engine);
  registerGetContentTool(server, engine);
  registerReindexTool(server, engine);
  registerOpenFileTool(server, engine);
  registerFindAndOpenTool(server, engine);
  registerLocateTool(server, engine);
  registerFindMultiTool(server, engine);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  log("MCP server starting on stdio...");
  await server.connect(transport);
  log("MCP server connected.");
}

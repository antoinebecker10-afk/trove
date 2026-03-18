/**
 * Trove Web Backend — connects the dashboard to TroveEngine + Ollama.
 * Runs on port 7334 (Vite proxies /api/* here).
 *
 * Usage: npx tsx server.ts
 */

// Load .env from monorepo root
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

/** Monorepo root — resolved from this file's location, not cwd. */
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");

try {
  const envPath = resolve(PROJECT_ROOT, ".env");
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* .env not found — that's fine */ }

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { TroveEngine, registerBuiltinConnector } from "@trove/core";

// Register built-in connectors (relative paths — tsx doesn't resolve workspace packages)
const c = (name: string) => `../connectors/${name}/src/index.ts`;
registerBuiltinConnector("local", async () => (await import(c("local"))).default);
registerBuiltinConnector("github", async () => (await import(c("github"))).default);
registerBuiltinConnector("notion", async () => (await import(c("notion"))).default);
registerBuiltinConnector("discord", async () => (await import(c("discord"))).default);
registerBuiltinConnector("obsidian", async () => (await import(c("obsidian"))).default);
registerBuiltinConnector("figma", async () => (await import(c("figma"))).default);
registerBuiltinConnector("slack", async () => (await import(c("slack"))).default);
registerBuiltinConnector("linear", async () => (await import(c("linear"))).default);
registerBuiltinConnector("airtable", async () => (await import(c("airtable"))).default);
registerBuiltinConnector("dropbox", async () => (await import(c("dropbox"))).default);
registerBuiltinConnector("confluence", async () => (await import(c("confluence"))).default);
registerBuiltinConnector("raindrop", async () => (await import(c("raindrop"))).default);
registerBuiltinConnector("google-drive", async () => (await import(c("google-drive"))).default);
import {
  PORT,
  AUTH_TOKEN,
  OLLAMA_URL,
  OLLAMA_MODEL,
  OLLAMA_RAG_MODEL,
  setSecurityHeaders,
  checkHost,
  handleCors,
  checkAuth,
  checkRateLimit,
  error,
} from "./src/api/middleware.js";
import { handleSearchRoutes } from "./src/api/routes/search.js";
import { handleFileRoutes } from "./src/api/routes/files.js";
import { handleSystemRoutes } from "./src/api/routes/system.js";
import { handleConnectorRoutes } from "./src/api/routes/connectors.js";
import type { RouteContext } from "./src/api/types.js";

let engine: TroveEngine | null = null;

const ctx: RouteContext = {
  engine: async () => {
    if (!engine) engine = await TroveEngine.create({ cwd: PROJECT_ROOT });
    return engine;
  },
  invalidateEngine: () => {
    engine = null;
  },
};

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  setSecurityHeaders(res);

  if (!checkHost(req)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (handleCors(req, res, method)) return;
  if (!checkAuth(req, res)) return;
  if (!checkRateLimit(req, res)) return;

  try {
    if (await handleSearchRoutes(url, method, req, res, ctx)) return;
    if (await handleFileRoutes(url, method, req, res, ctx)) return;
    if (await handleSystemRoutes(url, method, req, res, ctx)) return;
    if (await handleConnectorRoutes(url, method, req, res, ctx)) return;
    error(res, "Not found", 404);
  } catch (err) {
    console.error("[trove-api]", err);
    error(res, "Internal error");
  }
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("[trove-api] unhandled:", err);
    error(res, "Internal error");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Trove API running on http://127.0.0.1:${PORT}`);
  console.log(`   Auth token: ${AUTH_TOKEN}`);
  console.log(`   Ollama: ${OLLAMA_URL}`);
  console.log(`     RAG model: ${OLLAMA_RAG_MODEL}`);
  console.log(`     Chat model: ${OLLAMA_MODEL}`);
});

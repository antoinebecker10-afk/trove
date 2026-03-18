import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolve, extname, dirname } from "node:path";
import { homedir } from "node:os";
import { realpath } from "node:fs/promises";

export const PORT = Number(process.env.TROVE_API_PORT ?? 7334);
export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
/** Model for RAG search answers — Mistral excels at instruction-following with context */
export const OLLAMA_RAG_MODEL = process.env.OLLAMA_RAG_MODEL ?? "mistral:latest";
/** Model for general chat/AI tasks */
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:8b";

// --- Auth token: generated once per server start, printed to console ---
export const AUTH_TOKEN = process.env.TROVE_API_TOKEN ?? randomBytes(32).toString("hex");

export const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:7332",
  `http://localhost:${PORT}`,
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:7332",
  `http://127.0.0.1:${PORT}`,
]);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export function getCorsOrigin(req: IncomingMessage): string {
  const origin = req.headers.origin ?? "";
  return ALLOWED_ORIGINS.has(origin) ? origin : "";
}

export function json(res: ServerResponse, data: unknown, status = 200): void {
  const existing = res.getHeader("Access-Control-Allow-Origin");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (existing) headers["Access-Control-Allow-Origin"] = String(existing);
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

export function error(res: ServerResponse, msg: string, status = 500): void {
  json(res, { error: msg }, status);
}

export function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  // Local-only bypass: requests from localhost (direct or via Vite proxy)
  // are trusted since the server binds to 127.0.0.1 only,
  // DNS rebinding is blocked by Host header check, and CORS is whitelisted.
  const origin = req.headers.origin ?? "";
  const ip = req.socket.remoteAddress ?? "";
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const isLocalOrigin = !origin || ALLOWED_ORIGINS.has(origin);
  if (isLocal && isLocalOrigin) return true;

  // For cross-origin requests (browser fetch with Origin header), require token
  const authHeader = req.headers.authorization ?? "";
  let token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  // Fallback: check query param (for img/video src tags that can't set headers)
  if (!token) {
    const url = req.url ?? "";
    const idx = url.indexOf("?");
    if (idx >= 0) {
      const params = new URLSearchParams(url.slice(idx + 1));
      token = params.get("token") ?? "";
    }
  }
  // Timing-safe comparison to prevent timing attacks
  const tokenValid = token.length > 0 && token.length === AUTH_TOKEN.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(AUTH_TOKEN));
  if (!tokenValid) {
    res.setHeader("Access-Control-Allow-Origin", getCorsOrigin(req));
    error(res, "Unauthorized", 401);
    return false;
  }
  return true;
}

// --- Rate limiting: per IP (relaxed in dev, strict in prod) ---
const isDev = process.env.NODE_ENV !== "production";
const RATE_LIMIT_MAX = isDev ? 600 : 100;
const RATE_LIMIT_WINDOW = 60_000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitMap) {
    if (now > bucket.resetAt) rateLimitMap.delete(ip);
  }
}, 300_000).unref();

export function checkRateLimit(req: IncomingMessage, res: ServerResponse): boolean {
  const ip = req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  let bucket = rateLimitMap.get(ip);

  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimitMap.set(ip, bucket);
  }

  bucket.count++;

  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      "Access-Control-Allow-Origin": getCorsOrigin(req),
    });
    res.end(JSON.stringify({ error: "Too many requests" }));
    return false;
  }

  return true;
}

export function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

/** Resolve and validate a path — must be under the user's home directory. */
export async function safePath(inputPath: string): Promise<string | null> {
  try {
    const expanded = inputPath.replace(/^~/, homedir());
    const resolved = resolve(expanded);
    const real = await realpath(resolved).catch(() => resolved);
    const home = homedir();
    if (!real.startsWith(home)) return null;
    return real;
  } catch {
    return null;
  }
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv"]);
const DOC_EXTS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"]);

export function fileType(ext: string): string {
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (DOC_EXTS.has(ext)) return "document";
  return "file";
}

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

export function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function checkHost(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  return host.startsWith("127.0.0.1") || host.startsWith("localhost");
}

/**
 * Handle CORS preflight and set the Access-Control-Allow-Origin header.
 * Returns true if the request was a preflight OPTIONS and has been handled.
 */
export function handleCors(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  const corsOrigin = getCorsOrigin(req);
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return true;
  }

  return false;
}

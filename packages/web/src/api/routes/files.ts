import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile, exec } from "node:child_process";
import { readFile, readdir, stat, copyFile, unlink, mkdir, rename } from "node:fs/promises";
import { join, extname, dirname, basename } from "node:path";
import { homedir } from "node:os";
import type { RouteContext } from "../types.js";
import { json, error, readBody, parseQuery, safePath, fileType } from "../middleware.js";

export async function handleFileRoutes(
  url: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  _ctx: RouteContext,
): Promise<boolean> {
  // GET /api/files?path=... — list files + folders in a directory
  if (url.startsWith("/api/files") && method === "GET") {
    const params = parseQuery(url);
    const dirPath = params.get("path") || homedir();
    const safe = await safePath(dirPath);
    if (!safe) {
      error(res, "Path not allowed", 403);
      return true;
    }
    try {
      const entries = await readdir(safe, { withFileTypes: true });
      const items: Array<{
        name: string;
        path: string;
        isDir: boolean;
        size: number;
        modified: string;
        ext: string;
        type: string;
      }> = [];

      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = join(safe, entry.name);
        try {
          const s = await stat(fullPath);
          const ext = entry.isDirectory() ? "" : extname(entry.name).toLowerCase();
          items.push({
            name: entry.name,
            path: fullPath,
            isDir: entry.isDirectory(),
            size: s.size,
            modified: s.mtime.toISOString(),
            ext,
            type: entry.isDirectory() ? "folder" : fileType(ext),
          });
        } catch {
          // skip inaccessible files
        }
      }

      // Folders first, then files, alphabetical within each group
      items.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const parent = dirname(safe);
      json(res, {
        current: safe,
        parent: parent !== safe ? parent : null,
        items,
      });
    } catch {
      error(res, "Cannot list directory");
    }
    return true;
  }

  // POST /api/file/open — open file with OS default app
  if (url.startsWith("/api/file/open") && method === "POST") {
    const body = await readBody(req);
    console.error("[trove-api] file/open raw body:", body.slice(0, 300));
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch (e) {
      console.error("[trove-api] file/open JSON parse error:", e instanceof Error ? e.message : e);
      error(res, "Invalid JSON", 400);
      return true;
    }
    const filePath = parsed.path;
    if (!filePath || typeof filePath !== "string") {
      error(res, "Missing path", 400);
      return true;
    }
    const safe = await safePath(filePath);
    if (!safe) {
      error(res, "Path not allowed", 403);
      return true;
    }
    if (process.platform === "win32") {
      // Windows: use exec with shell for proper quoting
      exec(`start "" "${safe.replace(/"/g, "")}"`, (err) => {
        if (err) error(res, "Failed to open file");
        else json(res, { ok: true });
      });
    } else {
      const [cmd, args] = process.platform === "darwin"
        ? ["open", [safe]]
        : ["xdg-open", [safe]];
      execFile(cmd, args, (err) => {
        if (err) error(res, "Failed to open file");
        else json(res, { ok: true });
      });
    }
    return true;
  }

  // GET /api/file/serve?path=...
  if (url.startsWith("/api/file/serve") && method === "GET") {
    const params = parseQuery(url);
    const filePath = params.get("path");
    if (!filePath) {
      error(res, "Missing path", 400);
      return true;
    }
    const safe = await safePath(filePath);
    if (!safe) {
      error(res, "Path not allowed", 403);
      return true;
    }
    const ext = extname(safe).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
      ".bmp": "image/bmp", ".ico": "image/x-icon",
      ".pdf": "application/pdf",
      ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
      ".txt": "text/plain", ".md": "text/plain", ".ts": "text/plain",
      ".tsx": "text/plain", ".js": "text/plain", ".jsx": "text/plain",
      ".json": "text/plain", ".yml": "text/plain", ".yaml": "text/plain",
      ".rs": "text/plain", ".py": "text/plain", ".css": "text/plain",
      ".html": "text/plain", ".toml": "text/plain", ".sh": "text/plain",
    };
    const mime = mimeMap[ext] ?? "application/octet-stream";
    try {
      const fileStat = await stat(safe);
      const MAX_SERVE_SIZE = 100 * 1024 * 1024; // 100 MB
      if (fileStat.size > MAX_SERVE_SIZE) {
        error(res, "File too large to serve", 413);
        return true;
      }
      const data = await readFile(safe);
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": data.length,
        "Cache-Control": "no-cache",
      });
      res.end(data);
    } catch {
      error(res, "Cannot read file");
    }
    return true;
  }

  // POST /api/file/move — move/rename a file
  if (url.startsWith("/api/file/move") && method === "POST") {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch { error(res, "Invalid JSON", 400); return true; }
    const { from, to } = parsed as { from?: string; to?: string };
    if (!from || !to) {
      error(res, "Missing from/to", 400);
      return true;
    }
    const safeFrom = await safePath(from);
    if (!safeFrom) {
      error(res, "Source path not allowed", 403);
      return true;
    }
    const safeTo = await safePath(to);
    if (!safeTo) {
      error(res, "Destination path not allowed", 403);
      return true;
    }
    // If `to` is a directory, move into it. Otherwise treat as full dest path (rename).
    let destFile: string;
    try {
      const toStat = await stat(safeTo);
      destFile = toStat.isDirectory() ? join(safeTo, basename(safeFrom)) : safeTo;
    } catch {
      destFile = safeTo;
    }
    try {
      await rename(safeFrom, destFile);
      json(res, { ok: true, newPath: destFile });
    } catch {
      error(res, "Move failed");
    }
    return true;
  }

  // POST /api/file/copy
  if (url.startsWith("/api/file/copy") && method === "POST") {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch { error(res, "Invalid JSON", 400); return true; }
    const { from, to } = parsed as { from?: string; to?: string };
    if (!from || !to) {
      error(res, "Missing from/to", 400);
      return true;
    }
    const safeFrom = await safePath(from);
    if (!safeFrom) {
      error(res, "Source path not allowed", 403);
      return true;
    }
    const safeTo = await safePath(to);
    if (!safeTo) {
      error(res, "Destination path not allowed", 403);
      return true;
    }
    let destFile: string;
    try {
      const toStat = await stat(safeTo);
      destFile = toStat.isDirectory() ? join(safeTo, basename(safeFrom)) : safeTo;
    } catch {
      destFile = safeTo;
    }
    try {
      await copyFile(safeFrom, destFile);
      json(res, { ok: true, newPath: destFile });
    } catch {
      error(res, "Copy failed");
    }
    return true;
  }

  // POST /api/file/rename
  if (url.startsWith("/api/file/rename") && method === "POST") {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch { error(res, "Invalid JSON", 400); return true; }
    const { path: filePath, newName } = parsed as { path?: string; newName?: string };
    if (!filePath || !newName) {
      error(res, "Missing path/newName", 400);
      return true;
    }
    if (newName.includes("/") || newName.includes("\\")) {
      error(res, "Invalid name", 400);
      return true;
    }
    const safe = await safePath(filePath);
    if (!safe) {
      error(res, "Path not allowed", 403);
      return true;
    }
    const newPath = join(dirname(safe), newName);
    try {
      await rename(safe, newPath);
      json(res, { ok: true, newPath });
    } catch {
      error(res, "Rename failed");
    }
    return true;
  }

  // DELETE /api/file/delete
  if (url.startsWith("/api/file/delete") && method === "DELETE") {
    const params = parseQuery(url);
    const filePath = params.get("path");
    if (!filePath) {
      error(res, "Missing path", 400);
      return true;
    }
    const safe = await safePath(filePath);
    if (!safe) {
      error(res, "Path not allowed", 403);
      return true;
    }
    try {
      await unlink(safe);
      json(res, { ok: true });
    } catch {
      error(res, "Delete failed");
    }
    return true;
  }

  // POST /api/file/mkdir
  if (url.startsWith("/api/file/mkdir") && method === "POST") {
    const body = await readBody(req);
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body); } catch { error(res, "Invalid JSON", 400); return true; }
    const dirPath = parsed.path;
    if (!dirPath || typeof dirPath !== "string") {
      error(res, "Missing path", 400);
      return true;
    }
    const safe = await safePath(dirPath);
    if (!safe) {
      error(res, "Path not allowed", 403);
      return true;
    }
    try {
      await mkdir(safe, { recursive: true });
      json(res, { ok: true, path: safe });
    } catch {
      error(res, "Mkdir failed");
    }
    return true;
  }

  // GET /api/browse?path=...
  if (url.startsWith("/api/browse") && method === "GET") {
    const params = parseQuery(url);
    const dirPath = params.get("path") || homedir();
    const safe = await safePath(dirPath);
    if (!safe) {
      error(res, "Path not allowed", 403);
      return true;
    }
    try {
      const entries = await readdir(safe, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
        .map((e) => ({ name: e.name, path: join(safe, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      json(res, { current: safe, dirs });
    } catch {
      error(res, "Cannot browse directory");
    }
    return true;
  }

  return false;
}

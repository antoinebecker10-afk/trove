import { z } from "zod";
import { RateLimiter } from "@trove/shared";
import type { Connector, ContentItem, ContentType, IndexOptions } from "@trove/shared";

const DropboxConfigSchema = z.object({
  /** Env var name for the Dropbox API token (default: DROPBOX_TOKEN) */
  token_env: z.string().default("DROPBOX_TOKEN"),
  /** Folder paths to index (default: [""] = root) */
  paths: z.array(z.string()).default([""]),
  /** Include deleted files in results */
  include_deleted: z.boolean().default(false),
  /** Only index files with these extensions (e.g. [".md", ".txt"]) */
  extensions: z.array(z.string()).optional(),
});

const API_BASE = "https://api.dropboxapi.com/2";
const CONTENT_BASE = "https://content.dropboxapi.com/2";
const TEXT_CONTENT_CAP = 8000;

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp", ".tiff", ".ico"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".rtf"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".csv", ".json", ".yml", ".yaml", ".toml", ".xml", ".html", ".css", ".js", ".ts", ".py", ".rs", ".go", ".sh"]);

interface DropboxFileEntry {
  ".tag": "file" | "folder" | "deleted";
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
  size?: number;
  server_modified?: string;
  sharing_info?: { read_only: boolean; shared_folder_id: string };
}

interface DropboxListFolderResponse {
  entries: DropboxFileEntry[];
  cursor: string;
  has_more: boolean;
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return "";
  return filename.slice(dot).toLowerCase();
}

function mapContentType(ext: string): ContentType {
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return "file";
}

const limiter = new RateLimiter(3);

async function listAllFiles(
  path: string,
  headers: Record<string, string>,
  includeDeleted: boolean,
  signal?: AbortSignal,
): Promise<DropboxFileEntry[]> {
  const entries: DropboxFileEntry[] = [];

  const body: Record<string, unknown> = {
    path,
    recursive: true,
    include_deleted: includeDeleted,
  };

  await limiter.wait();
  const response = await fetch(`${API_BASE}/files/list_folder`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    await response.text().catch(() => { /* drain body */ });
    throw new Error(`Dropbox API error (${response.status})`);
  }

  let data = (await response.json()) as DropboxListFolderResponse;
  entries.push(...data.entries);

  while (data.has_more) {
    if (signal?.aborted) break;

    await limiter.wait();
    const continueRes = await fetch(`${API_BASE}/files/list_folder/continue`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ cursor: data.cursor }),
      signal,
    });

    if (!continueRes.ok) {
      await continueRes.text().catch(() => { /* drain body */ });
      throw new Error(`Dropbox API pagination error (${continueRes.status})`);
    }

    data = (await continueRes.json()) as DropboxListFolderResponse;
    entries.push(...data.entries);
  }

  return entries;
}

async function downloadTextContent(
  path: string,
  headers: Record<string, string>,
): Promise<string | undefined> {
  try {
    const apiArg = JSON.stringify({ path });
    await limiter.wait();
    const response = await fetch(`${CONTENT_BASE}/files/download`, {
      method: "POST",
      headers: {
        ...headers,
        "Dropbox-API-Arg": apiArg,
      },
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    return text.slice(0, TEXT_CONTENT_CAP);
  } catch {
    return undefined;
  }
}

const connector: Connector = {
  manifest: {
    name: "dropbox",
    version: "0.1.0",
    description: "Index Dropbox files with metadata and text content",
    configSchema: DropboxConfigSchema,
  },

  async validate(config) {
    const result = DropboxConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    const parsed = result.data;
    const token = process.env[parsed.token_env];
    if (!token) {
      return {
        valid: false,
        errors: [`Environment variable ${parsed.token_env} is not set`],
      };
    }
    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = DropboxConfigSchema.parse(config);
    const token = process.env[parsed.token_env];

    if (!token) {
      throw new Error(`Environment variable ${parsed.token_env} is not set`);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    const extensionFilter = parsed.extensions
      ? new Set(parsed.extensions.map((e) => (e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`)))
      : null;

    // Collect files from all configured paths
    const allFiles: DropboxFileEntry[] = [];
    for (const folderPath of parsed.paths) {
      if (options.signal?.aborted) return;
      const files = await listAllFiles(folderPath, headers, parsed.include_deleted, options.signal);
      allFiles.push(...files);
    }

    // Filter to files only (skip folders and optionally deleted)
    const fileEntries = allFiles.filter((entry) => {
      if (entry[".tag"] !== "file") return false;
      if (extensionFilter) {
        const ext = getExtension(entry.name);
        if (!ext || !extensionFilter.has(ext)) return false;
      }
      return true;
    });

    let indexed = 0;

    for (const entry of fileEntries) {
      if (options.signal?.aborted) return;

      const ext = getExtension(entry.name);
      const type = mapContentType(ext);

      // Download text content for readable files
      let content: string | undefined;
      if (TEXT_EXTENSIONS.has(ext)) {
        content = await downloadTextContent(entry.path_lower, headers);
      }

      const uri = entry.path_display;

      const item: ContentItem = {
        id: `dropbox:${entry.id}`,
        source: "dropbox",
        type,
        title: entry.name,
        description: `Dropbox file at ${entry.path_display}`,
        tags: ext ? [ext.slice(1)] : [],
        uri,
        metadata: {
          size: entry.size,
          modified: entry.server_modified,
          path: entry.path_display,
        },
        indexedAt: new Date().toISOString(),
        content,
      };

      indexed++;
      options.onProgress?.(indexed, fileEntries.length);
      yield item;
    }
  },
};

export default connector;

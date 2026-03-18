import { z } from "zod";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GoogleDriveConfigSchema = z.object({
  /** Env var name holding the OAuth access token (default: GOOGLE_TOKEN) */
  token_env: z.string().default("GOOGLE_TOKEN"),
  /** Specific folder IDs to index (recursive). Omit to index entire drive. */
  folder_ids: z.array(z.string()).optional(),
  /** Include trashed files (default: false) */
  include_trashed: z.boolean().default(false),
  /** Filter by MIME types */
  mime_types: z.array(z.string()).optional(),
  /** Max chars of exported text to keep per item (default: 8000) */
  max_content_length: z.number().int().positive().default(8000),
});

type GoogleDriveConfig = z.infer<typeof GoogleDriveConfigSchema>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  description?: string;
  webViewLink?: string;
  size?: string;
  modifiedTime?: string;
  createdTime?: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  shared?: boolean;
  starred?: boolean;
  trashed?: boolean;
  parents?: string[];
}

interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = "https://www.googleapis.com/drive/v3";
const FILE_FIELDS =
  "id,name,mimeType,description,webViewLink,size,modifiedTime,createdTime,owners,shared,starred,trashed,parents";
const LIST_FIELDS = `nextPageToken,files(${FILE_FIELDS})`;
const PAGE_SIZE = 100;

// Google Workspace MIME types that can be exported to plain text
const EXPORTABLE_MIMES: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

// MIME types whose binary content we skip
const BINARY_MIMES = new Set([
  "image/",
  "video/",
  "audio/",
  "application/zip",
  "application/x-tar",
  "application/gzip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/octet-stream",
]);

// ---------------------------------------------------------------------------
// Rate limiter — simple token-bucket (10 req/s)
// ---------------------------------------------------------------------------

class RateLimiter {
  private queue: Array<() => void> = [];
  private timestamps: number[] = [];
  private readonly maxPerSecond: number;

  constructor(maxPerSecond = 10) {
    this.maxPerSecond = maxPerSecond;
  }

  async wait(): Promise<void> {
    const now = Date.now();
    // Remove timestamps older than 1 second
    this.timestamps = this.timestamps.filter((t) => now - t < 1000);

    if (this.timestamps.length < this.maxPerSecond) {
      this.timestamps.push(Date.now());
      return;
    }

    // Wait until the oldest timestamp expires
    const oldest = this.timestamps[0];
    const delay = 1000 - (now - oldest) + 1;
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        this.timestamps = this.timestamps.filter((t) => Date.now() - t < 1000);
        this.timestamps.push(Date.now());
        resolve();
      }, delay);
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isBinaryMime(mimeType: string): boolean {
  if (BINARY_MIMES.has(mimeType)) return true;
  for (const prefix of BINARY_MIMES) {
    if (prefix.endsWith("/") && mimeType.startsWith(prefix)) return true;
  }
  return false;
}

function mapMimeToContentType(
  mimeType: string,
): "document" | "image" | "video" | "file" {
  if (
    mimeType.startsWith("application/vnd.google-apps.document") ||
    mimeType.startsWith("application/vnd.google-apps.spreadsheet") ||
    mimeType.startsWith("application/vnd.google-apps.presentation") ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/")
  ) {
    return "document";
  }
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

function mimeCategory(mimeType: string): string {
  if (mimeType.includes("document") || mimeType.includes("word"))
    return "document";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
    return "spreadsheet";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint"))
    return "presentation";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "pdf";
  return "other";
}

function buildWebLink(file: DriveFile): string {
  if (file.webViewLink) return file.webViewLink;
  // Fallback: generic Google Drive link
  return `https://drive.google.com/file/d/${file.id}/view`;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function driveApiFetch<T>(
  path: string,
  headers: Record<string, string>,
  rateLimiter: RateLimiter,
  signal?: AbortSignal,
): Promise<T> {
  await rateLimiter.wait();

  const url = path.startsWith("https://") ? path : `${API_BASE}${path}`;
  const response = await fetch(url, { headers, signal });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      // Don't leak response body
      await response.text().catch(() => { /* drain body */ });
      throw new Error(
        `Google Drive API auth error (${response.status}). Check your OAuth token.`,
      );
    }
    if (response.status === 429) {
      await response.text().catch(() => { /* drain body */ });
      throw new Error("Google Drive API rate limit exceeded.");
    }
    await response.text().catch(() => { /* drain body */ });
    throw new Error(`Google Drive API error (${response.status})`);
  }

  return (await response.json()) as T;
}

async function driveApiFetchText(
  path: string,
  headers: Record<string, string>,
  rateLimiter: RateLimiter,
  signal?: AbortSignal,
): Promise<string> {
  await rateLimiter.wait();

  const url = path.startsWith("https://") ? path : `${API_BASE}${path}`;
  const response = await fetch(url, { headers, signal });

  if (!response.ok) {
    await response.text().catch(() => { /* drain body */ });
    return "";
  }

  return response.text();
}

// ---------------------------------------------------------------------------
// List files with pagination
// ---------------------------------------------------------------------------

async function listFiles(
  query: string,
  headers: Record<string, string>,
  rateLimiter: RateLimiter,
  signal?: AbortSignal,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    if (signal?.aborted) break;

    let path = `/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(LIST_FIELDS)}&pageSize=${PAGE_SIZE}`;
    if (pageToken) {
      path += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const data = await driveApiFetch<DriveFileList>(
      path,
      headers,
      rateLimiter,
      signal,
    );
    files.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return files;
}

// ---------------------------------------------------------------------------
// Recursive folder traversal
// ---------------------------------------------------------------------------

async function listFilesInFolder(
  folderId: string,
  config: GoogleDriveConfig,
  headers: Record<string, string>,
  rateLimiter: RateLimiter,
  signal?: AbortSignal,
): Promise<DriveFile[]> {
  const parts: string[] = [`'${folderId}' in parents`];
  if (!config.include_trashed) parts.push("trashed = false");
  if (config.mime_types && config.mime_types.length > 0) {
    const mimeFilter = config.mime_types
      .map((m) => `mimeType = '${m}'`)
      .join(" or ");
    // Include folders too so we can recurse
    parts.push(`(${mimeFilter} or mimeType = 'application/vnd.google-apps.folder')`);
  }

  const query = parts.join(" and ");
  const files = await listFiles(query, headers, rateLimiter, signal);

  // Separate folders from regular files
  const folders = files.filter(
    (f) => f.mimeType === "application/vnd.google-apps.folder",
  );
  const regularFiles = files.filter(
    (f) => f.mimeType !== "application/vnd.google-apps.folder",
  );

  // Recurse into sub-folders
  for (const folder of folders) {
    if (signal?.aborted) break;
    const subFiles = await listFilesInFolder(
      folder.id,
      config,
      headers,
      rateLimiter,
      signal,
    );
    regularFiles.push(...subFiles);
  }

  return regularFiles;
}

// ---------------------------------------------------------------------------
// Export content for Google Workspace docs
// ---------------------------------------------------------------------------

async function fetchContent(
  file: DriveFile,
  maxLength: number,
  headers: Record<string, string>,
  rateLimiter: RateLimiter,
  signal?: AbortSignal,
): Promise<string | undefined> {
  // Skip binary files
  if (isBinaryMime(file.mimeType)) return undefined;

  const exportMime = EXPORTABLE_MIMES[file.mimeType];
  if (exportMime) {
    // Google Workspace file — use export endpoint
    const text = await driveApiFetchText(
      `/files/${file.id}/export?mimeType=${encodeURIComponent(exportMime)}`,
      headers,
      rateLimiter,
      signal,
    );
    return text ? text.slice(0, maxLength) : undefined;
  }

  // For plain text / code files, download directly
  if (
    file.mimeType.startsWith("text/") ||
    file.mimeType === "application/json" ||
    file.mimeType === "application/xml"
  ) {
    const text = await driveApiFetchText(
      `/files/${file.id}?alt=media`,
      headers,
      rateLimiter,
      signal,
    );
    return text ? text.slice(0, maxLength) : undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

const connector: Connector = {
  manifest: {
    name: "google-drive",
    version: "0.1.0",
    description:
      "Index Google Drive files with metadata and content extraction for Google Docs/Sheets/Slides",
    configSchema: GoogleDriveConfigSchema,
  },

  async validate(config) {
    const result = GoogleDriveConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      };
    }

    const parsed = result.data;
    const token = process.env[parsed.token_env];
    if (!token) {
      return {
        valid: false,
        errors: [
          `Environment variable ${parsed.token_env} is not set. Provide a Google OAuth access token.`,
        ],
      };
    }

    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = GoogleDriveConfigSchema.parse(config);
    const token = process.env[parsed.token_env];

    if (!token) {
      throw new Error(
        `Environment variable ${parsed.token_env} is not set. Provide a Google OAuth access token.`,
      );
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Trove/0.1.0",
    };

    const rateLimiter = new RateLimiter(10);

    // Collect files
    let files: DriveFile[];

    if (parsed.folder_ids && parsed.folder_ids.length > 0) {
      // Recursive traversal of specified folders
      files = [];
      for (const folderId of parsed.folder_ids) {
        if (options.signal?.aborted) return;
        const folderFiles = await listFilesInFolder(
          folderId,
          parsed,
          headers,
          rateLimiter,
          options.signal,
        );
        files.push(...folderFiles);
      }
    } else {
      // List all files in drive
      const parts: string[] = [];
      if (!parsed.include_trashed) parts.push("trashed = false");
      if (parsed.mime_types && parsed.mime_types.length > 0) {
        const mimeFilter = parsed.mime_types
          .map((m) => `mimeType = '${m}'`)
          .join(" or ");
        parts.push(`(${mimeFilter})`);
      }
      // Exclude folders from top-level listing (they're organizational, not content)
      parts.push("mimeType != 'application/vnd.google-apps.folder'");

      const query = parts.length > 0 ? parts.join(" and ") : "trashed = false";
      files = await listFiles(query, headers, rateLimiter, options.signal);
    }

    // Deduplicate by file ID (folders may overlap)
    const seen = new Set<string>();
    const uniqueFiles: DriveFile[] = [];
    for (const file of files) {
      if (!seen.has(file.id)) {
        seen.add(file.id);
        uniqueFiles.push(file);
      }
    }

    let indexed = 0;

    for (const file of uniqueFiles) {
      if (options.signal?.aborted) return;

      // Fetch content for exportable / text files
      let content: string | undefined;
      try {
        content = await fetchContent(
          file,
          parsed.max_content_length,
          headers,
          rateLimiter,
          options.signal,
        );
      } catch {
        // Content fetch failure is non-fatal — index metadata only
        content = undefined;
      }

      const category = mimeCategory(file.mimeType);
      const tags: string[] = [category];
      if (file.starred) tags.push("starred");
      if (file.shared) tags.push("shared");

      const item: ContentItem = {
        id: `google-drive:${file.id}`,
        source: "google-drive",
        type: mapMimeToContentType(file.mimeType),
        title: file.name,
        description:
          file.description ??
          `Google Drive ${category} — ${file.name}`,
        tags,
        uri: buildWebLink(file),
        metadata: {
          mimeType: file.mimeType,
          size: file.size ?? null,
          modifiedTime: file.modifiedTime ?? null,
          createdTime: file.createdTime ?? null,
          owners:
            file.owners?.map((o) => ({
              name: o.displayName,
              email: o.emailAddress,
            })) ?? [],
          shared: file.shared ?? false,
          starred: file.starred ?? false,
        },
        indexedAt: new Date().toISOString(),
        content,
      };

      indexed++;
      options.onProgress?.(indexed, uniqueFiles.length);
      yield item;
    }
  },
};

export default connector;

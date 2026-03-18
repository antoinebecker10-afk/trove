import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import connector from "./index.js";
import type { IndexOptions } from "@trove/shared";

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function textResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDriveFile(overrides: Record<string, unknown> = {}) {
  return {
    id: "file-1",
    name: "My Document",
    mimeType: "application/vnd.google-apps.document",
    description: "A test doc",
    webViewLink: "https://docs.google.com/document/d/file-1/edit",
    size: "1024",
    modifiedTime: "2025-01-01T00:00:00Z",
    createdTime: "2024-06-01T00:00:00Z",
    owners: [{ displayName: "Alice", emailAddress: "alice@example.com" }],
    shared: false,
    starred: true,
    trashed: false,
    parents: ["root"],
    ...overrides,
  };
}

async function collectItems(
  config: Record<string, unknown>,
  opts?: Partial<IndexOptions>,
) {
  const items = [];
  const options: IndexOptions = { signal: undefined, ...opts };
  for await (const item of connector.index(config, options)) {
    items.push(item);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("@trove/connector-google-drive", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.GOOGLE_TOKEN = "test-token-123";
  });

  afterEach(() => {
    delete process.env.GOOGLE_TOKEN;
  });

  // ---- Manifest ----

  describe("manifest", () => {
    it("has correct name and version", () => {
      expect(connector.manifest.name).toBe("google-drive");
      expect(connector.manifest.version).toBe("0.1.0");
    });
  });

  // ---- Validate ----

  describe("validate", () => {
    it("returns valid for correct config with token set", async () => {
      const result = await connector.validate({});
      expect(result.valid).toBe(true);
    });

    it("returns invalid when token env is not set", async () => {
      delete process.env.GOOGLE_TOKEN;
      const result = await connector.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("GOOGLE_TOKEN");
    });

    it("returns invalid for bad config shape", async () => {
      const result = await connector.validate({
        include_trashed: "yes",
      });
      expect(result.valid).toBe(false);
    });

    it("accepts custom token_env", async () => {
      process.env.MY_DRIVE_TOKEN = "my-token";
      const result = await connector.validate({ token_env: "MY_DRIVE_TOKEN" });
      expect(result.valid).toBe(true);
      delete process.env.MY_DRIVE_TOKEN;
    });
  });

  // ---- Index — basic file listing ----

  describe("index", () => {
    it("yields items for listed files", async () => {
      const file = makeDriveFile();

      // List files response
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );
      // Export content response
      mockFetch.mockResolvedValueOnce(
        textResponse("Hello world, this is my document."),
      );

      const items = await collectItems({});
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("google-drive:file-1");
      expect(items[0].source).toBe("google-drive");
      expect(items[0].type).toBe("document");
      expect(items[0].title).toBe("My Document");
      expect(items[0].description).toBe("A test doc");
      expect(items[0].uri).toBe(
        "https://docs.google.com/document/d/file-1/edit",
      );
      expect(items[0].content).toBe("Hello world, this is my document.");
      expect(items[0].tags).toContain("document");
      expect(items[0].tags).toContain("starred");
      expect(items[0].metadata.mimeType).toBe(
        "application/vnd.google-apps.document",
      );
    });

    it("skips content for image files", async () => {
      const file = makeDriveFile({
        id: "img-1",
        name: "photo.png",
        mimeType: "image/png",
        description: null,
        starred: false,
      });

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );

      const items = await collectItems({});
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("image");
      expect(items[0].content).toBeUndefined();
      // Only list call, no content fetch for binary
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("skips content for video files", async () => {
      const file = makeDriveFile({
        id: "vid-1",
        name: "recording.mp4",
        mimeType: "video/mp4",
      });

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );

      const items = await collectItems({});
      expect(items[0].type).toBe("video");
      expect(items[0].content).toBeUndefined();
    });

    it("handles pagination with nextPageToken", async () => {
      const file1 = makeDriveFile({ id: "f1", name: "Doc 1" });
      const file2 = makeDriveFile({ id: "f2", name: "Doc 2" });

      // Page 1
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file1], nextPageToken: "page2token" }),
      );
      // Page 2
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file2], nextPageToken: undefined }),
      );
      // Content for file1
      mockFetch.mockResolvedValueOnce(textResponse("Content 1"));
      // Content for file2
      mockFetch.mockResolvedValueOnce(textResponse("Content 2"));

      const items = await collectItems({});
      expect(items).toHaveLength(2);
      expect(items[0].title).toBe("Doc 1");
      expect(items[1].title).toBe("Doc 2");
    });

    it("truncates content at max_content_length", async () => {
      const file = makeDriveFile();
      const longContent = "A".repeat(200);

      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );
      mockFetch.mockResolvedValueOnce(textResponse(longContent));

      const items = await collectItems({ max_content_length: 50 });
      expect(items[0].content).toHaveLength(50);
    });

    it("throws when token is missing", async () => {
      delete process.env.GOOGLE_TOKEN;
      await expect(collectItems({})).rejects.toThrow("GOOGLE_TOKEN");
    });

    it("reports progress via onProgress", async () => {
      const file = makeDriveFile();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );
      mockFetch.mockResolvedValueOnce(textResponse("content"));

      const progress = vi.fn();
      await collectItems({}, { onProgress: progress });
      expect(progress).toHaveBeenCalledWith(1, 1);
    });

    it("handles API auth errors", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "forbidden" }, 403),
      );

      await expect(collectItems({})).rejects.toThrow("auth error");
    });

    it("deduplicates files by ID", async () => {
      const file = makeDriveFile({ id: "dup-1", name: "Same File" });

      // Simulate folder traversal returning duplicates via two folder_ids
      // Folder 1 contents
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );
      // Folder 2 contents — same file
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );
      // Content fetch — once
      mockFetch.mockResolvedValueOnce(textResponse("content"));

      const items = await collectItems({
        folder_ids: ["folder-a", "folder-b"],
      });
      expect(items).toHaveLength(1);
    });

    it("sets description fallback when file has no description", async () => {
      const file = makeDriveFile({ description: undefined });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );
      mockFetch.mockResolvedValueOnce(textResponse("text"));

      const items = await collectItems({});
      expect(items[0].description).toContain("Google Drive");
      expect(items[0].description).toContain("My Document");
    });

    it("handles content fetch failure gracefully", async () => {
      const file = makeDriveFile();
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );
      // Content fetch fails
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const items = await collectItems({});
      expect(items).toHaveLength(1);
      expect(items[0].content).toBeUndefined();
    });

    it("maps file type correctly for PDFs", async () => {
      const file = makeDriveFile({
        id: "pdf-1",
        mimeType: "application/pdf",
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );

      const items = await collectItems({});
      expect(items[0].type).toBe("document");
    });

    it("maps file type correctly for generic files", async () => {
      const file = makeDriveFile({
        id: "zip-1",
        mimeType: "application/zip",
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );

      const items = await collectItems({});
      expect(items[0].type).toBe("file");
    });

    it("supports abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      const items = await collectItems(
        {},
        { signal: controller.signal },
      );
      // Should produce no items since signal is already aborted
      // The behaviour depends on whether fetch throws or we check before
      // Either 0 items or an AbortError is acceptable
      expect(items.length).toBeLessThanOrEqual(0);
    });

    it("fetches text content for plain text files", async () => {
      const file = makeDriveFile({
        id: "txt-1",
        name: "notes.txt",
        mimeType: "text/plain",
      });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );
      // alt=media download
      mockFetch.mockResolvedValueOnce(textResponse("Plain text content here"));

      const items = await collectItems({});
      expect(items[0].content).toBe("Plain text content here");
    });

    it("includes shared tag when file is shared", async () => {
      const file = makeDriveFile({ shared: true, starred: false });
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [file], nextPageToken: undefined }),
      );
      mockFetch.mockResolvedValueOnce(textResponse("text"));

      const items = await collectItems({});
      expect(items[0].tags).toContain("shared");
      expect(items[0].tags).not.toContain("starred");
    });

    it("recursively traverses folders", async () => {
      const subfolder = makeDriveFile({
        id: "subfolder-1",
        name: "Subfolder",
        mimeType: "application/vnd.google-apps.folder",
      });
      const fileInSubfolder = makeDriveFile({
        id: "nested-file-1",
        name: "Nested Doc",
      });

      // Root folder lists subfolder + no regular files
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ files: [subfolder], nextPageToken: undefined }),
      );
      // Subfolder lists one file
      mockFetch.mockResolvedValueOnce(
        jsonResponse({
          files: [fileInSubfolder],
          nextPageToken: undefined,
        }),
      );
      // Content for nested file
      mockFetch.mockResolvedValueOnce(textResponse("Nested content"));

      const items = await collectItems({ folder_ids: ["root-folder"] });
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("Nested Doc");
    });
  });
});

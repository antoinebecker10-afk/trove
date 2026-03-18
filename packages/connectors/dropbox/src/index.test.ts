import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import connector from "./index.js";

// Helpers to collect async generator results
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

const FAKE_TOKEN = "dbx-test-token-1234";

function mockListFolderResponse(entries: unknown[], hasMore = false, cursor = "cursor-1") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ entries, cursor, has_more: hasMore }),
    text: async () => "",
    headers: new Headers(),
  } as unknown as Response;
}

function mockDownloadResponse(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    headers: new Headers(),
  } as unknown as Response;
}

function mockErrorResponse(status: number) {
  return {
    ok: false,
    status,
    text: async () => "error",
    headers: new Headers(),
  } as unknown as Response;
}

const sampleFile = {
  ".tag": "file",
  id: "id:abc123",
  name: "notes.md",
  path_lower: "/docs/notes.md",
  path_display: "/Docs/notes.md",
  size: 1024,
  server_modified: "2025-01-15T10:00:00Z",
};

const sampleImage = {
  ".tag": "file",
  id: "id:img456",
  name: "photo.jpg",
  path_lower: "/photos/photo.jpg",
  path_display: "/Photos/photo.jpg",
  size: 204800,
  server_modified: "2025-02-01T12:00:00Z",
};

const sampleFolder = {
  ".tag": "folder",
  id: "id:folder1",
  name: "Docs",
  path_lower: "/docs",
  path_display: "/Docs",
};

describe("connector-dropbox", () => {
  describe("manifest", () => {
    it("has correct name and version", () => {
      expect(connector.manifest.name).toBe("dropbox");
      expect(connector.manifest.version).toBe("0.1.0");
    });
  });

  describe("validate", () => {
    beforeEach(() => {
      vi.stubEnv("DROPBOX_TOKEN", FAKE_TOKEN);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("accepts valid config with defaults", async () => {
      const result = await connector.validate({});
      expect(result.valid).toBe(true);
    });

    it("accepts config with all options", async () => {
      const result = await connector.validate({
        token_env: "DROPBOX_TOKEN",
        paths: ["/docs", "/photos"],
        include_deleted: false,
        extensions: [".md", ".txt"],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects when token env var is not set", async () => {
      vi.stubEnv("DROPBOX_TOKEN", "");
      // Need to delete it entirely
      delete process.env.DROPBOX_TOKEN;
      const result = await connector.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("DROPBOX_TOKEN");
    });
  });

  describe("index", () => {
    beforeEach(() => {
      vi.stubEnv("DROPBOX_TOKEN", FAKE_TOKEN);
      vi.spyOn(globalThis, "fetch");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it("indexes files from Dropbox", async () => {
      vi.mocked(fetch)
        // list_folder call
        .mockResolvedValueOnce(mockListFolderResponse([sampleFile, sampleImage, sampleFolder]))
        // download text content for .md file
        .mockResolvedValueOnce(mockDownloadResponse("# My Notes\nHello world"));

      const items = await collect(connector.index({}, { signal: undefined }));

      expect(items).toHaveLength(2); // folder is skipped

      // Check the .md file
      const mdItem = items.find((i) => i.title === "notes.md")!;
      expect(mdItem.id).toBe("dropbox:id:abc123");
      expect(mdItem.source).toBe("dropbox");
      expect(mdItem.type).toBe("file");
      expect(mdItem.uri).toBe("/Docs/notes.md");
      expect(mdItem.content).toBe("# My Notes\nHello world");
      expect(mdItem.metadata.size).toBe(1024);

      // Check the image file
      const imgItem = items.find((i) => i.title === "photo.jpg")!;
      expect(imgItem.id).toBe("dropbox:id:img456");
      expect(imgItem.type).toBe("image");
      expect(imgItem.content).toBeUndefined();
    });

    it("handles pagination with has_more", async () => {
      const file2 = { ...sampleFile, id: "id:def789", name: "readme.txt", path_lower: "/readme.txt", path_display: "/readme.txt" };

      vi.mocked(fetch)
        // First page
        .mockResolvedValueOnce(mockListFolderResponse([sampleFile], true, "cursor-page1"))
        // Continue page
        .mockResolvedValueOnce(mockListFolderResponse([file2], false, "cursor-page2"))
        // Download for .md
        .mockResolvedValueOnce(mockDownloadResponse("notes content"))
        // Download for .txt
        .mockResolvedValueOnce(mockDownloadResponse("readme content"));

      const items = await collect(connector.index({}, { signal: undefined }));
      expect(items).toHaveLength(2);
    });

    it("filters by extensions when configured", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockListFolderResponse([sampleFile, sampleImage]));
      vi.mocked(fetch).mockResolvedValueOnce(mockDownloadResponse("content"));

      const items = await collect(
        connector.index({ extensions: [".md"] }, { signal: undefined }),
      );

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("notes.md");
    });

    it("throws on missing token", async () => {
      delete process.env.DROPBOX_TOKEN;
      await expect(
        collect(connector.index({}, { signal: undefined })),
      ).rejects.toThrow("DROPBOX_TOKEN");
    });

    it("throws on API error", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(mockErrorResponse(401));

      await expect(
        collect(connector.index({}, { signal: undefined })),
      ).rejects.toThrow("Dropbox API error (401)");
    });

    it("calls onProgress callback", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(mockListFolderResponse([sampleImage]))

      const progress = vi.fn();
      const items = await collect(connector.index({}, { signal: undefined, onProgress: progress }));

      expect(items).toHaveLength(1);
      expect(progress).toHaveBeenCalledWith(1, 1);
    });
  });
});

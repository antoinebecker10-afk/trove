import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve as pathResolve, join as pathJoin } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

// --- Frontmatter parser tests ---

describe("parseFrontmatter", () => {
  it("parses basic frontmatter with string values", () => {
    const input = `---
title: My Note
date: 2025-01-15
---
# Hello World

Some content here.`;

    const result = parseFrontmatter(input);
    expect(result.data.title).toBe("My Note");
    expect(result.data.date).toBe("2025-01-15");
    expect(result.content).toBe("# Hello World\n\nSome content here.");
  });

  it("parses inline array tags", () => {
    const input = `---
tags: [rust, gamedev, bevy]
---
Content`;

    const result = parseFrontmatter(input);
    expect(result.data.tags).toEqual(["rust", "gamedev", "bevy"]);
  });

  it("parses list-style tags", () => {
    const input = `---
tags:
  - rust
  - gamedev
  - bevy
---
Content`;

    const result = parseFrontmatter(input);
    expect(result.data.tags).toEqual(["rust", "gamedev", "bevy"]);
  });

  it("handles empty frontmatter", () => {
    const input = `---
---
Content`;

    const result = parseFrontmatter(input);
    expect(result.data).toEqual({});
    expect(result.content).toBe("Content");
  });

  it("returns raw content when no frontmatter", () => {
    const input = "# Just a heading\n\nNo frontmatter here.";
    const result = parseFrontmatter(input);
    expect(result.data).toEqual({});
    expect(result.content).toBe(input);
  });

  it("handles unclosed frontmatter gracefully", () => {
    const input = "---\ntitle: Oops\nNo closing marker";
    const result = parseFrontmatter(input);
    expect(result.data).toEqual({});
    expect(result.content).toBe(input);
  });

  it("parses quoted values", () => {
    const input = `---
title: "My \"Fancy\" Note"
author: 'Someone'
---
Body`;

    const result = parseFrontmatter(input);
    expect(result.data.title).toBe('My "Fancy" Note');
    expect(result.data.author).toBe("Someone");
  });

  it("handles empty array syntax", () => {
    const input = `---
tags: []
---
Content`;

    const result = parseFrontmatter(input);
    expect(result.data.tags).toEqual([]);
  });

  it("parses aliases", () => {
    const input = `---
aliases: [myalias, another]
---
Content`;

    const result = parseFrontmatter(input);
    expect(result.data.aliases).toEqual(["myalias", "another"]);
  });
});

// --- Connector tests (mocked fs) ---

// We mock node:fs/promises and node:path at the module level
const mockFiles: Record<string, string> = {};
const mockStats: Record<string, { size: number; mtime: Date; isFile: () => boolean; isDirectory: () => boolean }> = {};
const mockDirEntries: Record<string, Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean }>> = {};

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(async (dir: string, _opts?: unknown) => {
    const entries = mockDirEntries[dir];
    if (!entries) throw new Error(`ENOENT: ${dir}`);
    return entries;
  }),
  stat: vi.fn(async (path: string) => {
    const s = mockStats[path];
    if (!s) throw new Error(`ENOENT: ${path}`);
    return s;
  }),
  readFile: vi.fn(async (path: string, _enc?: string) => {
    const content = mockFiles[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }),
  realpath: vi.fn(async (path: string) => {
    // Simply return the path as-is in tests (no symlinks)
    return path;
  }),
}));

function setupVault(vaultPath: string, files: Record<string, string>) {
  // Resolve the vault path so mock keys match what the connector produces on this OS
  const resolved = pathResolve(vaultPath);

  // Clear mocks
  for (const key of Object.keys(mockFiles)) delete mockFiles[key];
  for (const key of Object.keys(mockStats)) delete mockStats[key];
  for (const key of Object.keys(mockDirEntries)) delete mockDirEntries[key];

  // Group files by directory
  const dirs = new Map<string, Array<{ name: string; fullPath: string; isDir: boolean }>>();

  // Ensure vault root exists
  dirs.set(resolved, []);

  for (const [relPath, content] of Object.entries(files)) {
    const parts = relPath.split("/");
    const fileName = parts.pop()!;
    const fullPath = pathJoin(resolved, ...parts, fileName);
    mockFiles[fullPath] = content;

    // Build directory hierarchy
    let currentDir = resolved;
    for (const part of parts) {
      if (!dirs.has(currentDir)) dirs.set(currentDir, []);
      const subDir = pathJoin(currentDir, part);
      const existing = dirs.get(currentDir)!;
      if (!existing.find((e) => e.name === part)) {
        existing.push({ name: part, fullPath: subDir, isDir: true });
      }
      if (!dirs.has(subDir)) dirs.set(subDir, []);
      currentDir = subDir;
    }

    // Add file entry
    if (!dirs.has(currentDir)) dirs.set(currentDir, []);
    dirs.get(currentDir)!.push({ name: fileName, fullPath, isDir: false });

    // Add stat for file
    mockStats[fullPath] = {
      size: Buffer.byteLength(content, "utf-8"),
      mtime: new Date("2025-06-01T12:00:00Z"),
      isFile: () => true,
      isDirectory: () => false,
    };
  }

  // Set up directory entries and stats
  for (const [dirPath, entries] of dirs) {
    mockDirEntries[dirPath] = entries.map((e) => ({
      name: e.name,
      isFile: () => !e.isDir,
      isDirectory: () => e.isDir,
    }));
    mockStats[dirPath] = {
      size: 0,
      mtime: new Date("2025-06-01T12:00:00Z"),
      isFile: () => false,
      isDirectory: () => true,
    };
  }
}

describe("ObsidianConnector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("indexes markdown files with frontmatter and wiki-links", async () => {
    const vaultPath = "/test/vault";
    setupVault(vaultPath, {
      "note-one.md": `---
title: My First Note
tags: [rust, dev]
---
# Hello

This is my note with a [[Second Note]] link and #programming tag.`,
      "subfolder/note-two.md": `---
tags:
  - journal
  - daily
---
# Daily Log

Today I worked on [[My First Note]] and #coding stuff.`,
    });

    const { default: connector } = await import("./index.js");

    const items: Array<{ id: string; title: string; tags: string[]; content?: string }> = [];
    for await (const item of connector.index({ vault_path: vaultPath }, {})) {
      items.push(item);
    }

    expect(items).toHaveLength(2);

    const note1 = items.find((i) => i.id === "obsidian:note-one.md");
    expect(note1).toBeDefined();
    expect(note1!.title).toBe("My First Note");
    expect(note1!.tags).toContain("rust");
    expect(note1!.tags).toContain("dev");
    expect(note1!.tags).toContain("Second Note");
    expect(note1!.tags).toContain("programming");

    const note2 = items.find((i) => i.id === "obsidian:subfolder/note-two.md");
    expect(note2).toBeDefined();
    expect(note2!.tags).toContain("journal");
    expect(note2!.tags).toContain("daily");
    expect(note2!.tags).toContain("My First Note");
    expect(note2!.tags).toContain("coding");
  });

  it("validates config correctly", async () => {
    const { default: connector } = await import("./index.js");

    const invalid = await connector.validate({});
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toBeDefined();
    expect(invalid.errors!.length).toBeGreaterThan(0);

    // Valid config but path doesn't exist -> validation fails
    const noPath = await connector.validate({ vault_path: "/nonexistent/vault" });
    expect(noPath.valid).toBe(false);
  });

  it("skips .obsidian directory", async () => {
    const vaultPath = "/test/vault2";
    setupVault(vaultPath, {
      "real-note.md": "# Real content",
    });
    // Manually add .obsidian dir entry
    mockDirEntries[pathResolve(vaultPath)]!.push({
      name: ".obsidian",
      isFile: () => false,
      isDirectory: () => true,
    });

    const { default: connector } = await import("./index.js");

    const items: Array<{ id: string }> = [];
    for await (const item of connector.index({ vault_path: vaultPath }, {})) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("obsidian:real-note.md");
  });

  it("uses filename as title when no frontmatter title", async () => {
    const vaultPath = "/test/vault3";
    setupVault(vaultPath, {
      "Untitled Note.md": "Just some plain text without frontmatter.",
    });

    const { default: connector } = await import("./index.js");

    const items: Array<{ title: string }> = [];
    for await (const item of connector.index({ vault_path: vaultPath }, {})) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Untitled Note");
  });

  it("caps content at max_content_length", async () => {
    const vaultPath = "/test/vault4";
    const longContent = "A".repeat(20000);
    setupVault(vaultPath, {
      "long.md": longContent,
    });

    const { default: connector } = await import("./index.js");

    const items: Array<{ content?: string }> = [];
    for await (const item of connector.index(
      { vault_path: vaultPath, max_content_length: 100 },
      {},
    )) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(items[0].content!.length).toBe(100);
  });

  it("indexes attachments when include_attachments is true", async () => {
    const vaultPath = "/test/vault5";
    setupVault(vaultPath, {
      "note.md": "# Note",
      "assets/photo.png": "<binary>",
    });

    const { default: connector } = await import("./index.js");

    // Without attachments
    const withoutAttachments: Array<{ id: string }> = [];
    for await (const item of connector.index({ vault_path: vaultPath }, {})) {
      withoutAttachments.push(item);
    }
    expect(withoutAttachments).toHaveLength(1);

    // With attachments
    const withAttachments: Array<{ id: string; type: string }> = [];
    for await (const item of connector.index(
      { vault_path: vaultPath, include_attachments: true },
      {},
    )) {
      withAttachments.push(item);
    }
    expect(withAttachments).toHaveLength(2);
    const attachment = withAttachments.find((i) => i.id === "obsidian:assets/photo.png");
    expect(attachment).toBeDefined();
    expect(attachment!.type).toBe("image");
  });
});

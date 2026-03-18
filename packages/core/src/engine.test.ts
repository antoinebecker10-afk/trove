import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ContentItem, TroveConfig } from "@trove/shared";

// Mock node:fs/promises before importing engine
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue({ code: "ENOENT" }),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

// Mock plugin-loader
vi.mock("./plugin-loader.js", () => ({
  loadConnector: vi.fn(),
}));

// Mock config
vi.mock("./config.js", () => ({
  loadConfig: vi.fn().mockResolvedValue({
    storage: "json",
    data_dir: "/tmp/trove-test",
    embeddings: "local",
    sources: [],
  }),
  resolveDataDir: vi.fn().mockReturnValue("/tmp/trove-test"),
}));

import { TroveEngine } from "./engine.js";
import { loadConnector } from "./plugin-loader.js";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test:item-1",
    source: "test",
    type: "file",
    title: "Test Item",
    description: "A test item",
    tags: ["test"],
    uri: "/path/to/file",
    metadata: {},
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("TroveEngine", () => {
  it("creates an engine with default config", async () => {
    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [],
      },
    });
    expect(engine).toBeDefined();
  });

  it("returns config via getConfig", async () => {
    const config: TroveConfig = {
      storage: "json",
      data_dir: "/tmp/trove-test",
      embeddings: "local",
      sources: [{ connector: "local", config: { paths: ["/home"] } }],
    };
    const engine = await TroveEngine.create({ config });
    const result = engine.getConfig();
    expect(result.storage).toBe("json");
    expect(result.sources).toHaveLength(1);
  });

  it("getStats returns empty stats initially", async () => {
    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [],
      },
    });
    const stats = await engine.getStats();
    expect(stats.totalItems).toBe(0);
  });

  it("getItem returns null for missing item", async () => {
    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [],
      },
    });
    const item = await engine.getItem("nonexistent");
    expect(item).toBeNull();
  });

  it("search returns empty for empty query", async () => {
    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [],
      },
    });
    const results = await engine.search("", {});
    expect(results).toEqual([]);
  });

  it("keywordSearch returns empty for empty query", async () => {
    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [],
      },
    });
    const results = await engine.keywordSearch("   ");
    expect(results).toEqual([]);
  });

  it("search strips control characters from query", async () => {
    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [],
      },
    });
    // Should not throw even with control chars
    const results = await engine.search("\x00\x01test\x7f", {});
    expect(Array.isArray(results)).toBe(true);
  });

  it("index throws when no sources configured", async () => {
    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [],
      },
    });
    await expect(engine.index()).rejects.toThrow("No sources configured");
  });

  it("index throws for unknown source name", async () => {
    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [{ connector: "local", config: {} }],
      },
    });
    await expect(engine.index("nonexistent")).rejects.toThrow(
      'No source configured with connector "nonexistent"',
    );
  });

  it("indexes items from a connector", async () => {
    const mockConnector = {
      manifest: { name: "test", version: "0.1.0", description: "test" },
      validate: vi.fn().mockResolvedValue({ valid: true }),
      index: vi.fn().mockImplementation(async function* () {
        yield makeItem({ id: "test:1", title: "Item 1" });
        yield makeItem({ id: "test:2", title: "Item 2" });
      }),
    };

    vi.mocked(loadConnector).mockResolvedValue(mockConnector as any);

    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [{ connector: "test", config: {} }],
      },
    });

    const count = await engine.index();
    expect(count).toBe(2);

    // Items should be retrievable
    const item = await engine.getItem("test:1");
    expect(item).not.toBeNull();
    expect(item!.title).toBe("Item 1");
  });

  it("throws when connector validation fails", async () => {
    const mockConnector = {
      manifest: { name: "test", version: "0.1.0", description: "test" },
      validate: vi.fn().mockResolvedValue({
        valid: false,
        errors: ["paths: Required"],
      }),
      index: vi.fn(),
    };

    vi.mocked(loadConnector).mockResolvedValue(mockConnector as any);

    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [{ connector: "test", config: {} }],
      },
    });

    await expect(engine.index()).rejects.toThrow("config is invalid");
  });

  it("keywordSearch matches items by title/description/tags", async () => {
    const mockConnector = {
      manifest: { name: "test", version: "0.1.0", description: "test" },
      validate: vi.fn().mockResolvedValue({ valid: true }),
      index: vi.fn().mockImplementation(async function* () {
        yield makeItem({
          id: "test:ts",
          title: "utils.ts",
          description: "TypeScript utility functions",
          tags: ["typescript"],
        });
        yield makeItem({
          id: "test:py",
          title: "main.py",
          description: "Python entry point",
          tags: ["python"],
        });
      }),
    };

    vi.mocked(loadConnector).mockResolvedValue(mockConnector as any);

    const engine = await TroveEngine.create({
      config: {
        storage: "json",
        data_dir: "/tmp/trove-test",
        embeddings: "local",
        sources: [{ connector: "test", config: {} }],
      },
    });

    await engine.index();

    const results = await engine.keywordSearch("typescript");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("test:ts");

    const pyResults = await engine.keywordSearch("python");
    expect(pyResults).toHaveLength(1);
    expect(pyResults[0].id).toBe("test:py");
  });
});

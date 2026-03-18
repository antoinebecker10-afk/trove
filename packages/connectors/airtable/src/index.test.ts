import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import connector from "./index.js";
import type { IndexOptions, ContentItem } from "@trove/shared";

function mockFetch(responses: Map<string, unknown>) {
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    // Sort patterns by length descending so more specific patterns match first
    const sortedEntries = [...responses.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [pattern, body] of sortedEntries) {
      if (urlStr.includes(pattern)) {
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
          headers: new Headers(),
        } as Response;
      }
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => "Not found",
      headers: new Headers(),
    } as Response;
  });
}

const FAKE_BASE = {
  id: "appABC123",
  name: "Test Base",
  permissionLevel: "create",
};

const FAKE_TABLE = {
  id: "tblXYZ789",
  name: "Tasks",
  primaryFieldId: "fldPrimary",
  fields: [
    { id: "fldPrimary", name: "Name", type: "singleLineText" },
    { id: "fldStatus", name: "Status", type: "singleSelect" },
  ],
};

const FAKE_RECORD = {
  id: "recABC",
  fields: { Name: "Fix bug", Status: "Done" },
  createdTime: "2025-01-15T10:00:00.000Z",
};

describe("connector-airtable", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AIRTABLE_TOKEN = "pat_fake_token";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe("manifest", () => {
    it("has correct name and version", () => {
      expect(connector.manifest.name).toBe("airtable");
      expect(connector.manifest.version).toBe("0.1.0");
    });
  });

  describe("validate", () => {
    it("returns valid for correct config", async () => {
      const result = await connector.validate({});
      expect(result.valid).toBe(true);
    });

    it("returns invalid when token env is missing", async () => {
      delete process.env.AIRTABLE_TOKEN;
      const result = await connector.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain("AIRTABLE_TOKEN");
    });

    it("returns invalid for bad config shape", async () => {
      const result = await connector.validate({ token_env: 123 });
      expect(result.valid).toBe(false);
    });

    it("respects custom token_env", async () => {
      delete process.env.AIRTABLE_TOKEN;
      process.env.MY_AT_KEY = "pat_custom";
      const result = await connector.validate({ token_env: "MY_AT_KEY" });
      expect(result.valid).toBe(true);
    });
  });

  describe("index", () => {
    it("yields content items from Airtable records", async () => {
      const responses = new Map<string, unknown>();
      responses.set("meta/bases", { bases: [FAKE_BASE] });
      responses.set(`meta/bases/${FAKE_BASE.id}/tables`, { tables: [FAKE_TABLE] });
      responses.set(`${FAKE_BASE.id}/${FAKE_TABLE.id}`, { records: [FAKE_RECORD] });

      globalThis.fetch = mockFetch(responses);

      const options: IndexOptions = {};
      const items: ContentItem[] = [];

      for await (const item of connector.index({}, options)) {
        items.push(item);
      }

      expect(items).toHaveLength(1);
      const item = items[0];
      expect(item.id).toBe(`airtable:${FAKE_BASE.id}:${FAKE_TABLE.id}:${FAKE_RECORD.id}`);
      expect(item.source).toBe("airtable");
      expect(item.type).toBe("document");
      expect(item.title).toBe("Fix bug");
      expect(item.tags).toContain("Test Base");
      expect(item.tags).toContain("Tasks");
      expect(item.content).toContain("Name: Fix bug");
      expect(item.content).toContain("Status: Done");
    });

    it("filters bases when base_ids is set", async () => {
      const otherBase = { id: "appOTHER", name: "Other", permissionLevel: "create" };
      const responses = new Map<string, unknown>();
      responses.set("meta/bases", { bases: [FAKE_BASE, otherBase] });
      responses.set(`meta/bases/${FAKE_BASE.id}/tables`, { tables: [FAKE_TABLE] });
      responses.set(`${FAKE_BASE.id}/${FAKE_TABLE.id}`, { records: [FAKE_RECORD] });

      globalThis.fetch = mockFetch(responses);

      const items: ContentItem[] = [];
      for await (const item of connector.index({ base_ids: [FAKE_BASE.id] }, {})) {
        items.push(item);
      }

      expect(items).toHaveLength(1);
      expect(items[0].id).toContain(FAKE_BASE.id);
    });

    it("handles pagination via offset", async () => {
      const record2 = { id: "recDEF", fields: { Name: "Task 2", Status: "Open" }, createdTime: "2025-01-16T10:00:00.000Z" };
      let callCount = 0;

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("meta/bases") && !urlStr.includes("tables")) {
          return { ok: true, json: async () => ({ bases: [FAKE_BASE] }), text: async () => "", headers: new Headers() } as Response;
        }
        if (urlStr.includes("tables")) {
          return { ok: true, json: async () => ({ tables: [FAKE_TABLE] }), text: async () => "", headers: new Headers() } as Response;
        }
        if (urlStr.includes(FAKE_TABLE.id)) {
          callCount++;
          if (callCount === 1) {
            return { ok: true, json: async () => ({ records: [FAKE_RECORD], offset: "next_page" }), text: async () => "", headers: new Headers() } as Response;
          }
          return { ok: true, json: async () => ({ records: [record2] }), text: async () => "", headers: new Headers() } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}), text: async () => "", headers: new Headers() } as Response;
      });

      const items: ContentItem[] = [];
      for await (const item of connector.index({}, {})) {
        items.push(item);
      }

      expect(items).toHaveLength(2);
    });

    it("calls onProgress", async () => {
      const responses = new Map<string, unknown>();
      responses.set("meta/bases", { bases: [FAKE_BASE] });
      responses.set(`meta/bases/${FAKE_BASE.id}/tables`, { tables: [FAKE_TABLE] });
      responses.set(`${FAKE_BASE.id}/${FAKE_TABLE.id}`, { records: [FAKE_RECORD] });

      globalThis.fetch = mockFetch(responses);

      const progress = vi.fn();
      const items: ContentItem[] = [];
      for await (const item of connector.index({}, { onProgress: progress })) {
        items.push(item);
      }

      expect(progress).toHaveBeenCalledWith(1);
    });

    it("throws when token env is missing", async () => {
      delete process.env.AIRTABLE_TOKEN;

      const gen = connector.index({}, {});
      await expect(gen.next()).rejects.toThrow("AIRTABLE_TOKEN");
    });
  });
});

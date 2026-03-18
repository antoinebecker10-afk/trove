import { describe, it, expect } from "vitest";
import { extractTitle, extractTags, extractDescription, extractMetadata } from "./properties.js";
import type { NotionPage, NotionProperty } from "./types.js";

function prop(type: string, data: Record<string, unknown>): NotionProperty {
  return { id: "p1", type, ...data } as NotionProperty;
}

function rt(text: string) {
  return { type: "text" as const, plain_text: text, annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false }, href: null };
}

describe("extractTitle", () => {
  it("extracts title from title property", () => {
    const props = { Name: prop("title", { title: [rt("My Page")] }) };
    expect(extractTitle(props)).toBe("My Page");
  });

  it("returns Untitled when no title", () => {
    expect(extractTitle({})).toBe("Untitled");
  });

  it("returns Untitled for empty title", () => {
    const props = { Name: prop("title", { title: [rt("")] }) };
    expect(extractTitle(props)).toBe("Untitled");
  });
});

describe("extractTags", () => {
  it("extracts multi_select tags", () => {
    const props = {
      Tags: prop("multi_select", { multi_select: [{ name: "dev", color: "blue" }, { name: "ai", color: "green" }] }),
    };
    expect(extractTags(props)).toEqual(["dev", "ai"]);
  });

  it("extracts select tag", () => {
    const props = { Category: prop("select", { select: { name: "Notes", color: "gray" } }) };
    expect(extractTags(props)).toEqual(["Notes"]);
  });

  it("extracts status tag", () => {
    const props = { Status: prop("status", { status: { name: "In Progress", color: "yellow" } }) };
    expect(extractTags(props)).toEqual(["In Progress"]);
  });

  it("deduplicates tags", () => {
    const props = {
      A: prop("select", { select: { name: "tag1", color: "red" } }),
      B: prop("multi_select", { multi_select: [{ name: "tag1", color: "red" }] }),
    };
    expect(extractTags(props)).toEqual(["tag1"]);
  });

  it("returns empty for no tags", () => {
    expect(extractTags({})).toEqual([]);
  });
});

describe("extractDescription", () => {
  it("extracts from description property", () => {
    const props = { Description: prop("rich_text", { rich_text: [rt("A page about stuff")] }) };
    expect(extractDescription(props)).toBe("A page about stuff");
  });

  it("returns null when no description property", () => {
    const props = { Notes: prop("rich_text", { rich_text: [rt("not a description")] }) };
    expect(extractDescription(props)).toBeNull();
  });
});

describe("extractMetadata", () => {
  it("builds metadata from page", () => {
    const page: NotionPage = {
      id: "abc-123",
      object: "page",
      url: "https://notion.so/abc",
      archived: false,
      created_time: "2026-01-01T00:00:00Z",
      last_edited_time: "2026-03-01T00:00:00Z",
      created_by: { id: "u1" },
      last_edited_by: { id: "u2" },
      icon: { type: "emoji", emoji: "📝" },
      cover: null,
      parent: { type: "database_id", database_id: "db-1" },
      properties: {},
    };

    const meta = extractMetadata(page, "Tasks");
    expect(meta.notionId).toBe("abc-123");
    expect(meta.parentType).toBe("database_id");
    expect(meta.parentId).toBe("db-1");
    expect(meta.databaseName).toBe("Tasks");
    expect(meta.icon).toBe("📝");
    expect(meta.archived).toBe(false);
  });
});

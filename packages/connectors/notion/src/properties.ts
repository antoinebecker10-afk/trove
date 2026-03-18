/**
 * Extract structured data from Notion page properties.
 */

import type { NotionPage, NotionProperty, RichText } from "./types.js";

/** Extract the page title from properties. */
export function extractTitle(properties: Record<string, NotionProperty>): string {
  for (const prop of Object.values(properties)) {
    if (prop.type === "title" && prop.title) {
      const text = prop.title.map((rt) => rt.plain_text).join("");
      if (text.trim()) return text.trim();
    }
  }
  return "Untitled";
}

/** Extract tags from select, multi_select, and status properties. */
export function extractTags(properties: Record<string, NotionProperty>): string[] {
  const tags: string[] = [];

  for (const prop of Object.values(properties)) {
    if (prop.type === "multi_select" && prop.multi_select) {
      for (const opt of prop.multi_select) {
        if (opt.name) tags.push(opt.name);
      }
    }
    if (prop.type === "select" && prop.select?.name) {
      tags.push(prop.select.name);
    }
    if (prop.type === "status" && prop.status?.name) {
      tags.push(prop.status.name);
    }
  }

  return [...new Set(tags)]; // deduplicate
}

/** Extract a text description from rich_text properties. */
export function extractDescription(properties: Record<string, NotionProperty>): string | null {
  for (const [key, prop] of Object.entries(properties)) {
    if (
      prop.type === "rich_text" &&
      prop.rich_text &&
      prop.rich_text.length > 0 &&
      key.toLowerCase().includes("description")
    ) {
      return prop.rich_text.map((rt) => rt.plain_text).join("").slice(0, 200);
    }
  }
  return null;
}

/** Build metadata object from page + properties. */
export function extractMetadata(
  page: NotionPage,
  databaseName: string | null,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    notionId: page.id,
    parentType: page.parent.type,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    archived: page.archived,
  };

  if (page.icon) {
    meta.icon = page.icon.emoji ?? page.icon.external?.url ?? null;
  }
  if (page.cover) {
    meta.cover = page.cover.external?.url ?? page.cover.file?.url ?? null;
  }
  if (databaseName) {
    meta.databaseName = databaseName;
  }

  if (page.parent.type === "database_id") {
    meta.parentId = page.parent.database_id;
  } else if (page.parent.type === "page_id") {
    meta.parentId = page.parent.page_id;
  }

  // Store all properties as structured data
  const props: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(page.properties)) {
    props[key] = extractPropertyValue(prop);
  }
  meta.properties = props;

  return meta;
}

/** Extract a simple value from a property. */
function extractPropertyValue(prop: NotionProperty): unknown {
  switch (prop.type) {
    case "title":
      return prop.title?.map((rt) => rt.plain_text).join("") ?? "";
    case "rich_text":
      return prop.rich_text?.map((rt) => rt.plain_text).join("") ?? "";
    case "select":
      return prop.select?.name ?? null;
    case "multi_select":
      return prop.multi_select?.map((s) => s.name) ?? [];
    case "status":
      return prop.status?.name ?? null;
    case "date":
      return prop.date ? { start: prop.date.start, end: prop.date.end } : null;
    case "number":
      return prop.number ?? null;
    case "checkbox":
      return prop.checkbox ?? false;
    case "url":
      return prop.url ?? null;
    case "email":
      return prop.email ?? null;
    case "phone_number":
      return prop.phone_number ?? null;
    case "people":
      return prop.people?.map((p) => p.name ?? p.id) ?? [];
    case "relation":
      return prop.relation?.map((r) => r.id) ?? [];
    case "created_time":
      return prop.created_time ?? null;
    case "last_edited_time":
      return prop.last_edited_time ?? null;
    default:
      return null;
  }
}

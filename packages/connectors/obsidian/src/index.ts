import { readdir, stat, readFile, realpath } from "node:fs/promises";
import { join, extname, basename, relative, resolve } from "node:path";
import { z } from "zod";
import type { Connector, ContentItem, ContentType, IndexOptions } from "@trove/shared";
import { parseFrontmatter } from "./frontmatter.js";

const ObsidianConfigSchema = z.object({
  /** Absolute path to the Obsidian vault folder */
  vault_path: z.string().min(1),
  /** Also index images/PDFs in the vault (default: false) */
  include_attachments: z.boolean().default(false),
  /** Max content length to store per item (default: 8000) */
  max_content_length: z.number().min(0).default(8000),
});

const ATTACHMENT_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp",
  ".pdf", ".mp4", ".webm", ".mov",
]);

const IGNORE_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);

/**
 * Extract wiki-links `[[target]]` and `[[target|alias]]` from markdown content.
 * Returns the link targets as strings.
 */
function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].trim();
    if (target) links.push(target);
  }
  return [...new Set(links)];
}

/**
 * Extract inline `#tags` from markdown content.
 * Ignores headings (lines starting with #) and code blocks.
 */
function extractInlineTags(content: string): string[] {
  const tags: string[] = [];
  // Remove code blocks to avoid false positives
  const cleaned = content.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");

  const regex = /(?:^|\s)#([a-zA-Z][\w/-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    tags.push(match[1]);
  }
  return [...new Set(tags)];
}

/**
 * Normalize frontmatter tags into a flat string array.
 * Handles: string, string[], comma-separated string.
 */
function normalizeFrontmatterTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function inferAttachmentType(ext: string): ContentType {
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"].includes(ext)) {
    return "image";
  }
  return "document";
}

const connector: Connector = {
  manifest: {
    name: "obsidian",
    version: "0.1.0",
    description: "Index Obsidian vault markdown notes with frontmatter, wiki-links, and tags",
    configSchema: ObsidianConfigSchema,
  },

  async validate(config) {
    const result = ObsidianConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }

    // Check that vault_path exists
    const parsed = result.data;
    try {
      const vaultStat = await stat(parsed.vault_path);
      if (!vaultStat.isDirectory()) {
        return { valid: false, errors: ["vault_path is not a directory"] };
      }
    } catch {
      return { valid: false, errors: [`vault_path does not exist: ${parsed.vault_path}`] };
    }

    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = ObsidianConfigSchema.parse(config);
    const vaultRoot = resolve(parsed.vault_path);

    let resolvedRoot: string;
    try {
      resolvedRoot = await realpath(vaultRoot);
    } catch {
      return; // Vault path doesn't exist
    }

    let indexed = 0;

    async function* walk(dir: string): AsyncGenerator<ContentItem> {
      if (options.signal?.aborted) return;

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // Permission denied or inaccessible
      }

      for (const entry of entries) {
        if (options.signal?.aborted) return;
        if (entry.name.startsWith(".") && IGNORE_DIRS.has(entry.name)) continue;
        if (IGNORE_DIRS.has(entry.name)) continue;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          yield* walk(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;

        const ext = extname(entry.name).toLowerCase();
        const relPath = relative(resolvedRoot, fullPath).replace(/\\/g, "/");

        // Security: ensure resolved path is under the vault root
        let realFilePath: string;
        try {
          realFilePath = await realpath(fullPath);
        } catch {
          continue;
        }
        if (!realFilePath.startsWith(resolvedRoot)) continue;

        // Handle markdown files
        if (ext === ".md") {
          let fileStat;
          try {
            fileStat = await stat(fullPath);
          } catch {
            continue;
          }

          // Respect `since` filter
          if (options.since && fileStat.mtime < options.since) continue;

          let rawContent: string;
          try {
            rawContent = await readFile(fullPath, "utf-8");
          } catch {
            continue;
          }

          const { data: frontmatter, content: markdownBody } = parseFrontmatter(rawContent);

          // Collect tags from all sources
          const fmTags = normalizeFrontmatterTags(frontmatter.tags);
          const inlineTags = extractInlineTags(markdownBody);
          const wikiLinks = extractWikiLinks(markdownBody);
          const allTags = [...new Set([...fmTags, ...inlineTags, ...wikiLinks])];

          // Title: frontmatter title > filename without .md
          const title =
            typeof frontmatter.title === "string" && frontmatter.title
              ? frontmatter.title
              : basename(entry.name, ".md");

          // Description: first 200 chars of body content
          const description = markdownBody
            .replace(/^#+\s+.*$/gm, "") // remove headings for cleaner desc
            .trim()
            .slice(0, 200)
            .trim() || `Obsidian note: ${title}`;

          // Content capped at max_content_length
          const content = markdownBody.slice(0, parsed.max_content_length);

          // Aliases from frontmatter
          const aliases = normalizeFrontmatterTags(frontmatter.aliases);

          const item: ContentItem = {
            id: `obsidian:${relPath}`,
            source: "obsidian",
            type: "document",
            title,
            description,
            tags: allTags,
            uri: fullPath,
            metadata: {
              ...frontmatter,
              aliases,
              size: fileStat.size,
              modified: fileStat.mtime.toISOString(),
              relativePath: relPath,
            },
            indexedAt: new Date().toISOString(),
            content,
          };

          indexed++;
          options.onProgress?.(indexed);
          yield item;
          continue;
        }

        // Handle attachment files
        if (parsed.include_attachments && ATTACHMENT_EXTS.has(ext)) {
          let fileStat;
          try {
            fileStat = await stat(fullPath);
          } catch {
            continue;
          }

          if (options.since && fileStat.mtime < options.since) continue;

          const type = inferAttachmentType(ext);

          const item: ContentItem = {
            id: `obsidian:${relPath}`,
            source: "obsidian",
            type,
            title: basename(entry.name),
            description: `Obsidian attachment: ${relPath}`,
            tags: [ext.slice(1)],
            uri: fullPath,
            metadata: {
              size: fileStat.size,
              modified: fileStat.mtime.toISOString(),
              extension: ext,
              relativePath: relPath,
            },
            indexedAt: new Date().toISOString(),
          };

          indexed++;
          options.onProgress?.(indexed);
          yield item;
        }
      }
    }

    yield* walk(resolvedRoot);
  },

  async getItem(id: string, config: Record<string, unknown>) {
    const parsed = ObsidianConfigSchema.parse(config);
    const prefix = "obsidian:";
    if (!id.startsWith(prefix)) return null;

    const relPath = id.slice(prefix.length);
    const fullPath = resolve(parsed.vault_path, relPath);

    // Security: ensure path stays within vault
    const vaultRoot = await realpath(resolve(parsed.vault_path));
    let realFilePath: string;
    try {
      realFilePath = await realpath(fullPath);
    } catch {
      return null;
    }
    if (!realFilePath.startsWith(vaultRoot)) return null;

    const ext = extname(fullPath).toLowerCase();
    if (ext !== ".md") return null;

    let fileStat;
    try {
      fileStat = await stat(fullPath);
    } catch {
      return null;
    }

    let rawContent: string;
    try {
      rawContent = await readFile(fullPath, "utf-8");
    } catch {
      return null;
    }

    const { data: frontmatter, content: markdownBody } = parseFrontmatter(rawContent);
    const fmTags = normalizeFrontmatterTags(frontmatter.tags);
    const inlineTags = extractInlineTags(markdownBody);
    const wikiLinks = extractWikiLinks(markdownBody);
    const allTags = [...new Set([...fmTags, ...inlineTags, ...wikiLinks])];

    const title =
      typeof frontmatter.title === "string" && frontmatter.title
        ? frontmatter.title
        : basename(relPath, ".md");

    const description = markdownBody
      .replace(/^#+\s+.*$/gm, "")
      .trim()
      .slice(0, 200)
      .trim() || `Obsidian note: ${title}`;

    const aliases = normalizeFrontmatterTags(frontmatter.aliases);

    return {
      id,
      source: "obsidian",
      type: "document" as const,
      title,
      description,
      tags: allTags,
      uri: fullPath,
      metadata: {
        ...frontmatter,
        aliases,
        size: fileStat.size,
        modified: fileStat.mtime.toISOString(),
        relativePath: relPath,
      },
      indexedAt: new Date().toISOString(),
      content: markdownBody.slice(0, parsed.max_content_length),
    };
  },
};

export default connector;

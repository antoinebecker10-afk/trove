/**
 * Convert Notion blocks to Markdown text.
 * Pure function — no side effects, easily testable.
 */

import type { NotionBlock, RichText } from "./types.js";

/** Convert rich text array to Markdown-formatted string. */
export function richTextToMarkdown(richTexts: RichText[]): string {
  return richTexts
    .map((rt) => {
      let text = rt.plain_text;
      if (!text) return "";

      const a = rt.annotations;
      if (a.code) text = `\`${text}\``;
      if (a.bold) text = `**${text}**`;
      if (a.italic) text = `_${text}_`;
      if (a.strikethrough) text = `~~${text}~~`;

      if (rt.href) text = `[${text}](${rt.href})`;

      return text;
    })
    .join("");
}

/** Convert a block array to Markdown string. */
export function blocksToMarkdown(blocks: NotionBlock[], indent: number = 0): string {
  const lines: string[] = [];
  const prefix = "  ".repeat(indent);

  for (const block of blocks) {
    if (block.archived) continue;

    const md = blockToMarkdown(block, prefix);
    if (md !== null) {
      lines.push(md);
    }

    // Render children (for toggles, list items, etc.)
    const blockData = block[block.type as keyof NotionBlock] as
      | { children?: NotionBlock[] }
      | undefined;
    if (blockData && Array.isArray(blockData.children) && blockData.children.length > 0) {
      lines.push(blocksToMarkdown(blockData.children, indent + 1));
    }
  }

  return lines.join("\n");
}

function blockToMarkdown(block: NotionBlock, prefix: string): string | null {
  switch (block.type) {
    case "paragraph":
      return block.paragraph ? `${prefix}${richTextToMarkdown(block.paragraph.rich_text)}` : "";

    case "heading_1":
      return block.heading_1 ? `${prefix}# ${richTextToMarkdown(block.heading_1.rich_text)}` : null;

    case "heading_2":
      return block.heading_2 ? `${prefix}## ${richTextToMarkdown(block.heading_2.rich_text)}` : null;

    case "heading_3":
      return block.heading_3 ? `${prefix}### ${richTextToMarkdown(block.heading_3.rich_text)}` : null;

    case "bulleted_list_item":
      return block.bulleted_list_item
        ? `${prefix}- ${richTextToMarkdown(block.bulleted_list_item.rich_text)}`
        : null;

    case "numbered_list_item":
      return block.numbered_list_item
        ? `${prefix}1. ${richTextToMarkdown(block.numbered_list_item.rich_text)}`
        : null;

    case "to_do": {
      if (!block.to_do) return null;
      const check = block.to_do.checked ? "x" : " ";
      return `${prefix}- [${check}] ${richTextToMarkdown(block.to_do.rich_text)}`;
    }

    case "toggle":
      return block.toggle
        ? `${prefix}**${richTextToMarkdown(block.toggle.rich_text)}**`
        : null;

    case "code": {
      if (!block.code) return null;
      const lang = block.code.language ?? "";
      const code = richTextToMarkdown(block.code.rich_text);
      return `${prefix}\`\`\`${lang}\n${code}\n${prefix}\`\`\``;
    }

    case "quote":
      return block.quote
        ? `${prefix}> ${richTextToMarkdown(block.quote.rich_text)}`
        : null;

    case "callout": {
      if (!block.callout) return null;
      const icon = block.callout.icon?.emoji ?? "";
      return `${prefix}> ${icon} ${richTextToMarkdown(block.callout.rich_text)}`;
    }

    case "divider":
      return `${prefix}---`;

    case "image": {
      if (!block.image) return null;
      const url = block.image.file?.url ?? block.image.external?.url ?? "";
      const caption = block.image.caption ? richTextToMarkdown(block.image.caption) : "";
      return `${prefix}![${caption}](${url})`;
    }

    case "bookmark": {
      if (!block.bookmark) return null;
      const caption = block.bookmark.caption ? richTextToMarkdown(block.bookmark.caption) : block.bookmark.url;
      return `${prefix}[${caption}](${block.bookmark.url})`;
    }

    case "embed": {
      if (!block.embed) return null;
      return `${prefix}[embed](${block.embed.url})`;
    }

    case "equation":
      return block.equation ? `${prefix}$$${block.equation.expression}$$` : null;

    case "table":
      // Table rows are handled as children — just return empty
      return null;

    case "table_row": {
      if (!block.table_row) return null;
      const cells = block.table_row.cells.map((cell) => richTextToMarkdown(cell));
      return `${prefix}| ${cells.join(" | ")} |`;
    }

    case "child_page":
      return block.child_page ? `${prefix}[Page: ${block.child_page.title}]` : null;

    case "child_database":
      return block.child_database ? `${prefix}[Database: ${block.child_database.title}]` : null;

    default:
      return null;
  }
}

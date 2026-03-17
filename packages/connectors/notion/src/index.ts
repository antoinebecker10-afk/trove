import { Client } from "@notionhq/client";
import type {
  BlockObjectResponse,
  PageObjectResponse,
  RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { z } from "zod";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

const NotionConfigSchema = z.object({
  token_env: z.string().default("NOTION_TOKEN"),
  database_ids: z.array(z.string()).min(1),
});

function richTextToMarkdown(richTexts: RichTextItemResponse[]): string {
  return richTexts
    .map((t) => {
      let text = t.plain_text;
      if (t.annotations.bold) text = `**${text}**`;
      if (t.annotations.italic) text = `*${text}*`;
      if (t.annotations.strikethrough) text = `~~${text}~~`;
      if (t.annotations.code) text = `\`${text}\``;
      if (t.href) text = `[${text}](${t.href})`;
      return text;
    })
    .join("");
}

function getPageTitle(page: PageObjectResponse): string {
  for (const key of Object.keys(page.properties)) {
    const prop = page.properties[key];
    if (prop.type === "title") {
      return prop.title[0]?.plain_text ?? "Untitled";
    }
  }
  return "Untitled";
}

function getPageDescription(page: PageObjectResponse): string | undefined {
  for (const key of Object.keys(page.properties)) {
    const prop = page.properties[key];
    if (key.toLowerCase() === "description" && prop.type === "rich_text" && prop.rich_text.length > 0) {
      return prop.rich_text.map((t) => t.plain_text).join("");
    }
  }
  return undefined;
}

function blockToMarkdown(block: BlockObjectResponse): string {
  switch (block.type) {
    case "paragraph":
      return `${richTextToMarkdown(block.paragraph.rich_text)}\n\n`;
    case "heading_1":
      return `# ${richTextToMarkdown(block.heading_1.rich_text)}\n\n`;
    case "heading_2":
      return `## ${richTextToMarkdown(block.heading_2.rich_text)}\n\n`;
    case "heading_3":
      return `### ${richTextToMarkdown(block.heading_3.rich_text)}\n\n`;
    case "bulleted_list_item":
      return `- ${richTextToMarkdown(block.bulleted_list_item.rich_text)}\n`;
    case "numbered_list_item":
      return `1. ${richTextToMarkdown(block.numbered_list_item.rich_text)}\n`;
    case "to_do":
      return `- [${block.to_do.checked ? "x" : " "}] ${richTextToMarkdown(block.to_do.rich_text)}\n`;
    case "toggle":
      return `${richTextToMarkdown(block.toggle.rich_text)}\n\n`;
    case "code":
      return `\`\`\`${block.code.language}\n${richTextToMarkdown(block.code.rich_text)}\n\`\`\`\n\n`;
    case "quote":
      return `> ${richTextToMarkdown(block.quote.rich_text)}\n\n`;
    case "callout":
      return `> ${richTextToMarkdown(block.callout.rich_text)}\n\n`;
    case "divider":
      return `---\n\n`;
    case "image": {
      const url = block.image.type === "external"
        ? block.image.external.url
        : block.image.file.url;
      const caption = block.image.caption.length > 0
        ? richTextToMarkdown(block.image.caption)
        : "image";
      return `![${caption}](${url})\n\n`;
    }
    case "bookmark":
      return `[${block.bookmark.url}](${block.bookmark.url})\n\n`;
    case "equation":
      return `$$${block.equation.expression}$$\n\n`;
    default:
      return "";
  }
}

async function fetchPageMarkdown(client: Client, pageId: string): Promise<string> {
  let markdown = "";
  let cursor: string | undefined = undefined;

  do {
    const response = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of response.results) {
      if ("type" in block) {
        markdown += blockToMarkdown(block as BlockObjectResponse);
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return markdown.trim();
}

const connector: Connector = {
  manifest: {
    name: "notion",
    version: "0.1.0",
    description: "Index Notion databases and pages with metadata and markdown content",
    configSchema: NotionConfigSchema,
  },

  async validate(config) {
    const result = NotionConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }

    const token = process.env[result.data.token_env];
    if (!token) {
      return {
        valid: false,
        errors: [`Missing environment variable: ${result.data.token_env}`],
      };
    }

    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = NotionConfigSchema.parse(config);
    const token = process.env[parsed.token_env];

    if (!token) {
      throw new Error(`Missing environment variable: ${parsed.token_env}`);
    }

    const notion = new Client({ auth: token });
    let indexed = 0;

    for (const dbId of parsed.database_ids) {
      if (options.signal?.aborted) return;

      let cursor: string | undefined = undefined;

      do {
        if (options.signal?.aborted) return;

        const response = await notion.databases.query({
          database_id: dbId,
          start_cursor: cursor,
          page_size: 100,
        });

        for (const page of response.results) {
          if (options.signal?.aborted) return;
          if (!("properties" in page)) continue;

          const fullPage = page as PageObjectResponse;
          const title = getPageTitle(fullPage);
          let description = getPageDescription(fullPage);
          let content: string | undefined;

          try {
            content = await fetchPageMarkdown(notion, fullPage.id);
            if (!description && content) {
              const firstLine = content.split("\n").find((l) => l.trim().length > 0);
              if (firstLine) {
                description = firstLine.replace(/^[#*\-]\s+/, "").slice(0, 200);
              }
            }
          } catch {
            content = undefined;
          }

          const item: ContentItem = {
            id: `notion:${fullPage.id}`,
            source: "notion",
            type: "document",
            title,
            description: description ?? `Notion page: ${title}`,
            tags: [],
            uri: fullPage.url,
            metadata: {
              createdTime: fullPage.created_time,
              lastEditedTime: fullPage.last_edited_time,
              icon: fullPage.icon,
              cover: fullPage.cover,
              parent: fullPage.parent,
            },
            indexedAt: new Date().toISOString(),
            content,
          };

          indexed++;
          options.onProgress?.(indexed);
          yield item;
        }

        cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
      } while (cursor);
    }
  },
};

export default connector;

import { describe, it, expect } from "vitest";
import { blocksToMarkdown, richTextToMarkdown } from "./blocks-to-markdown.js";
import type { NotionBlock, RichText } from "./types.js";

function rt(text: string, opts?: Partial<RichText["annotations"]>): RichText {
  return {
    type: "text",
    plain_text: text,
    annotations: {
      bold: false, italic: false, strikethrough: false, underline: false, code: false,
      ...opts,
    },
    href: null,
  };
}

function block(type: string, data: Record<string, unknown>): NotionBlock {
  return { id: "b1", type, has_children: false, archived: false, [type]: data } as unknown as NotionBlock;
}

describe("richTextToMarkdown", () => {
  it("renders plain text", () => {
    expect(richTextToMarkdown([rt("hello")])).toBe("hello");
  });

  it("renders bold", () => {
    expect(richTextToMarkdown([rt("bold", { bold: true })])).toBe("**bold**");
  });

  it("renders italic", () => {
    expect(richTextToMarkdown([rt("em", { italic: true })])).toBe("_em_");
  });

  it("renders code", () => {
    expect(richTextToMarkdown([rt("fn()", { code: true })])).toBe("`fn()`");
  });

  it("renders links", () => {
    const linked: RichText = { ...rt("click"), href: "https://example.com" };
    expect(richTextToMarkdown([linked])).toBe("[click](https://example.com)");
  });

  it("renders multiple segments", () => {
    expect(richTextToMarkdown([rt("a "), rt("b", { bold: true }), rt(" c")])).toBe("a **b** c");
  });
});

describe("blocksToMarkdown", () => {
  it("renders paragraph", () => {
    const md = blocksToMarkdown([block("paragraph", { rich_text: [rt("Hello world")] })]);
    expect(md).toBe("Hello world");
  });

  it("renders headings", () => {
    const md = blocksToMarkdown([
      block("heading_1", { rich_text: [rt("H1")] }),
      block("heading_2", { rich_text: [rt("H2")] }),
      block("heading_3", { rich_text: [rt("H3")] }),
    ]);
    expect(md).toContain("# H1");
    expect(md).toContain("## H2");
    expect(md).toContain("### H3");
  });

  it("renders bullet list", () => {
    const md = blocksToMarkdown([block("bulleted_list_item", { rich_text: [rt("item")] })]);
    expect(md).toBe("- item");
  });

  it("renders numbered list", () => {
    const md = blocksToMarkdown([block("numbered_list_item", { rich_text: [rt("step")] })]);
    expect(md).toBe("1. step");
  });

  it("renders to_do checked", () => {
    const md = blocksToMarkdown([block("to_do", { rich_text: [rt("done")], checked: true })]);
    expect(md).toBe("- [x] done");
  });

  it("renders to_do unchecked", () => {
    const md = blocksToMarkdown([block("to_do", { rich_text: [rt("todo")], checked: false })]);
    expect(md).toBe("- [ ] todo");
  });

  it("renders code block", () => {
    const md = blocksToMarkdown([block("code", { rich_text: [rt("const x = 1")], language: "typescript" })]);
    expect(md).toContain("```typescript");
    expect(md).toContain("const x = 1");
    expect(md).toContain("```");
  });

  it("renders quote", () => {
    const md = blocksToMarkdown([block("quote", { rich_text: [rt("wisdom")] })]);
    expect(md).toBe("> wisdom");
  });

  it("renders callout with emoji", () => {
    const md = blocksToMarkdown([block("callout", { rich_text: [rt("note")], icon: { emoji: "💡" } })]);
    expect(md).toBe("> 💡 note");
  });

  it("renders divider", () => {
    const md = blocksToMarkdown([block("divider", {})]);
    expect(md).toBe("---");
  });

  it("renders image", () => {
    const md = blocksToMarkdown([block("image", { external: { url: "https://img.png" }, caption: [rt("photo")] })]);
    expect(md).toBe("![photo](https://img.png)");
  });

  it("renders bookmark", () => {
    const md = blocksToMarkdown([block("bookmark", { url: "https://example.com", caption: [rt("link")] })]);
    expect(md).toBe("[link](https://example.com)");
  });

  it("skips archived blocks", () => {
    const archived = { ...block("paragraph", { rich_text: [rt("hidden")] }), archived: true };
    expect(blocksToMarkdown([archived])).toBe("");
  });

  it("renders child_page", () => {
    const md = blocksToMarkdown([block("child_page", { title: "Subpage" })]);
    expect(md).toBe("[Page: Subpage]");
  });
});

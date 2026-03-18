/**
 * Lightweight YAML frontmatter parser for Obsidian markdown files.
 * Parses the block between opening and closing `---` markers.
 * Zero external dependencies.
 */

export interface FrontmatterResult {
  /** Parsed key-value pairs from the YAML block */
  data: Record<string, unknown>;
  /** Markdown content after the frontmatter block */
  content: string;
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Supports: strings, numbers, booleans, arrays (both `[a, b]` and `- item` syntax), null.
 */
export function parseFrontmatter(raw: string): FrontmatterResult {
  const trimmed = raw.trimStart();

  if (!trimmed.startsWith("---")) {
    return { data: {}, content: raw };
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { data: {}, content: raw };
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const content = trimmed.slice(endIndex + 4).trimStart();
  const data = parseYamlBlock(yamlBlock);

  return { data, content };
}

function parseYamlBlock(block: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = block.split("\n");

  let currentKey: string | null = null;
  let listItems: string[] = [];

  for (const line of lines) {
    // Skip empty lines and comments
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    // List item continuation (  - value)
    const listMatch = line.match(/^\s+-\s+(.+)/);
    if (listMatch && currentKey) {
      listItems.push(parseScalar(listMatch[1].trim()));
      continue;
    }

    // Flush previous list if any
    if (currentKey && listItems.length > 0) {
      result[currentKey] = listItems;
      listItems = [];
      currentKey = null;
    }

    // Key-value pair
    const kvMatch = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2].trim();

      if (rawValue === "" || rawValue === "[]") {
        // Could be followed by list items or empty
        currentKey = key;
        if (rawValue === "[]") {
          result[key] = [];
          currentKey = null;
        }
        continue;
      }

      // Inline array: [a, b, c]
      if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
        const inner = rawValue.slice(1, -1);
        result[key] = inner
          .split(",")
          .map((s) => parseScalar(s.trim()))
          .filter((s) => s !== "");
        currentKey = null;
        continue;
      }

      result[key] = parseScalar(rawValue);
      currentKey = key;
      listItems = [];
    }
  }

  // Flush final list
  if (currentKey && listItems.length > 0) {
    result[currentKey] = listItems;
  }

  return result;
}

function parseScalar(value: string): string {
  // Remove surrounding quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

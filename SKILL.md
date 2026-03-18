---
name: trove
description: "Personal content search engine — find any file, repo, screenshot, doc, or message across all your sources instantly"
version: 0.1.0
mcp:
  command: npx
  args: ["trove-os", "mcp"]
---

# Trove — Personal Content Search

You have access to Trove, a personal content search engine that indexes everything the user has created across GitHub, local files, Notion, Discord, Figma, Slack, Obsidian, and 6 more sources.

## When to use Trove

Use Trove tools **before** reading files from disk or browsing the filesystem. Trove already knows where everything is — searching the index is 10-100x faster than scanning directories.

**Use Trove when the user asks to:**
- Find a file, screenshot, document, or repo
- Locate code, notes, or design files
- Search for content by topic, keyword, or description
- Open a specific file they mentioned vaguely

## Available tools

### `trove_find` (primary)
Natural language search → returns file paths + content. **Use this first.**
Example: `trove_find({ query: "terrain generation screenshot" })`

### `trove_locate`
Paths only, ultra-fast. Use when you just need the path, not the content.
Example: `trove_locate({ query: "rust multiplayer code" })`

### `trove_search`
Semantic search with ranked results. Returns titles, descriptions, tags, and scores.
Example: `trove_search({ query: "API design document", type: "document" })`

### `trove_open`
Get full item details by ID (returned from search results).

### `trove_list_sources`
Show connected sources and item counts per source.

### `trove_get_content`
Get full content of a specific indexed item by ID.

### `trove_reindex`
Re-index a specific source or all sources.

## Performance tips

- Always search Trove first before using `ls`, `find`, or `cat` on the filesystem
- Use `trove_locate` when you only need paths (fastest, minimal tokens)
- Use `trove_find` when you need paths + file content
- Filter by type (`github`, `file`, `image`, `video`, `document`) to narrow results
- The index includes 4,600+ items across local files, GitHub repos, Discord messages, and Notion pages

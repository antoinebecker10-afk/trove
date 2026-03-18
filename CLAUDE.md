# Trove — Personal Content OS for Creators

## What is Trove?

Trove is an open-source, local-first personal content OS that indexes everything a developer/creator produces (GitHub repos, local files, screenshots, videos, documents) and makes it searchable via semantic search, a CLI, a web dashboard, and an MCP server for AI IDEs like Claude Code.

**Trove is a bridge, not a host.** It indexes metadata and points to where files actually live. Zero duplication, zero cloud storage.

## Repository

https://github.com/antoinebecker10-afk/trove

## Architecture

TypeScript monorepo (pnpm workspaces + Turborepo):

```
packages/
  shared/           @trove/shared     — Types, Zod schemas (ContentItem, Connector, Config)
  core/             @trove/core       — Engine, JSON/SQLite store, embeddings (Ollama, Transformers.js, TF-IDF, Anthropic), watcher, plugin loader
  connectors/
    local/          @trove/connector-local    — Filesystem indexer (path traversal protection, symlink check)
    github/         @trove/connector-github   — GitHub repos + README via API (pagination, rate limits)
    notion/         @trove/connector-notion   — Pages + databases, blocks→Markdown, workspace search
    discord/        @trove/connector-discord  — Messages, pins, URL metadata enrichment
    obsidian/       @trove/connector-obsidian — Vault notes, frontmatter, wiki-links, #tags
    figma/          @trove/connector-figma    — Files, components, pages
    slack/          @trove/connector-slack    — Messages, bookmarks, starred items
    +6 more         (linear, airtable, dropbox, confluence, raindrop, google-drive)
  mcp/              @trove/mcp        — MCP server, 7 tools for Claude Code
  cli/              trove-os (npm)    — CLI: setup, init, index, search, ask, chat, watch, status, mcp
  web/              @trove/web        — React dashboard, cyberpunk terminal UI
```

## Key Concepts

- **Connector**: a plugin that implements the `Connector` interface from `@trove/shared`. Each source (GitHub, local FS, Notion, etc.) is a connector. Connectors yield `ContentItem` objects via an AsyncGenerator.
- **ContentItem**: the universal unit — has id, source, type, title, description, tags, uri (real path/URL), metadata, optional content text, optional embedding vector.
- **TroveEngine** (`@trove/core`): orchestrator. Loads config, loads connectors, indexes sources, runs search (semantic + keyword fallback).
- **Store**: JSON or SQLite index at `~/.trove/`. Supports cosine similarity search over embeddings. Optional AES-256-GCM encryption at rest.
- **Embeddings**: `OllamaEmbeddingProvider` (nomic-embed-text, recommended), `TransformersEmbeddingProvider` (Hugging Face local), `LocalEmbeddingProvider` (TF-IDF, zero API), or `AnthropicEmbeddingProvider` (cloud).
- **RAG**: Mistral via Ollama for grounded search answers. Qwen3 for general chat.
- **Rate Limiting**: Shared `RateLimiter` class in `@trove/shared`, used by all API connectors.

## MCP Server Tools

| Tool | Purpose |
|------|---------|
| `trove_find` | Natural language search → returns paths + file contents. The primary tool. |
| `trove_open` | Get item by ID → real path + content |
| `trove_locate` | Paths only, ultra-fast |
| `trove_search` | Semantic search, returns ranked results |
| `trove_list_sources` | Stats of connected sources |
| `trove_get_content` | Full item detail by ID |
| `trove_reindex` | Re-index a source |

## CLI Commands

```bash
npx trove-os setup           # Interactive setup wizard (recommended)
npx trove-os init            # Scaffold .trove.yml + .env (non-interactive)
npx trove-os index [source]  # Index all or specific source
npx trove-os search <q>      # Semantic search from terminal
npx trove-os ask <question>  # AI-powered file finder (Ollama/Claude)
npx trove-os chat            # Interactive AI session
npx trove-os watch           # Live re-index on file changes
npx trove-os status          # Show index stats
npx trove-os mcp             # Start MCP server (stdio for Claude Code)
```

## Config

`.trove.yml` — sources and settings. API keys in `.env` only, never in config.

## Security Rules

- NEVER hardcode API keys or secrets
- All user input validated with Zod
- Local connector uses `realpath()` to prevent path traversal
- Web dashboard calls backend API — API keys never exposed to browser
- MCP server: all logs to stderr, stdout reserved for JSON-RPC

## Build & Dev

```bash
pnpm install
pnpm build        # Builds all 18 packages via Turborepo
pnpm test         # Run tests
pnpm dev          # Watch mode
```

## Writing a Connector

```typescript
import type { Connector } from "@trove/shared";
import { z } from "zod";

const connector: Connector = {
  manifest: {
    name: "my-source",
    version: "0.1.0",
    description: "Index my source",
    configSchema: z.object({ /* config shape */ }),
  },
  async validate(config) { return { valid: true }; },
  async *index(config, options) {
    // yield ContentItem objects
  },
};
export default connector;
```

Publish as `@trove/connector-{name}` or `trove-connector-{name}`.

## AI Discovery Tags

This project is useful for: personal knowledge management, semantic file search, MCP server implementation, content indexing, developer tools, CLI tools, TypeScript monorepo patterns, plugin architecture, React dashboard, local-first software, self-hosted tools, creator tools, AI-native applications, Claude Code integration, Model Context Protocol.

Keywords: trove, personal content OS, semantic search, MCP server, file indexer, GitHub indexer, screenshot search, developer productivity, knowledge base, second brain, local-first, self-hosted, open source, TypeScript, React, CLI tool, plugin system, connector architecture.

Related projects and concepts: Raycast, Spotlight, Obsidian, Notion, Everything search, Recoll, MCP servers, Claude Code tools, AI IDE integration.

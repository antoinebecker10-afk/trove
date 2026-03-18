import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RouteContext } from "../types.js";
import { json, error, readBody } from "../middleware.js";

/** Resolve the monorepo root (where .trove.yml and .env live). */
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");

export async function handleConnectorRoutes(
  url: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<boolean> {
  // GET /api/connectors — list available connectors + status
  if (url.startsWith("/api/connectors") && method === "GET" && !url.includes("/api/connectors/")) {
    const configPath = resolve(PROJECT_ROOT, ".trove.yml");
    let configYaml = "";
    try { configYaml = await readFile(configPath, "utf-8"); } catch { /* no config */ }

    const envPath = resolve(PROJECT_ROOT, ".env");
    let envContent = "";
    try { envContent = await readFile(envPath, "utf-8"); } catch { /* no env */ }

    // Parse which connectors are configured
    const configuredConnectors = new Set<string>();
    const configuredRegex = /connector:\s*([\w-]+)/g;
    let match;
    while ((match = configuredRegex.exec(configYaml)) !== null) {
      configuredConnectors.add(match[1]);
    }

    // Define all available connectors
    const connectors = [
      {
        id: "local",
        name: "Local Files",
        description: "Index files from your computer — documents, code, images, videos",
        icon: "📁",
        status: configuredConnectors.has("local") ? "connected" : "available",
        fields: [
          { key: "paths", label: "Folders to scan", type: "text", placeholder: "~/Desktop, ~/Documents", required: true },
          { key: "extensions", label: "File extensions", type: "text", placeholder: ".md, .ts, .js, .png, .pdf", required: false },
          { key: "max_depth", label: "Max folder depth", type: "number", placeholder: "5", required: false },
        ],
        requiresToken: false,
      },
      {
        id: "github",
        name: "GitHub",
        description: "Index your GitHub repositories, READMEs, and metadata",
        icon: "⬡",
        status: configuredConnectors.has("github") ? "connected" : "available",
        fields: [
          { key: "username", label: "GitHub username", type: "text", placeholder: "your-username", required: true },
          { key: "include_forks", label: "Include forks", type: "toggle", placeholder: "", required: false },
          { key: "include_archived", label: "Include archived", type: "toggle", placeholder: "", required: false },
        ],
        requiresToken: true,
        tokenEnv: "GITHUB_TOKEN",
        tokenSet: envContent.includes("GITHUB_TOKEN="),
        tokenUrl: "https://github.com/settings/tokens",
        tokenHelp: "Create a Personal Access Token with 'repo' scope",
      },
      {
        id: "notion",
        name: "Notion",
        description: "Index Notion pages and databases with full content extraction",
        icon: "📝",
        status: configuredConnectors.has("notion") ? "connected" : "available",
        fields: [
          { key: "database_ids", label: "Database IDs (optional)", type: "text", placeholder: "Leave empty to index entire workspace", required: false },
          { key: "exclude_title_patterns", label: "Exclude patterns", type: "text", placeholder: "Draft:, Template:", required: false },
        ],
        requiresToken: true,
        tokenEnv: "NOTION_TOKEN",
        tokenSet: envContent.includes("NOTION_TOKEN="),
        tokenUrl: "https://www.notion.so/my-integrations",
        tokenHelp: "Create an integration and connect it to your pages/databases",
      },
      {
        id: "obsidian",
        name: "Obsidian",
        description: "Index your Obsidian vault — notes, wiki-links, tags, frontmatter",
        icon: "💎",
        status: configuredConnectors.has("obsidian") ? "connected" : "available",
        fields: [
          { key: "vault_path", label: "Vault path", type: "text", placeholder: "~/Documents/MyVault", required: true },
          { key: "include_attachments", label: "Include attachments (images, PDFs)", type: "toggle", placeholder: "", required: false },
        ],
        requiresToken: false,
      },
      {
        id: "figma",
        name: "Figma",
        description: "Index Figma files, components, pages, and design tokens",
        icon: "🎨",
        status: configuredConnectors.has("figma") ? "connected" : "available",
        fields: [
          { key: "team_ids", label: "Team IDs (optional)", type: "text", placeholder: "Leave empty to index all files", required: false },
          { key: "include_components", label: "Index individual components", type: "toggle", placeholder: "", required: false },
        ],
        requiresToken: true,
        tokenEnv: "FIGMA_TOKEN",
        tokenSet: envContent.includes("FIGMA_TOKEN="),
        tokenUrl: "https://www.figma.com/developers/api#access-tokens",
        tokenHelp: "Create a Personal Access Token in Figma settings",
      },
      {
        id: "slack",
        name: "Slack",
        description: "Index channel messages, bookmarks, and starred items",
        icon: "💬",
        status: configuredConnectors.has("slack") ? "connected" : "available",
        fields: [
          { key: "channels", label: "Channels (optional)", type: "text", placeholder: "general, dev, random — leave empty for all", required: false },
          { key: "include_bookmarks", label: "Include bookmarks", type: "toggle", placeholder: "", required: false },
          { key: "include_stars", label: "Include starred items", type: "toggle", placeholder: "", required: false },
          { key: "since_days", label: "Messages from last N days", type: "number", placeholder: "30", required: false },
        ],
        requiresToken: true,
        tokenEnv: "SLACK_TOKEN",
        tokenSet: envContent.includes("SLACK_TOKEN="),
        tokenUrl: "https://api.slack.com/apps",
        tokenHelp: "Create a Slack app, add Bot Token Scopes (channels:history, channels:read, bookmarks:read, stars:read), install to workspace",
      },
      {
        id: "google-drive",
        name: "Google Drive",
        description: "Index Google Docs, Sheets, Slides, and Drive files",
        icon: "📊",
        status: configuredConnectors.has("google-drive") ? "connected" : "available",
        fields: [
          { key: "folder_ids", label: "Folder IDs (optional)", type: "text", placeholder: "Leave empty to index all files", required: false },
        ],
        requiresToken: true,
        tokenEnv: "GOOGLE_TOKEN",
        tokenSet: envContent.includes("GOOGLE_TOKEN="),
        tokenUrl: "https://console.cloud.google.com/apis/credentials",
        tokenHelp: "Create an OAuth2 token with Drive read-only scope",
      },
      {
        id: "linear",
        name: "Linear",
        description: "Index issues, projects, and documents from Linear",
        icon: "📐",
        status: configuredConnectors.has("linear") ? "connected" : "available",
        fields: [
          { key: "team_ids", label: "Team IDs (optional)", type: "text", placeholder: "Leave empty for all teams", required: false },
          { key: "since_days", label: "Issues from last N days", type: "number", placeholder: "90", required: false },
        ],
        requiresToken: true,
        tokenEnv: "LINEAR_TOKEN",
        tokenSet: envContent.includes("LINEAR_TOKEN="),
        tokenUrl: "https://linear.app/settings/api",
        tokenHelp: "Create a Personal API Key in Linear settings",
      },
      {
        id: "youtube",
        name: "YouTube",
        description: "Index playlists, watch later, and video transcripts",
        icon: "🎬",
        status: "coming_soon",
        fields: [],
        requiresToken: true,
        tokenHelp: "Requires OAuth2 — coming soon",
      },
      {
        id: "reddit",
        name: "Reddit",
        description: "Index saved posts, comments, and upvoted content",
        icon: "🔶",
        status: "coming_soon",
        fields: [],
        requiresToken: true,
        tokenHelp: "Requires OAuth2 — coming soon",
      },
      {
        id: "twitter",
        name: "Twitter / X",
        description: "Index bookmarks, likes, and threads",
        icon: "🐦",
        status: "coming_soon",
        fields: [],
        requiresToken: true,
        tokenHelp: "Requires API key — coming soon",
      },
      {
        id: "browser-bookmarks",
        name: "Browser Bookmarks",
        description: "Index bookmarks from Chrome, Firefox, Edge, Arc",
        icon: "🌐",
        status: "coming_soon",
        fields: [],
        requiresToken: false,
      },
      {
        id: "discord",
        name: "Discord",
        description: "Index messages, pins, and server content",
        icon: "🎮",
        status: configuredConnectors.has("discord") ? "connected" : "available",
        fields: [
          { key: "guild_ids", label: "Server IDs (optional)", type: "text", placeholder: "Leave empty for all servers", required: false },
          { key: "since_days", label: "Messages from last N days", type: "number", placeholder: "30", required: false },
          { key: "include_pins", label: "Include pinned messages", type: "toggle", placeholder: "", required: false },
        ],
        requiresToken: true,
        tokenEnv: "DISCORD_TOKEN",
        tokenSet: envContent.includes("DISCORD_TOKEN="),
        tokenUrl: "https://discord.com/developers/applications",
        tokenHelp: "Create a bot, enable Message Content Intent, add to your server",
      },
      {
        id: "gamma",
        name: "Gamma",
        description: "Index presentations, docs, and webpages created with Gamma AI",
        icon: "🟣",
        status: "coming_soon",
        fields: [],
        requiresToken: true,
        tokenHelp: "Requires API access — coming soon",
      },
      {
        id: "canva",
        name: "Canva",
        description: "Index designs, presentations, and social media posts",
        icon: "🎯",
        status: "coming_soon",
        fields: [],
        requiresToken: true,
        tokenHelp: "Requires Connect API — coming soon",
      },
      {
        id: "google-docs",
        name: "Google Docs",
        description: "Index documents, spreadsheets, and slides from Google Workspace",
        icon: "📄",
        status: "coming_soon",
        fields: [],
        requiresToken: true,
        tokenHelp: "Requires OAuth2 — coming soon",
      },
      {
        id: "airtable",
        name: "Airtable",
        description: "Index bases, tables, records, and attachments",
        icon: "📋",
        status: configuredConnectors.has("airtable") ? "connected" : "available",
        fields: [
          { key: "base_ids", label: "Base IDs (optional)", type: "text", placeholder: "Leave empty for all bases", required: false },
        ],
        requiresToken: true,
        tokenEnv: "AIRTABLE_TOKEN",
        tokenSet: envContent.includes("AIRTABLE_TOKEN="),
        tokenUrl: "https://airtable.com/create/tokens",
        tokenHelp: "Create a Personal Access Token with data.records:read and schema.bases:read scopes",
      },
      {
        id: "dropbox",
        name: "Dropbox",
        description: "Index files, folders, and Paper documents",
        icon: "📦",
        status: configuredConnectors.has("dropbox") ? "connected" : "available",
        fields: [
          { key: "paths", label: "Folder paths (optional)", type: "text", placeholder: "Leave empty to index everything", required: false },
          { key: "extensions", label: "File extensions filter", type: "text", placeholder: ".md, .txt, .pdf, .png", required: false },
        ],
        requiresToken: true,
        tokenEnv: "DROPBOX_TOKEN",
        tokenSet: envContent.includes("DROPBOX_TOKEN="),
        tokenUrl: "https://www.dropbox.com/developers/apps",
        tokenHelp: "Create an app, generate an access token with files.metadata.read and files.content.read scopes",
      },
      {
        id: "confluence",
        name: "Confluence",
        description: "Index spaces, pages, and blog posts from Atlassian",
        icon: "📘",
        status: configuredConnectors.has("confluence") ? "connected" : "available",
        fields: [
          { key: "domain", label: "Atlassian domain", type: "text", placeholder: "mycompany (without .atlassian.net)", required: true },
          { key: "space_keys", label: "Space keys (optional)", type: "text", placeholder: "ENG, DESIGN, DOCS", required: false },
        ],
        requiresToken: true,
        tokenEnv: "CONFLUENCE_TOKEN",
        tokenSet: envContent.includes("CONFLUENCE_TOKEN="),
        tokenUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
        tokenHelp: "Create an API token. Also set CONFLUENCE_EMAIL in .env",
      },
      {
        id: "jira",
        name: "Jira",
        description: "Index issues, epics, and sprints",
        icon: "🔷",
        status: "coming_soon",
        fields: [],
        requiresToken: true,
        tokenHelp: "Requires API token — coming soon",
      },
      {
        id: "raindrop",
        name: "Raindrop.io",
        description: "Index bookmarks, collections, and highlights",
        icon: "💧",
        status: configuredConnectors.has("raindrop") ? "connected" : "available",
        fields: [
          { key: "collection_ids", label: "Collection IDs (optional)", type: "text", placeholder: "Leave empty for all bookmarks", required: false },
        ],
        requiresToken: true,
        tokenEnv: "RAINDROP_TOKEN",
        tokenSet: envContent.includes("RAINDROP_TOKEN="),
        tokenUrl: "https://app.raindrop.io/settings/integrations",
        tokenHelp: "Create a test token in Raindrop.io integrations settings",
      },
      {
        id: "openclaw",
        name: "OpenClaw",
        description: "Index conversations, memories, and skills from your OpenClaw AI assistant",
        icon: "🤖",
        status: configuredConnectors.has("openclaw") ? "connected" : "available",
        fields: [
          { key: "url", label: "Gateway URL", type: "text", placeholder: "http://localhost:18789", required: false },
          { key: "include_conversations", label: "Index conversations", type: "toggle", placeholder: "", required: false },
          { key: "include_memories", label: "Index memories", type: "toggle", placeholder: "", required: false },
          { key: "include_skills", label: "Index skills", type: "toggle", placeholder: "", required: false },
          { key: "since_days", label: "History (days)", type: "number", placeholder: "90", required: false },
        ],
        requiresToken: true,
        tokenEnv: "OPENCLAW_TOKEN",
        tokenSet: envContent.includes("OPENCLAW_TOKEN="),
        tokenUrl: "https://docs.openclaw.ai/gateway/authentication",
        tokenHelp: "Copy the gateway token from your OpenClaw config (~/.openclaw/config.yaml → gateway.token)",
      },
      {
        id: "claude-code",
        name: "Claude Code",
        description: "Index your Claude Code conversations, memories, and session transcripts",
        icon: "🧠",
        status: configuredConnectors.has("claude-code") ? "connected" : "available",
        fields: [
          { key: "data_dir", label: "Data directory", type: "text", placeholder: "~/.claude", required: false },
          { key: "include_history", label: "Index prompt history", type: "toggle", placeholder: "", required: false },
          { key: "include_sessions", label: "Index full sessions", type: "toggle", placeholder: "", required: false },
          { key: "include_memories", label: "Index project memories", type: "toggle", placeholder: "", required: false },
          { key: "since_days", label: "History (days)", type: "number", placeholder: "90", required: false },
        ],
        requiresToken: false,
      },
    ];

    // Add stats for connected connectors
    try {
      const eng = await ctx.engine();
      const stats = await eng.getStats();
      for (const c of connectors) {
        if (c.status === "connected") {
          (c as Record<string, unknown>).itemCount = stats.bySource[c.id] ?? 0;
        }
      }
    } catch { /* ignore */ }

    json(res, { connectors });
    return true;
  }

  // POST /api/connectors/setup — configure a connector
  if (url.startsWith("/api/connectors/setup") && method === "POST") {
    const body = await readBody(req);
    let bodyParsed: Record<string, unknown>;
    try { bodyParsed = JSON.parse(body); } catch { error(res, "Invalid JSON", 400); return true; }
    const { connectorId, config: connConfig, token } = bodyParsed as {
      connectorId: string;
      config: Record<string, string>;
      token?: string;
    };

    if (!connectorId) {
      error(res, "Missing connectorId", 400);
      return true;
    }

    const configPath = resolve(PROJECT_ROOT, ".trove.yml");
    const envPath = resolve(PROJECT_ROOT, ".env");

    // Save token to .env if provided
    if (token) {
      let envContent = "";
      try { envContent = await readFile(envPath, "utf-8"); } catch { /* */ }

      const tokenEnvMap: Record<string, string> = {
        github: "GITHUB_TOKEN",
        notion: "NOTION_TOKEN",
      };
      const envKey = tokenEnvMap[connectorId];
      if (envKey) {
        // Remove existing line if present
        const lines = envContent.split("\n").filter((l) => !l.startsWith(`${envKey}=`));
        lines.push(`${envKey}=${token}`);
        await writeFile(envPath, lines.filter((l) => l.trim()).join("\n") + "\n");
        // Also set in current process
        process.env[envKey] = token;
      }
    }

    // Sanitize YAML values to prevent injection
    const safeYamlValue = (v: string): string =>
      v.replace(/[\n\r]/g, " ").replace(/[:#{}[\]&*?|><!%@`]/g, "");
    const safeYamlKey = (k: string): boolean =>
      /^[a-z_][a-z0-9_]*$/i.test(k);

    // Validate connectorId
    if (!/^[a-z0-9-]+$/.test(connectorId)) {
      error(res, "Invalid connector ID", 400);
      return true;
    }

    // Build connector YAML block
    let connYaml = `\n  - connector: ${connectorId}\n    config:\n`;
    for (const [key, value] of Object.entries(connConfig)) {
      if (!value) continue;
      if (!safeYamlKey(key)) continue; // reject suspicious keys
      // Handle arrays (comma-separated)
      if (key === "paths" || key === "database_ids" || key === "extensions" || key === "exclude_title_patterns") {
        const items = value.split(",").map((s) => safeYamlValue(s.trim())).filter(Boolean);
        connYaml += `      ${key}:\n`;
        for (const item of items) {
          connYaml += `        - ${item}\n`;
        }
      } else if (key === "include_forks" || key === "include_archived") {
        connYaml += `      ${key}: ${value === "true"}\n`;
      } else if (key === "max_depth") {
        connYaml += `      ${key}: ${Number(value) || 5}\n`;
      } else {
        connYaml += `      ${key}: ${safeYamlValue(value)}\n`;
      }
    }

    // Append to .trove.yml
    let configContent = "";
    try { configContent = await readFile(configPath, "utf-8"); } catch { /* */ }

    // Check if connector already exists
    if (configContent.includes(`connector: ${connectorId}`)) {
      error(res, `Connector "${connectorId}" is already configured. Remove it from .trove.yml first.`, 409);
      return true;
    }

    configContent = configContent.trimEnd() + "\n" + connYaml;
    await writeFile(configPath, configContent);

    // Invalidate engine cache so next operation picks up new config
    ctx.invalidateEngine();

    json(res, { ok: true, message: `Connector "${connectorId}" configured successfully` });
    return true;
  }

  // POST /api/connectors/disconnect — remove a connector
  if (url.startsWith("/api/connectors/disconnect") && method === "POST") {
    const body = await readBody(req);
    let parsed2: Record<string, unknown>;
    try { parsed2 = JSON.parse(body); } catch { error(res, "Invalid JSON", 400); return true; }
    const { connectorId } = parsed2 as { connectorId: string };

    if (!connectorId) {
      error(res, "Missing connectorId", 400);
      return true;
    }

    const configPath = resolve(PROJECT_ROOT, ".trove.yml");
    let configContent = "";
    try { configContent = await readFile(configPath, "utf-8"); } catch {
      error(res, "No config file found", 404);
      return true;
    }

    // Remove the connector block from YAML (simple regex approach)
    const regex = new RegExp(
      `\\n?\\s*- connector: ${connectorId}\\n(?:\\s{4}config:\\n(?:\\s{6}[^\\n]*\\n)*)?`,
      "g",
    );
    const newContent = configContent.replace(regex, "");

    if (newContent === configContent) {
      error(res, `Connector "${connectorId}" not found in config`, 404);
      return true;
    }

    await writeFile(configPath, newContent);
    ctx.invalidateEngine();

    json(res, { ok: true });
    return true;
  }

  // POST /api/connectors/index — index a specific connector (SSE stream)
  if (url.startsWith("/api/connectors/index") && method === "POST") {
    const body = await readBody(req);
    let parsed3: Record<string, unknown>;
    try { parsed3 = JSON.parse(body); } catch { error(res, "Invalid JSON", 400); return true; }
    const { connectorId, stream } = parsed3 as { connectorId: string; stream?: boolean };

    if (stream) {
      // SSE: stream progress events
      const origin = req.headers.origin ?? "";
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      });

      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Capture stderr logs during indexing and forward as SSE events
      const origStderr = process.stderr.write.bind(process.stderr);
      const stderrProxy = (chunk: string | Uint8Array, ...args: unknown[]): boolean => {
        const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        const lines = text.split("\n").filter((l) => l.trim());
        for (const line of lines) {
          if (line.startsWith("[trove]")) {
            send("log", { message: line });
          }
        }
        return origStderr(chunk, ...args as [BufferEncoding?, ((error: Error | null | undefined) => void)?]);
      };
      process.stderr.write = stderrProxy as typeof process.stderr.write;

      try {
        const eng = await ctx.engine();
        send("start", { connectorId });
        send("log", { message: `[trove] Indexing ${connectorId}...` });
        const count = await eng.index(connectorId, {
          onProgress: (n) => send("progress", { connectorId, count: n }),
        });
        send("done", { connectorId, count });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Index failed";
        send("error", { connectorId, error: msg });
      } finally {
        process.stderr.write = origStderr;
      }
      res.end();
    } else {
      // Non-streaming fallback
      try {
        const eng = await ctx.engine();
        const count = await eng.index(connectorId);
        json(res, { ok: true, count });
      } catch (err) {
        console.error("[trove-api] index error:", err);
        error(res, "Index failed");
      }
    }
    return true;
  }

  // POST /api/reindex
  if (url.startsWith("/api/reindex") && method === "POST") {
    const eng = await ctx.engine();
    const count = await eng.index();
    json(res, { count });
    return true;
  }

  return false;
}

import { createInterface } from "node:readline/promises";
import { writeFile, access, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir, platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import chalk from "chalk";
import ora from "ora";
import { log } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Source definitions
// ---------------------------------------------------------------------------

interface SourceDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  tokenEnv?: string;
  tokenUrl?: string;
  tokenHelp?: string;
  configPrompts?: Array<{
    key: string;
    label: string;
    default?: string;
    required?: boolean;
  }>;
}

const SOURCES: SourceDef[] = [
  {
    id: "local",
    name: "Local Files",
    icon: "\uD83D\uDCC1",
    description: "Files, code, images, videos on your machine",
    configPrompts: [
      { key: "paths", label: "Folders to scan (comma-separated)", default: "~/Desktop, ~/Documents" },
      { key: "extensions", label: "File types", default: ".md,.ts,.js,.py,.rs,.png,.jpg,.mp4,.pdf" },
      { key: "max_depth", label: "Max folder depth", default: "5" },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    icon: "\u2B21",
    description: "Your repos, READMEs, topics",
    tokenEnv: "GITHUB_TOKEN",
    tokenUrl: "https://github.com/settings/tokens",
    tokenHelp: "Create a Personal Access Token with 'repo' scope",
    configPrompts: [
      { key: "username", label: "GitHub username", required: true },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    icon: "\uD83D\uDCDD",
    description: "Pages, databases, full content",
    tokenEnv: "NOTION_TOKEN",
    tokenUrl: "https://www.notion.so/my-integrations",
    tokenHelp: "Create an integration, connect it to your pages",
  },
  {
    id: "obsidian",
    name: "Obsidian",
    icon: "\uD83D\uDC8E",
    description: "Vault notes, wiki-links, tags, frontmatter",
    configPrompts: [
      { key: "vault_path", label: "Path to your vault", required: true },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    icon: "\uD83C\uDFAE",
    description: "Messages, pins, server content",
    tokenEnv: "DISCORD_TOKEN",
    tokenUrl: "https://discord.com/developers/applications",
    tokenHelp: "Create a bot, enable Message Content Intent, add to server",
    configPrompts: [
      { key: "since_days", label: "Messages from last N days", default: "90" },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    icon: "\uD83D\uDCAC",
    description: "Channel messages, bookmarks, stars",
    tokenEnv: "SLACK_TOKEN",
    tokenUrl: "https://api.slack.com/apps",
    tokenHelp: "Create app, add Bot Token Scopes (channels:history, channels:read)",
    configPrompts: [
      { key: "since_days", label: "Messages from last N days", default: "30" },
    ],
  },
  {
    id: "figma",
    name: "Figma",
    icon: "\uD83C\uDFA8",
    description: "Files, components, design tokens",
    tokenEnv: "FIGMA_TOKEN",
    tokenUrl: "https://www.figma.com/developers/api#access-tokens",
    tokenHelp: "Create a Personal Access Token in Figma settings",
  },
  {
    id: "linear",
    name: "Linear",
    icon: "\uD83D\uDCD0",
    description: "Issues, projects, documents",
    tokenEnv: "LINEAR_TOKEN",
    tokenUrl: "https://linear.app/settings/api",
    tokenHelp: "Create a Personal API Key",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    icon: "\uD83D\uDCCA",
    description: "Docs, Sheets, Slides, Drive files",
    tokenEnv: "GOOGLE_TOKEN",
    tokenUrl: "https://console.cloud.google.com/apis/credentials",
    tokenHelp: "Create OAuth2 token with Drive read-only scope",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    icon: "\uD83D\uDCE6",
    description: "Files, folders, Paper documents",
    tokenEnv: "DROPBOX_TOKEN",
    tokenUrl: "https://www.dropbox.com/developers/apps",
    tokenHelp: "Create app, generate access token",
  },
  {
    id: "airtable",
    name: "Airtable",
    icon: "\uD83D\uDCCB",
    description: "Bases, tables, records",
    tokenEnv: "AIRTABLE_TOKEN",
    tokenUrl: "https://airtable.com/create/tokens",
    tokenHelp: "Create Personal Access Token with data.records:read scope",
  },
  {
    id: "confluence",
    name: "Confluence",
    icon: "\uD83D\uDCD8",
    description: "Spaces, pages, blog posts",
    tokenEnv: "CONFLUENCE_TOKEN",
    tokenUrl: "https://id.atlassian.com/manage-profile/security/api-tokens",
    tokenHelp: "Create API token + set CONFLUENCE_EMAIL in .env",
    configPrompts: [
      { key: "domain", label: "Atlassian domain (without .atlassian.net)", required: true },
    ],
  },
  {
    id: "raindrop",
    name: "Raindrop.io",
    icon: "\uD83D\uDCA7",
    description: "Bookmarks, collections, highlights",
    tokenEnv: "RAINDROP_TOKEN",
    tokenUrl: "https://app.raindrop.io/settings/integrations",
    tokenHelp: "Create a test token in integrations settings",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRl() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

async function ask(rl: ReturnType<typeof createRl>, question: string, defaultVal?: string): Promise<string> {
  const suffix = defaultVal ? chalk.dim(` [${defaultVal}]`) : "";
  const answer = await rl.question(`  ${chalk.cyan("?")} ${question}${suffix} `);
  return answer.trim() || defaultVal || "";
}

async function confirm(rl: ReturnType<typeof createRl>, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await rl.question(`  ${chalk.cyan("?")} ${question} ${chalk.dim(`(${hint})`)} `);
  const a = answer.trim().toLowerCase();
  if (!a) return defaultYes;
  return a === "y" || a === "yes";
}

async function select(rl: ReturnType<typeof createRl>, items: SourceDef[]): Promise<SourceDef[]> {
  console.log();
  for (let i = 0; i < items.length; i++) {
    console.log(`  ${chalk.dim(`${i + 1}.`)} ${items[i].icon}  ${chalk.bold(items[i].name)} ${chalk.dim("—")} ${items[i].description}`);
  }
  console.log();
  const answer = await ask(rl, "Enter numbers to connect (e.g. 1,2,5) or 'all'", "1");
  if (answer.toLowerCase() === "all") return [...items];
  const nums = answer.split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= items.length);
  return [...new Set(nums)].map((n) => items[n - 1]);
}

async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    return res.ok;
  } catch {
    return false;
  }
}

async function getOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) return [];
    const data = (await res.json()) as { models: Array<{ name: string }> };
    return data.models.map((m) => m.name);
  } catch {
    return [];
  }
}

async function pullOllamaModel(model: string): Promise<boolean> {
  const spinner = ora(`Pulling ${model}...`).start();
  try {
    const res = await fetch("http://localhost:11434/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: false }),
    });
    if (res.ok) {
      spinner.succeed(`${model} ready`);
      return true;
    }
    spinner.fail(`Failed to pull ${model}`);
    return false;
  } catch {
    spinner.fail(`Failed to pull ${model} (is Ollama running?)`);
    return false;
  }
}

async function tryGetGhUsername(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", ["api", "user", "--jq", ".login"]);
    return stdout.trim();
  } catch {
    return "";
  }
}

async function tryGetGhToken(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"]);
    return stdout.trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------

export async function setupCommand(): Promise<void> {
  // Check if running in interactive terminal
  if (!process.stdin.isTTY) {
    log.error("Setup wizard requires an interactive terminal.");
    log.dim("  Run this command directly in your terminal, not piped.");
    log.dim("  For non-interactive setup, use: trove init");
    process.exitCode = 1;
    return;
  }

  const rl = createRl();
  const dir = process.cwd();

  try {
    // =====================================================================
    // 1. Welcome
    // =====================================================================
    console.log();
    log.brand("Setup Wizard\n");
    console.log(chalk.dim("  Let's connect your content sources and set up local AI.\n"));

    // =====================================================================
    // 2. System checks
    // =====================================================================
    log.info("Checking system...\n");

    const nodeVer = process.version;
    const nodeMajor = parseInt(nodeVer.slice(1));
    if (nodeMajor < 20) {
      log.error(`Node.js ${nodeVer} detected — Trove requires Node 20+`);
      process.exitCode = 1;
      return;
    }
    log.success(`Node.js ${nodeVer}`);

    const ollamaOk = await checkOllama();
    if (ollamaOk) {
      log.success("Ollama running");
    } else {
      log.warn("Ollama not detected");
      console.log(chalk.dim("    Install from https://ollama.com — needed for local AI search"));
      console.log(chalk.dim("    Trove will still work with keyword search without it.\n"));
    }

    const sep = platform() === "win32" ? "\\" : "/";
    const home = homedir();
    log.success(`Home: ${home}`);
    console.log();

    // =====================================================================
    // 3. Select sources
    // =====================================================================
    log.info("Which sources do you want to connect?\n");
    const selected = await select(rl, SOURCES);

    if (selected.length === 0) {
      log.warn("No sources selected. You can add them later in .trove.yml");
      selected.push(SOURCES[0]); // at least local
    }

    console.log();
    log.info(`Setting up ${selected.length} source(s)...\n`);

    // =====================================================================
    // 4. Configure each source
    // =====================================================================
    const envVars: Record<string, string> = {};
    const sourceConfigs: Array<{ id: string; config: Record<string, string> }> = [];

    for (const source of selected) {
      console.log(`  ${source.icon}  ${chalk.bold(source.name)}`);

      // Collect token
      if (source.tokenEnv) {
        // Try to auto-detect GitHub token
        if (source.id === "github") {
          const ghToken = await tryGetGhToken();
          if (ghToken) {
            log.success(`  GitHub token detected from CLI`);
            envVars[source.tokenEnv] = ghToken;
          } else {
            console.log(chalk.dim(`    Get token: ${source.tokenUrl}`));
            if (source.tokenHelp) console.log(chalk.dim(`    ${source.tokenHelp}`));
            const token = await ask(rl, `${source.tokenEnv}`, "");
            if (token) envVars[source.tokenEnv] = token;
          }
        } else {
          console.log(chalk.dim(`    Get token: ${source.tokenUrl}`));
          if (source.tokenHelp) console.log(chalk.dim(`    ${source.tokenHelp}`));
          const token = await ask(rl, `${source.tokenEnv}`, "");
          if (token) envVars[source.tokenEnv] = token;
          else log.dim(`    Skipped — add it later in .env`);
        }
      }

      // Collect config
      const config: Record<string, string> = {};
      if (source.configPrompts) {
        for (const prompt of source.configPrompts) {
          let def = prompt.default;
          // Smart defaults
          if (source.id === "github" && prompt.key === "username") {
            def = await tryGetGhUsername() || undefined;
          }
          if (source.id === "local" && prompt.key === "paths") {
            def = `~${sep}Desktop, ~${sep}Documents`;
          }
          const val = await ask(rl, prompt.label, def);
          if (val) config[prompt.key] = val;
          else if (prompt.required) {
            log.warn(`    ${prompt.label} is required — skipping ${source.name}`);
          }
        }
      }

      sourceConfigs.push({ id: source.id, config });
      console.log();
    }

    // =====================================================================
    // 5. Ollama models
    // =====================================================================
    let embeddings: "ollama" | "local" = "local";

    if (ollamaOk) {
      console.log();
      log.info("Setting up local AI models...\n");

      const models = await getOllamaModels();
      const requiredModels = [
        { name: "nomic-embed-text", purpose: "Embeddings (semantic search)" },
        { name: "mistral:latest", purpose: "RAG (search answers)" },
      ];

      for (const { name, purpose } of requiredModels) {
        const installed = models.some((m) => m.startsWith(name.replace(":latest", "")));
        if (installed) {
          log.success(`${name} — ${purpose}`);
        } else {
          const pull = await confirm(rl, `Pull ${name}? (${purpose})`);
          if (pull) {
            await pullOllamaModel(name);
          } else {
            log.dim(`    Skipped ${name}`);
          }
        }
      }

      embeddings = "ollama";
    }

    // =====================================================================
    // 6. Generate files
    // =====================================================================
    console.log();
    log.info("Writing config files...\n");

    // .trove.yml
    let yaml = `# Trove configuration — generated by setup wizard
storage: json
data_dir: ~/.trove
embeddings: ${embeddings}
`;

    if (ollamaOk) {
      yaml += `\n# Ollama models\nollama_model: nomic-embed-text\nollama_ai_model: mistral:latest\n`;
    }

    yaml += `\nsources:\n`;

    for (const { id, config } of sourceConfigs) {
      yaml += `  - connector: ${id}\n`;
      yaml += `    config:\n`;

      if (Object.keys(config).length === 0) {
        yaml += `      {}\n`;
      } else {
        for (const [key, value] of Object.entries(config)) {
          if (key === "paths" || key === "extensions") {
            const items = value.split(",").map((s) => s.trim()).filter(Boolean);
            yaml += `      ${key}:\n`;
            for (const item of items) {
              yaml += `        - ${item}\n`;
            }
          } else if (key === "max_depth" || key === "since_days") {
            yaml += `      ${key}: ${Number(value) || 5}\n`;
          } else if (value === "true" || value === "false") {
            yaml += `      ${key}: ${value}\n`;
          } else {
            yaml += `      ${key}: ${value}\n`;
          }
        }
      }
      yaml += `\n`;
    }

    const configPath = resolve(dir, ".trove.yml");
    try {
      await access(configPath);
      const overwrite = await confirm(rl, ".trove.yml already exists. Overwrite?", false);
      if (!overwrite) {
        log.dim("  Keeping existing .trove.yml");
      } else {
        await writeFile(configPath, yaml, "utf-8");
        log.success("Created .trove.yml");
      }
    } catch {
      await writeFile(configPath, yaml, "utf-8");
      log.success("Created .trove.yml");
    }

    // .env
    const envPath = resolve(dir, ".env");
    let envContent = "# Trove — Environment Variables (gitignored, never committed)\n\n";

    if (ollamaOk) {
      envContent += "# Local AI models\n";
      envContent += "OLLAMA_RAG_MODEL=mistral:latest\n";
      envContent += "OLLAMA_EMBED_MODEL=nomic-embed-text\n";
      envContent += "OLLAMA_MODEL=qwen3:8b\n\n";
    }

    envContent += "# API keys — add only the ones you use\n";
    envContent += "ANTHROPIC_API_KEY=\n";

    for (const [key, value] of Object.entries(envVars)) {
      envContent += `${key}=${value}\n`;
    }

    // Add empty lines for tokens not collected
    for (const source of selected) {
      if (source.tokenEnv && !envVars[source.tokenEnv]) {
        envContent += `${source.tokenEnv}=\n`;
      }
    }

    try {
      await access(envPath);
      const overwrite = await confirm(rl, ".env already exists. Overwrite?", false);
      if (!overwrite) {
        // Merge: add missing env vars to existing
        const existing = await readFile(envPath, "utf-8");
        let merged = existing;
        for (const [key, value] of Object.entries(envVars)) {
          if (!existing.includes(`${key}=`)) {
            merged += `\n${key}=${value}`;
          } else if (value) {
            // Update existing empty value
            merged = merged.replace(new RegExp(`^${key}=\\s*$`, "m"), `${key}=${value}`);
          }
        }
        await writeFile(envPath, merged, "utf-8");
        log.success("Updated .env (merged new tokens)");
      } else {
        await writeFile(envPath, envContent, "utf-8");
        log.success("Created .env");
      }
    } catch {
      await writeFile(envPath, envContent, "utf-8");
      log.success("Created .env");
    }

    // =====================================================================
    // 7. First index
    // =====================================================================
    console.log();
    const runIndex = await confirm(rl, "Run first index now?");

    if (runIndex) {
      console.log();
      log.info("Indexing content...\n");
      try {
        const { indexCommand } = await import("./index-cmd.js");
        await indexCommand(undefined, {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Indexing failed: ${msg}`);
        log.dim("  You can retry with: trove index");
      }
    }

    // =====================================================================
    // 8. Done
    // =====================================================================
    console.log();
    log.brand("Setup complete!\n");
    console.log(chalk.dim("  Quick commands:"));
    console.log(`    ${chalk.hex("#f97316")("trove search")} ${chalk.dim('"your query"')}     Search your content`);
    console.log(`    ${chalk.hex("#f97316")("trove index")}                   Re-index sources`);
    console.log(`    ${chalk.hex("#f97316")("trove status")}                  View index stats`);
    console.log(`    ${chalk.hex("#f97316")("trove ask")} ${chalk.dim('"find my X"')}        AI-powered search`);
    console.log(`    ${chalk.hex("#f97316")("trove watch")}                   Live re-index on changes`);
    console.log();
    console.log(chalk.dim("  Dashboard: cd trove && npx tsx packages/web/server.ts"));
    console.log(chalk.dim("  MCP:       claude mcp add trove -- npx trove-os mcp"));
    console.log();
  } finally {
    rl.close();
  }
}

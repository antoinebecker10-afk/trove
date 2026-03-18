import chalk from "chalk";
import { TroveEngine } from "@trove/core";
import { log } from "../utils/logger.js";
import { createInterface } from "node:readline";

const SYSTEM_PROMPT = `You are Trove, a personal content assistant. The user has files, repos, screenshots, and videos indexed locally. You help them find exactly what they need.

You will receive search results from the user's index. Your job:
1. Analyze what the user is looking for
2. Pick the best match(es) from the results
3. Give the exact file path or URI
4. Be brief and direct — path first, explanation second

Always start your answer with the file path or URI. If nothing matches, say so clearly and suggest different search terms.`;

// ---------------------------------------------------------------------------
// LLM provider abstraction — Ollama (local) or Anthropic (cloud)
// ---------------------------------------------------------------------------

interface LLMOptions {
  model: string;
  system: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
}

async function callLLM(opts: LLMOptions): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (anthropicKey) {
    return callAnthropic(anthropicKey, opts);
  }

  // Default: Ollama local
  return callOllama(opts);
}

async function callAnthropic(
  apiKey: string,
  opts: LLMOptions,
): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2024-10-22",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 500,
      system: opts.system,
      messages: opts.messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

async function callOllama(opts: LLMOptions): Promise<string> {
  const ollamaUrl =
    process.env.OLLAMA_URL ?? "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_RAG_MODEL ?? process.env.OLLAMA_MODEL ?? "mistral:latest";

  const messages = [
    { role: "system", content: opts.system },
    ...opts.messages,
  ];

  let response: Response;
  try {
    response = await fetch(`${ollamaUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        messages,
        max_tokens: opts.maxTokens ?? 500,
      }),
    });
  } catch {
    throw new Error(
      `Cannot reach Ollama at ${ollamaUrl}. Is it running?\n` +
        "  Install: https://ollama.com\n" +
        `  Then: ollama pull ${ollamaModel}`,
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * `trove ask <question>` — AI-powered file finder.
 * Searches the index, sends results to Claude, gets a smart answer.
 */
export async function askCommand(
  question: string,
  options?: { model?: string },
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.error("ANTHROPIC_API_KEY required for AI-powered search.");
    log.dim("Set it in .env or run: export ANTHROPIC_API_KEY=sk-...");
    log.dim('For search without AI, use: trove search "query"');
    process.exitCode = 1;
    return;
  }

  try {
    const engine = await TroveEngine.create();
    const model = options?.model ?? "claude-sonnet-4-20250514";

    // Search the index with the user's question
    const semanticResults = await engine.search(question, { limit: 10 });
    const keywordResults = await engine.keywordSearch(question, { limit: 10 });

    // Merge and deduplicate
    const seen = new Set<string>();
    const allResults: Array<{
      title: string;
      type: string;
      uri: string;
      description: string;
      tags: string[];
      metadata: Record<string, unknown>;
      score?: number;
    }> = [];

    for (const { item, score } of semanticResults) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        allResults.push({
          title: item.title,
          type: item.type,
          uri: item.uri,
          description: item.description,
          tags: item.tags,
          metadata: item.metadata,
          score,
        });
      }
    }
    for (const item of keywordResults) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        allResults.push({
          title: item.title,
          type: item.type,
          uri: item.uri,
          description: item.description,
          tags: item.tags,
          metadata: item.metadata,
        });
      }
    }

    if (allResults.length === 0) {
      log.warn("No indexed content matches your question.");
      log.dim("Try reindexing: trove index");
      return;
    }

    // Build context for the AI
    const context = allResults
      .map(
        (r, i) =>
          `[${i + 1}] ${r.title} (${r.type}) — ${r.uri}\n    ${r.description}\n    tags: ${r.tags.join(", ")}${r.score != null ? `\n    relevance: ${Math.round(r.score * 100)}%` : ""}`,
      )
      .join("\n\n");

    const userMessage = `The user is looking for: "${question}"

Here are ${allResults.length} items from their personal index:

${context}

Which item(s) best match what they need? Give the path/URI first.`;

    // Call Claude API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2024-10-22",
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Claude API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const answer = data.content.find((b) => b.type === "text")?.text;

    if (!answer) {
      log.warn("No answer from AI. Try a different question.");
      return;
    }

    console.log();
    console.log(chalk.hex("#f97316")("🦞 Trove AI"));
    console.log();
    console.log(answer);
    console.log();
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

/**
 * `trove chat` — Interactive AI session with your index.
 * Multi-turn conversation to find files.
 */
export async function chatCommand(options?: { model?: string }): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.error("ANTHROPIC_API_KEY required for AI chat.");
    log.dim("Set it in .env or run: export ANTHROPIC_API_KEY=sk-...");
    process.exitCode = 1;
    return;
  }

  log.brand("Interactive mode — describe what you need, I'll find it.\n");
  log.dim('Type "exit" to quit.\n');

  const engine = await TroveEngine.create();
  const model = options?.model ?? "claude-sonnet-4-20250514";
  const messages: Array<{ role: string; content: string }> = [];

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.hex("#f97316")("🦞 > "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input === "exit" || input === "quit" || input === "q") {
      rl.close();
      return;
    }

    // Search index
    const semanticResults = await engine.search(input, { limit: 8 });
    const keywordResults = await engine.keywordSearch(input, { limit: 8 });

    const seen = new Set<string>();
    const items: string[] = [];
    for (const { item, score } of semanticResults) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(
          `${item.title} (${item.type}) — ${item.uri} [${Math.round(score * 100)}%]\n  ${item.description}`,
        );
      }
    }
    for (const item of keywordResults) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(
          `${item.title} (${item.type}) — ${item.uri}\n  ${item.description}`,
        );
      }
    }

    const context =
      items.length > 0
        ? `\n\nIndex results for "${input}":\n${items.join("\n\n")}`
        : `\n\nNo items in the index matched "${input}".`;

    messages.push({ role: "user", content: input + context });

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2024-10-22",
        },
        body: JSON.stringify({
          model,
          max_tokens: 500,
          system: SYSTEM_PROMPT,
          messages,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      const answer = data.content.find((b) => b.type === "text")?.text ?? "...";

      messages.push({ role: "assistant", content: answer });

      console.log();
      console.log(chalk.dim(answer));
      console.log();
    } catch (err) {
      console.log(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log(chalk.dim("\nbye."));
  });
}

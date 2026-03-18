/**
 * Embedding providers for semantic search.
 * The local provider works without any API key (keyword-based).
 * The Anthropic provider uses the Claude API for real embeddings.
 */

export interface EmbeddingProvider {
  /** Compute embeddings for a batch of texts */
  embed(texts: string[]): Promise<number[][]>;
  /** Dimensionality of produced vectors */
  dimensions: number;
}

/**
 * Local keyword-based "embedding" using TF-IDF-like approach.
 * No API key needed. Good enough for basic search.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 512;

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  private hashToken(token: string): number {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash * 31 + token.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % this.dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vec = new Float64Array(this.dimensions);
      const tokens = this.tokenize(text);
      for (const token of tokens) {
        const idx = this.hashToken(token);
        vec[idx] += 1;
      }
      // L2 normalize
      let norm = 0;
      for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let i = 0; i < vec.length; i++) vec[i] /= norm;
      }
      return Array.from(vec);
    });
  }
}

/**
 * Anthropic API-based embedding provider.
 * Requires ANTHROPIC_API_KEY in environment.
 */
export class AnthropicEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024;
  private apiKey: string;

  constructor() {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for Anthropic embeddings. " +
          'Set embeddings: "local" in .trove.yml to use without an API key.',
      );
    }
    this.apiKey = key;
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Use Voyager embeddings via Anthropic API
    // For now, fall back to local if the embedding endpoint isn't available
    const response = await fetch("https://api.anthropic.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2024-10-22",
      },
      body: JSON.stringify({
        model: "voyage-3",
        input: texts,
      }),
    });

    if (!response.ok) {
      // Don't leak response body — may contain sensitive info
      await response.text().catch(() => { /* drain body */ });
      throw new Error(`Anthropic embeddings API error (${response.status})`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map((d) => d.embedding);
  }
}

/**
 * Ollama-based embedding provider.
 * Uses a local Ollama instance — zero cloud, zero API key.
 * Default model: nomic-embed-text (768 dimensions).
 */
export interface OllamaOptions {
  url?: string;
  model?: string;
  dimensions?: number;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  private url: string;
  private model: string;

  constructor(options?: OllamaOptions) {
    this.url = options?.url ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
    this.model = options?.model ?? process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
    this.dimensions = options?.dimensions ?? Number(process.env.OLLAMA_EMBED_DIMENSIONS ?? "768");
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const response = await fetch(`${this.url}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, input: text }),
      });

      if (!response.ok) {
        await response.text().catch(() => { /* drain body */ });
        throw new Error(
          `Ollama embeddings error (${response.status}). Is Ollama running? Try: ollama pull ${this.model}`,
        );
      }

      const data = (await response.json()) as {
        embeddings: number[][];
      };
      results.push(data.embeddings[0]);
    }
    return results;
  }
}

/**
 * Transformers.js embedding provider — real semantic embeddings, 100% local.
 * Uses all-MiniLM-L6-v2 via ONNX runtime (384 dimensions).
 * No API key, no cloud, no Ollama required.
 */
export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 384;
  private pipeline: unknown = null;
  private loading: Promise<unknown> | null = null;

  private async getPipeline(): Promise<unknown> {
    if (this.pipeline) return this.pipeline;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      // Dynamic import to avoid loading ONNX runtime at module level
      const { pipeline } = await import("@huggingface/transformers");
      this.pipeline = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        {
          // Use local cache, download only once
          dtype: "fp32",
        },
      );
      return this.pipeline;
    })();

    return this.loading;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const pipe = (await this.getPipeline()) as (
      input: string[],
      options: { pooling: string; normalize: boolean },
    ) => Promise<{ tolist(): number[][] }>;

    const output = await pipe(texts, {
      pooling: "mean",
      normalize: true,
    });

    return output.tolist();
  }
}

/**
 * Create the appropriate embedding provider based on config.
 * If Ollama is selected but unreachable, wraps it with silent fallback to local TF-IDF.
 */
export function createEmbeddingProvider(
  provider: "anthropic" | "ollama" | "transformers" | "local",
  ollamaOptions?: OllamaOptions,
): EmbeddingProvider {
  if (provider === "anthropic") {
    return new AnthropicEmbeddingProvider();
  }
  if (provider === "transformers") {
    const transformers = new TransformersEmbeddingProvider();
    const fallback = new LocalEmbeddingProvider();
    // Wrap with fallback if transformers.js fails to load
    return {
      dimensions: transformers.dimensions,
      async embed(texts: string[]): Promise<number[][]> {
        try {
          return await transformers.embed(texts);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[trove] Transformers.js error, falling back to local TF-IDF: ${msg}`);
          return fallback.embed(texts);
        }
      },
    };
  }
  if (provider === "ollama") {
    const ollama = new OllamaEmbeddingProvider(ollamaOptions);
    const fallback = new LocalEmbeddingProvider();
    // Wrap with silent fallback on connection errors
    return {
      dimensions: ollama.dimensions,
      async embed(texts: string[]): Promise<number[][]> {
        try {
          return await ollama.embed(texts);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("fetch") || msg.includes("ECONNREFUSED") || msg.includes("network")) {
            console.error(`[trove] Ollama unreachable, falling back to local TF-IDF: ${msg}`);
            return fallback.embed(texts);
          }
          throw err;
        }
      },
    };
  }
  return new LocalEmbeddingProvider();
}

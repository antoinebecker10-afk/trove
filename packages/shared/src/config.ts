import { z } from "zod";

export const SourceConfigSchema = z.object({
  /** Connector package name or path */
  connector: z.string(),
  /** Connector-specific configuration */
  config: z.record(z.unknown()).nullable().transform((v) => v ?? {}).default({}),
});

export type SourceConfig = z.infer<typeof SourceConfigSchema>;

export const TroveConfigSchema = z.object({
  /** Storage backend */
  storage: z.enum(["json", "sqlite"]).default("json"),
  /** Directory for index data */
  data_dir: z.string().default("~/.trove"),
  /** Embedding provider */
  embeddings: z.enum(["anthropic", "ollama", "transformers", "local"]).default("local"),
  /** Ollama embedding model (default: nomic-embed-text) */
  ollama_model: z.string().optional(),
  /** Ollama AI/chat model for dashboard answers (default: qwen3:8b) */
  ollama_ai_model: z.string().optional(),
  /** Ollama base URL (default: http://localhost:11434) */
  ollama_url: z.string().url().optional(),
  /** Content sources */
  sources: z.array(SourceConfigSchema).default([]),
});

export type TroveConfig = z.infer<typeof TroveConfigSchema>;

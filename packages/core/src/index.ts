export { TroveEngine, type EngineOptions } from "./engine.js";
export { loadConfig, resolveDataDir, expandHome } from "./config.js";
export { createStore, JsonStore, type Store } from "./store.js";
export { SqliteStore } from "./sqlite-store.js";
export {
  createEmbeddingProvider,
  LocalEmbeddingProvider,
  AnthropicEmbeddingProvider,
  OllamaEmbeddingProvider,
  TransformersEmbeddingProvider,
  type EmbeddingProvider,
} from "./embeddings.js";
export { loadConnector, registerBuiltinConnector } from "./plugin-loader.js";
export { redactSecrets, containsSecrets } from "./redact.js";
export { encrypt, decrypt, isEncrypted, getEncryptionKey } from "./crypto.js";
export { TroveWatcher, type WatcherOptions } from "./watcher.js";

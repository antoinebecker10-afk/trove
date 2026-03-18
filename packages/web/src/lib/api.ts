/** API client — talks to the Trove backend. No secrets exposed to browser. */

export interface ApiContentItem {
  id: string;
  source: string;
  type: string;
  title: string;
  description: string;
  tags: string[];
  uri: string;
  metadata: Record<string, unknown>;
  indexedAt: string;
  score?: number;
}

export interface ApiStats {
  totalItems: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  lastIndexedAt: string | null;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string;
  ext: string;
  type: string;
}

export interface ConnectorField {
  key: string;
  label: string;
  type: "text" | "number" | "toggle";
  placeholder: string;
  required: boolean;
}

export interface ConnectorInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  status: "connected" | "available" | "coming_soon";
  fields: ConnectorField[];
  requiresToken: boolean;
  tokenEnv?: string;
  tokenSet?: boolean;
  tokenUrl?: string;
  tokenHelp?: string;
  itemCount?: number;
}

export interface SystemInfo {
  platform: string;
  cpus: number;
  cpuModel: string;
  totalMem: number;
  freeMem: number;
  usedMem: number;
  disk: { total: number; free: number; used: number };
  homedir: string;
  nodeVersion: string;
}

/** Auth token — set via TROVE_API_TOKEN env var or the server prints it on start. */
let authToken = "";

export function setApiToken(token: string): void {
  authToken = token;
}

export function getApiToken(): string {
  return authToken;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers((init?.headers as HeadersInit) ?? {});
  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "Unknown error");
    throw new Error(`API error (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  stats: () => fetchJson<ApiStats>("/api/stats"),

  search: (query: string, type?: string, source?: string) => {
    const params = new URLSearchParams({ q: query });
    if (type) params.set("type", type);
    if (source) params.set("source", source);
    return fetchJson<{ results: ApiContentItem[]; aiAnswer?: string }>(
      `/api/search?${params}`,
    );
  },

  reindex: () =>
    fetchJson<{ count: number }>("/api/reindex", { method: "POST" }),

  items: (options?: { type?: string; page?: number; limit?: number; sort?: string }) => {
    const params = new URLSearchParams();
    if (options?.type) params.set("type", options.type);
    if (options?.page) params.set("page", String(options.page));
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.sort) params.set("sort", options.sort);
    return fetchJson<{ items: ApiContentItem[]; total: number; page: number; pages: number }>(
      `/api/items?${params}`,
    );
  },

  // --- File manager ---

  files: (path?: string) => {
    const params = path ? `?path=${encodeURIComponent(path)}` : "";
    return fetchJson<{ current: string; parent: string | null; items: FileEntry[] }>(
      `/api/files${params}`,
    );
  },

  openFile: (path: string) =>
    fetchJson<{ ok: boolean }>("/api/file/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),

  fileServeUrl: (path: string) =>
    `/api/file/serve?path=${encodeURIComponent(path)}`,

  /** Fetch file content as blob with auth header (preferred over URL token) */
  fileServeBlob: async (path: string): Promise<Blob> => {
    const headers: HeadersInit = {};
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    const res = await fetch(`/api/file/serve?path=${encodeURIComponent(path)}`, { headers });
    if (!res.ok) throw new Error(`File serve error (${res.status})`);
    return res.blob();
  },

  moveFile: (from: string, to: string) =>
    fetchJson<{ ok: boolean; newPath: string }>("/api/file/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    }),

  copyFile: (from: string, to: string) =>
    fetchJson<{ ok: boolean; newPath: string }>("/api/file/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    }),

  renameFile: (path: string, newName: string) =>
    fetchJson<{ ok: boolean; newPath: string }>("/api/file/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, newName }),
    }),

  deleteFile: (path: string) =>
    fetchJson<{ ok: boolean }>(`/api/file/delete?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),

  mkDir: (path: string) =>
    fetchJson<{ ok: boolean; path: string }>("/api/file/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),

  browse: (path?: string) => {
    const params = path ? `?path=${encodeURIComponent(path)}` : "";
    return fetchJson<{ current: string; dirs: Array<{ name: string; path: string }> }>(
      `/api/browse${params}`,
    );
  },

  system: () => fetchJson<SystemInfo>("/api/system"),

  // --- Connectors ---

  connectors: () =>
    fetchJson<{ connectors: ConnectorInfo[] }>("/api/connectors"),

  setupConnector: (connectorId: string, config: Record<string, string>, token?: string) =>
    fetchJson<{ ok: boolean; message: string }>("/api/connectors/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectorId, config, token }),
    }),

  disconnectConnector: (connectorId: string) =>
    fetchJson<{ ok: boolean }>("/api/connectors/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectorId }),
    }),

  indexConnector: (connectorId: string) =>
    fetchJson<{ ok: boolean; count: number }>("/api/connectors/index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectorId }),
    }),
};

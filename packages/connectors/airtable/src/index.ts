import { z } from "zod";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

const AirtableConfigSchema = z.object({
  /** Env var name for the Airtable PAT (default: AIRTABLE_TOKEN) */
  token_env: z.string().default("AIRTABLE_TOKEN"),
  /** Optional list of base IDs to index. If omitted, all accessible bases are indexed. */
  base_ids: z.array(z.string()).optional(),
});

const API_BASE = "https://api.airtable.com/v0";

/** Minimum delay between requests to respect 5 req/s rate limit. */
const RATE_LIMIT_MS = 210;

interface AirtableBase {
  id: string;
  name: string;
  permissionLevel: string;
}

interface AirtableBasesResponse {
  bases: AirtableBase[];
  offset?: string;
}

interface AirtableTable {
  id: string;
  name: string;
  primaryFieldId: string;
  fields: { id: string; name: string; type: string }[];
}

interface AirtableTablesResponse {
  tables: AirtableTable[];
}

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime: string;
}

interface AirtableRecordsResponse {
  records: AirtableRecord[];
  offset?: string;
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": "Trove/0.1.0",
  };
}

async function rateLimitedFetch(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
  const response = await fetch(url, { headers, signal });
  if (!response.ok) {
    await response.text().catch(() => { /* drain body */ });
    throw new Error(`Airtable API error (${response.status})`);
  }
  return response;
}

async function fetchBases(
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<AirtableBase[]> {
  const bases: AirtableBase[] = [];
  let offset: string | undefined;

  do {
    const url = offset
      ? `${API_BASE}/meta/bases?offset=${encodeURIComponent(offset)}`
      : `${API_BASE}/meta/bases`;
    const response = await rateLimitedFetch(url, headers, signal);
    const data = (await response.json()) as AirtableBasesResponse;
    bases.push(...data.bases);
    offset = data.offset;
  } while (offset && !signal?.aborted);

  return bases;
}

async function fetchTables(
  baseId: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<AirtableTable[]> {
  const response = await rateLimitedFetch(
    `${API_BASE}/meta/bases/${encodeURIComponent(baseId)}/tables`,
    headers,
    signal,
  );
  const data = (await response.json()) as AirtableTablesResponse;
  return data.tables;
}

async function fetchRecords(
  baseId: string,
  tableId: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = offset
      ? `${API_BASE}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?pageSize=100&offset=${encodeURIComponent(offset)}`
      : `${API_BASE}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}?pageSize=100`;
    const response = await rateLimitedFetch(url, headers, signal);
    const data = (await response.json()) as AirtableRecordsResponse;
    records.push(...data.records);
    offset = data.offset;
  } while (offset && !signal?.aborted);

  return records;
}

function recordToContent(
  fields: Record<string, unknown>,
): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${String(value ?? "")}`)
    .join("\n");
}

function getPrimaryFieldValue(
  record: AirtableRecord,
  table: AirtableTable,
): string {
  const primaryField = table.fields.find((f) => f.id === table.primaryFieldId);
  if (!primaryField) return record.id;
  const value = record.fields[primaryField.name];
  return value != null ? String(value) : record.id;
}

const connector: Connector = {
  manifest: {
    name: "airtable",
    version: "0.1.0",
    description: "Index Airtable bases, tables, and records",
    configSchema: AirtableConfigSchema,
  },

  async validate(config) {
    const result = AirtableConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    const parsed = result.data;
    const token = process.env[parsed.token_env];
    if (!token) {
      return {
        valid: false,
        errors: [`Environment variable ${parsed.token_env} is not set`],
      };
    }
    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = AirtableConfigSchema.parse(config);
    const token = process.env[parsed.token_env];
    if (!token) {
      throw new Error(`Environment variable ${parsed.token_env} is not set`);
    }

    const headers = buildHeaders(token);

    // Fetch bases
    let bases = await fetchBases(headers, options.signal);
    if (parsed.base_ids && parsed.base_ids.length > 0) {
      const allowedIds = new Set(parsed.base_ids);
      bases = bases.filter((b) => allowedIds.has(b.id));
    }

    let indexed = 0;

    for (const base of bases) {
      if (options.signal?.aborted) return;

      const tables = await fetchTables(base.id, headers, options.signal);

      for (const table of tables) {
        if (options.signal?.aborted) return;

        const records = await fetchRecords(base.id, table.id, headers, options.signal);

        for (const record of records) {
          if (options.signal?.aborted) return;

          const title = getPrimaryFieldValue(record, table);
          const content = recordToContent(record.fields);

          const item: ContentItem = {
            id: `airtable:${base.id}:${table.id}:${record.id}`,
            source: "airtable",
            type: "document",
            title,
            description: `Airtable record from ${base.name} / ${table.name}`,
            tags: [base.name, table.name],
            uri: `https://airtable.com/${base.id}/${table.id}/${record.id}`,
            metadata: {
              baseId: base.id,
              baseName: base.name,
              tableId: table.id,
              tableName: table.name,
              createdTime: record.createdTime,
            },
            indexedAt: new Date().toISOString(),
            content,
          };

          indexed++;
          options.onProgress?.(indexed);
          yield item;
        }
      }
    }
  },
};

export default connector;

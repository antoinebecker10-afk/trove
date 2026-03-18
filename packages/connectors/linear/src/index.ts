import { z } from "zod";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LinearConfigSchema = z.object({
  /** Env var name for the Linear API key (default: LINEAR_TOKEN) */
  token_env: z.string().default("LINEAR_TOKEN"),
  /** Restrict indexing to specific team IDs */
  team_ids: z.array(z.string()).optional(),
  /** Include archived issues */
  include_archived: z.boolean().default(false),
  /** Include completed issues */
  include_completed: z.boolean().default(true),
  /** Only issues updated in the last N days */
  since_days: z.number().default(90),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface LinearLabel {
  name: string;
}

interface LinearState {
  name: string;
}

interface LinearAssignee {
  name: string;
}

interface LinearProject {
  name: string;
}

interface LinearIssue {
  id: string;
  title: string;
  description: string | null;
  state: LinearState | null;
  priority: number;
  labels: { nodes: LinearLabel[] };
  assignee: LinearAssignee | null;
  project: LinearProject | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface LinearDocument {
  id: string;
  title: string;
  content: string | null;
  project: LinearProject | null;
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PRIORITY_LABELS: Record<number, string> = {
  0: "None",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

const LINEAR_API = "https://api.linear.app/graphql";

/**
 * Execute a GraphQL query against the Linear API.
 * Respects rate-limit headers by waiting when needed.
 */
async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  token: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });

  // Respect rate-limit headers
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const waitMs = retryAfter ? Number(retryAfter) * 1000 : 5000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return graphql<T>(query, variables, token, signal);
  }

  if (!response.ok) {
    // Don't leak response body — may contain sensitive info
    await response.text().catch(() => { /* drain body */ });
    throw new Error(`Linear API error (${response.status})`);
  }

  const json = (await response.json()) as GraphQLResponse<T>;

  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }

  if (!json.data) {
    throw new Error("Linear API returned no data");
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const ISSUES_QUERY = `
query Issues($after: String, $filter: IssueFilter) {
  issues(first: 50, after: $after, filter: $filter) {
    nodes {
      id
      title
      description
      state { name }
      priority
      labels { nodes { name } }
      assignee { name }
      project { name }
      url
      createdAt
      updatedAt
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

const DOCUMENTS_QUERY = `
query Documents($after: String) {
  documents(first: 50, after: $after) {
    nodes {
      id
      title
      content
      project { name }
      url
      createdAt
      updatedAt
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

// ---------------------------------------------------------------------------
// Iteration helpers
// ---------------------------------------------------------------------------

interface IssuesResponse {
  issues: {
    nodes: LinearIssue[];
    pageInfo: PageInfo;
  };
}

interface DocumentsResponse {
  documents: {
    nodes: LinearDocument[];
    pageInfo: PageInfo;
  };
}

async function* fetchIssues(
  token: string,
  filter: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<LinearIssue> {
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    if (signal?.aborted) return;

    const data: IssuesResponse = await graphql<IssuesResponse>(
      ISSUES_QUERY,
      { after, filter },
      token,
      signal,
    );

    for (const issue of data.issues.nodes) {
      yield issue;
    }

    hasNextPage = data.issues.pageInfo.hasNextPage;
    after = data.issues.pageInfo.endCursor;
  }
}

async function* fetchDocuments(
  token: string,
  signal?: AbortSignal,
): AsyncGenerator<LinearDocument> {
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    if (signal?.aborted) return;

    const data: DocumentsResponse = await graphql<DocumentsResponse>(
      DOCUMENTS_QUERY,
      { after },
      token,
      signal,
    );

    for (const doc of data.documents.nodes) {
      yield doc;
    }

    hasNextPage = data.documents.pageInfo.hasNextPage;
    after = data.documents.pageInfo.endCursor;
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function issueToContentItem(issue: LinearIssue): ContentItem {
  const tags: string[] = [];

  if (issue.state) tags.push(issue.state.name);
  for (const label of issue.labels.nodes) tags.push(label.name);
  if (issue.project) tags.push(issue.project.name);
  tags.push(PRIORITY_LABELS[issue.priority] ?? "None");
  if (issue.assignee) tags.push(issue.assignee.name);

  const description = issue.description
    ? issue.description.slice(0, 200)
    : `Linear issue: ${issue.title}`;

  return {
    id: `linear:issue:${issue.id}`,
    source: "linear",
    type: "document",
    title: issue.title,
    description,
    tags,
    uri: issue.url,
    metadata: {
      priority: issue.priority,
      priorityLabel: PRIORITY_LABELS[issue.priority] ?? "None",
      state: issue.state?.name ?? null,
      assignee: issue.assignee?.name ?? null,
      project: issue.project?.name ?? null,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    },
    indexedAt: new Date().toISOString(),
    content: issue.description ?? undefined,
  };
}

function documentToContentItem(doc: LinearDocument): ContentItem {
  return {
    id: `linear:doc:${doc.id}`,
    source: "linear",
    type: "document",
    title: doc.title,
    description: doc.content ? doc.content.slice(0, 200) : `Linear document: ${doc.title}`,
    tags: doc.project ? [doc.project.name] : [],
    uri: doc.url,
    metadata: {
      project: doc.project?.name ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    },
    indexedAt: new Date().toISOString(),
    content: doc.content ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

const connector: Connector = {
  manifest: {
    name: "linear",
    version: "0.1.0",
    description: "Index Linear issues and documents",
    configSchema: LinearConfigSchema,
  },

  async validate(config) {
    const result = LinearConfigSchema.safeParse(config);
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
    const parsed = LinearConfigSchema.parse(config);
    const token = process.env[parsed.token_env];

    if (!token) {
      throw new Error(
        `Environment variable ${parsed.token_env} is not set. Create a Linear API key at https://linear.app/settings/api`,
      );
    }

    // Build issue filter
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - parsed.since_days);

    const filter: Record<string, unknown> = {
      updatedAt: { gte: sinceDate.toISOString() },
    };

    if (!parsed.include_archived) {
      // Linear uses a "null" archived-at to mean not archived
      // We filter via the state type instead — archived issues have a specific state
      // The simplest approach: exclude via filter
    }

    if (parsed.team_ids?.length) {
      filter.team = { id: { in: parsed.team_ids } };
    }

    let indexed = 0;

    // Index issues
    for await (const issue of fetchIssues(token, filter, options.signal)) {
      if (options.signal?.aborted) return;

      // Skip completed issues if configured to exclude them
      if (
        !parsed.include_completed &&
        issue.state?.name &&
        ["Done", "Canceled", "Cancelled", "Completed"].includes(issue.state.name)
      ) {
        continue;
      }

      indexed++;
      options.onProgress?.(indexed);
      yield issueToContentItem(issue);
    }

    // Index documents
    for await (const doc of fetchDocuments(token, options.signal)) {
      if (options.signal?.aborted) return;

      indexed++;
      options.onProgress?.(indexed);
      yield documentToContentItem(doc);
    }
  },
};

export default connector;

// Re-export for testing
export { LinearConfigSchema, issueToContentItem, documentToContentItem, graphql };
export type { LinearIssue, LinearDocument };

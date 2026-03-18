import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import connector, {
  LinearConfigSchema,
  issueToContentItem,
  documentToContentItem,
} from "./index.js";
import type { LinearIssue, LinearDocument } from "./index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ISSUE_FIXTURE: LinearIssue = {
  id: "abc-123",
  title: "Fix login bug",
  description: "Users cannot login when using SSO.\n\nSteps to reproduce:\n1. Click SSO\n2. Redirects fail",
  state: { name: "In Progress" },
  priority: 2,
  labels: { nodes: [{ name: "bug" }, { name: "auth" }] },
  assignee: { name: "Alice" },
  project: { name: "Backend" },
  url: "https://linear.app/team/issue/ABC-123",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-06-01T00:00:00.000Z",
};

const DOCUMENT_FIXTURE: LinearDocument = {
  id: "doc-456",
  title: "Architecture RFC",
  content: "# Architecture\n\nThis document describes the new architecture.\n\nWe will use microservices.",
  project: { name: "Platform" },
  url: "https://linear.app/team/document/doc-456",
  createdAt: "2025-02-01T00:00:00.000Z",
  updatedAt: "2025-05-15T00:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("LinearConfigSchema", () => {
  it("applies defaults for minimal config", () => {
    const result = LinearConfigSchema.parse({});
    expect(result.token_env).toBe("LINEAR_TOKEN");
    expect(result.include_archived).toBe(false);
    expect(result.include_completed).toBe(true);
    expect(result.since_days).toBe(90);
    expect(result.team_ids).toBeUndefined();
  });

  it("accepts full config", () => {
    const result = LinearConfigSchema.parse({
      token_env: "MY_LINEAR_KEY",
      team_ids: ["team-1", "team-2"],
      include_archived: true,
      include_completed: false,
      since_days: 30,
    });
    expect(result.token_env).toBe("MY_LINEAR_KEY");
    expect(result.team_ids).toEqual(["team-1", "team-2"]);
    expect(result.include_archived).toBe(true);
    expect(result.include_completed).toBe(false);
    expect(result.since_days).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Mapping: issues
// ---------------------------------------------------------------------------

describe("issueToContentItem", () => {
  it("maps a Linear issue to a ContentItem", () => {
    const item = issueToContentItem(ISSUE_FIXTURE);

    expect(item.id).toBe("linear:issue:abc-123");
    expect(item.source).toBe("linear");
    expect(item.type).toBe("document");
    expect(item.title).toBe("Fix login bug");
    expect(item.description).toBe(ISSUE_FIXTURE.description!.slice(0, 200));
    expect(item.uri).toBe("https://linear.app/team/issue/ABC-123");
    expect(item.content).toBe(ISSUE_FIXTURE.description);
  });

  it("includes correct tags", () => {
    const item = issueToContentItem(ISSUE_FIXTURE);
    expect(item.tags).toContain("In Progress");
    expect(item.tags).toContain("bug");
    expect(item.tags).toContain("auth");
    expect(item.tags).toContain("Backend");
    expect(item.tags).toContain("High");
    expect(item.tags).toContain("Alice");
  });

  it("maps priority numbers to labels in metadata", () => {
    const item = issueToContentItem(ISSUE_FIXTURE);
    expect(item.metadata.priorityLabel).toBe("High");
    expect(item.metadata.priority).toBe(2);
  });

  it("handles issue with no description", () => {
    const issue: LinearIssue = { ...ISSUE_FIXTURE, description: null };
    const item = issueToContentItem(issue);
    expect(item.description).toBe("Linear issue: Fix login bug");
    expect(item.content).toBeUndefined();
  });

  it("handles issue with no assignee, project, or state", () => {
    const issue: LinearIssue = {
      ...ISSUE_FIXTURE,
      state: null,
      assignee: null,
      project: null,
    };
    const item = issueToContentItem(issue);
    expect(item.tags).not.toContain("In Progress");
    expect(item.tags).not.toContain("Alice");
    expect(item.tags).not.toContain("Backend");
    expect(item.metadata.state).toBeNull();
    expect(item.metadata.assignee).toBeNull();
    expect(item.metadata.project).toBeNull();
  });

  it("maps all priority levels", () => {
    for (const [num, label] of [
      [0, "None"],
      [1, "Urgent"],
      [2, "High"],
      [3, "Medium"],
      [4, "Low"],
    ] as const) {
      const item = issueToContentItem({ ...ISSUE_FIXTURE, priority: num });
      expect(item.metadata.priorityLabel).toBe(label);
      expect(item.tags).toContain(label);
    }
  });
});

// ---------------------------------------------------------------------------
// Mapping: documents
// ---------------------------------------------------------------------------

describe("documentToContentItem", () => {
  it("maps a Linear document to a ContentItem", () => {
    const item = documentToContentItem(DOCUMENT_FIXTURE);

    expect(item.id).toBe("linear:doc:doc-456");
    expect(item.source).toBe("linear");
    expect(item.type).toBe("document");
    expect(item.title).toBe("Architecture RFC");
    expect(item.uri).toBe("https://linear.app/team/document/doc-456");
    expect(item.content).toBe(DOCUMENT_FIXTURE.content);
    expect(item.tags).toContain("Platform");
  });

  it("handles document with no content", () => {
    const doc: LinearDocument = { ...DOCUMENT_FIXTURE, content: null };
    const item = documentToContentItem(doc);
    expect(item.description).toBe("Linear document: Architecture RFC");
    expect(item.content).toBeUndefined();
  });

  it("handles document with no project", () => {
    const doc: LinearDocument = { ...DOCUMENT_FIXTURE, project: null };
    const item = documentToContentItem(doc);
    expect(item.tags).toEqual([]);
    expect(item.metadata.project).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Connector manifest
// ---------------------------------------------------------------------------

describe("connector manifest", () => {
  it("has correct name and version", () => {
    expect(connector.manifest.name).toBe("linear");
    expect(connector.manifest.version).toBe("0.1.0");
  });
});

// ---------------------------------------------------------------------------
// Connector.validate
// ---------------------------------------------------------------------------

describe("connector.validate", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns valid when token env is set", async () => {
    process.env.LINEAR_TOKEN = "lin_api_test";
    const result = await connector.validate({});
    expect(result.valid).toBe(true);
  });

  it("returns invalid when token env is missing", async () => {
    delete process.env.LINEAR_TOKEN;
    const result = await connector.validate({});
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain("LINEAR_TOKEN");
  });

  it("returns invalid for bad config shape", async () => {
    const result = await connector.validate({ since_days: "not-a-number" });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Connector.index (mocked fetch)
// ---------------------------------------------------------------------------

describe("connector.index", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv, LINEAR_TOKEN: "lin_api_test_token" };
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("yields issues and documents from paginated responses", async () => {
    const issuesPage1 = {
      data: {
        issues: {
          nodes: [ISSUE_FIXTURE],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };

    const documentsPage1 = {
      data: {
        documents: {
          nodes: [DOCUMENT_FIXTURE],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };

    let callIndex = 0;
    globalThis.fetch = vi.fn(async () => {
      callIndex++;
      const body = callIndex === 1 ? issuesPage1 : documentsPage1;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const items = [];
    for await (const item of connector.index({}, { signal: undefined })) {
      items.push(item);
    }

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("linear:issue:abc-123");
    expect(items[1].id).toBe("linear:doc:doc-456");
  });

  it("handles cursor-based pagination for issues", async () => {
    const issuesPage1 = {
      data: {
        issues: {
          nodes: [ISSUE_FIXTURE],
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
        },
      },
    };

    const issue2: LinearIssue = { ...ISSUE_FIXTURE, id: "abc-456", title: "Second issue" };
    const issuesPage2 = {
      data: {
        issues: {
          nodes: [issue2],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };

    const documentsPage = {
      data: {
        documents: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };

    let callIndex = 0;
    globalThis.fetch = vi.fn(async () => {
      callIndex++;
      let body;
      if (callIndex === 1) body = issuesPage1;
      else if (callIndex === 2) body = issuesPage2;
      else body = documentsPage;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const items = [];
    for await (const item of connector.index({}, { signal: undefined })) {
      items.push(item);
    }

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("linear:issue:abc-123");
    expect(items[1].id).toBe("linear:issue:abc-456");
  });

  it("throws when token is not set", async () => {
    delete process.env.LINEAR_TOKEN;

    const gen = connector.index({}, { signal: undefined });
    await expect(gen.next()).rejects.toThrow("LINEAR_TOKEN");
  });

  it("filters out completed issues when include_completed is false", async () => {
    const doneIssue: LinearIssue = {
      ...ISSUE_FIXTURE,
      id: "done-1",
      state: { name: "Done" },
    };

    const issuesPage = {
      data: {
        issues: {
          nodes: [ISSUE_FIXTURE, doneIssue],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };

    const documentsPage = {
      data: {
        documents: {
          nodes: [],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };

    let callIndex = 0;
    globalThis.fetch = vi.fn(async () => {
      callIndex++;
      const body = callIndex === 1 ? issuesPage : documentsPage;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const items = [];
    for await (const item of connector.index(
      { include_completed: false },
      { signal: undefined },
    )) {
      items.push(item);
    }

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("linear:issue:abc-123");
  });

  it("calls onProgress callback", async () => {
    const issuesPage = {
      data: {
        issues: {
          nodes: [ISSUE_FIXTURE],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };

    const documentsPage = {
      data: {
        documents: {
          nodes: [DOCUMENT_FIXTURE],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };

    let callIndex = 0;
    globalThis.fetch = vi.fn(async () => {
      callIndex++;
      const body = callIndex === 1 ? issuesPage : documentsPage;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const progressCalls: number[] = [];
    const items = [];
    for await (const item of connector.index({}, {
      signal: undefined,
      onProgress: (n) => progressCalls.push(n),
    })) {
      items.push(item);
    }

    expect(progressCalls).toEqual([1, 2]);
  });
});

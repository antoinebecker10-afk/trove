import { z } from "zod";
import { RateLimiter } from "@trove/shared";
import type { Connector, ContentItem, IndexOptions } from "@trove/shared";

const GithubConfigSchema = z.object({
  username: z.string().min(1),
  include_forks: z.boolean().default(false),
  include_archived: z.boolean().default(false),
  /** Env var name for the token (default: GITHUB_TOKEN) */
  token_env: z.string().default("GITHUB_TOKEN"),
});

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  topics: string[];
  fork: boolean;
  archived: boolean;
  pushed_at: string;
  created_at: string;
  default_branch: string;
}

const limiter = new RateLimiter(5);

/**
 * Fetch all pages of a GitHub API endpoint.
 * Uses Link header for pagination.
 */
async function fetchAllPages<T>(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    if (signal?.aborted) break;

    await limiter.wait();
    const response: Response = await fetch(nextUrl, { headers, signal });

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error(
          "GitHub API rate limit exceeded. Set GITHUB_TOKEN env var to increase limits.",
        );
      }
      // Don't leak response body — may contain sensitive info
      await response.text().catch(() => { /* drain body */ });
      throw new Error(`GitHub API error (${response.status})`);
    }

    const data = (await response.json()) as T[];
    results.push(...data);

    // Parse Link header for next page
    const linkHeader: string | null = response.headers.get("Link");
    nextUrl = null;
    if (linkHeader) {
      const match: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (match) nextUrl = match[1];
    }
  }

  return results;
}

/**
 * Fetch the README content for a repo.
 */
async function fetchReadme(
  fullName: string,
  headers: Record<string, string>,
): Promise<string | undefined> {
  try {
    await limiter.wait();
    const response = await fetch(
      `https://api.github.com/repos/${fullName}/readme`,
      {
        headers: { ...headers, Accept: "application/vnd.github.raw+json" },
      },
    );
    if (!response.ok) return undefined;
    const text = await response.text();
    // Limit README size for indexing
    return text.slice(0, 5000);
  } catch {
    return undefined;
  }
}

const connector: Connector = {
  manifest: {
    name: "github",
    version: "0.1.0",
    description: "Index GitHub repositories with metadata and README content",
    configSchema: GithubConfigSchema,
  },

  async validate(config) {
    const result = GithubConfigSchema.safeParse(config);
    if (!result.success) {
      return {
        valid: false,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    return { valid: true };
  },

  async *index(config: Record<string, unknown>, options: IndexOptions) {
    const parsed = GithubConfigSchema.parse(config);
    const token = process.env[parsed.token_env];

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "Trove/0.1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const repos = await fetchAllPages<GitHubRepo>(
      `https://api.github.com/users/${encodeURIComponent(parsed.username)}/repos?per_page=100&sort=pushed`,
      headers,
      options.signal,
    );

    let indexed = 0;

    for (const repo of repos) {
      if (options.signal?.aborted) return;
      if (repo.fork && !parsed.include_forks) continue;
      if (repo.archived && !parsed.include_archived) continue;

      // Fetch README for richer search
      const readme = await fetchReadme(repo.full_name, headers);

      const tags = [
        ...(repo.topics ?? []),
        ...(repo.language ? [repo.language.toLowerCase()] : []),
      ];

      const item: ContentItem = {
        id: `github:${repo.full_name}`,
        source: "github",
        type: "github",
        title: repo.name,
        description: repo.description ?? `GitHub repository ${repo.full_name}`,
        tags,
        uri: repo.html_url,
        metadata: {
          stars: repo.stargazers_count,
          language: repo.language,
          topics: repo.topics,
          fork: repo.fork,
          archived: repo.archived,
          pushedAt: repo.pushed_at,
          createdAt: repo.created_at,
          defaultBranch: repo.default_branch,
        },
        indexedAt: new Date().toISOString(),
        content: readme,
      };

      indexed++;
      options.onProgress?.(indexed, repos.length);
      yield item;
    }
  },
};

export default connector;

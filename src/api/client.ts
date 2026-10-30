// 個々の API 呼び出し。レスポンスは decode.ts でドメイン型に変換して返す。

import {
  decodeArrayOf,
  decodeArtifactPage,
  decodeIssueSearchPage,
  decodeOrganization,
  decodeOwner,
  decodeRepository,
  splitScopes,
} from "./decode";
import { DecodeError, GitHubApiError } from "./errors";
import { GitHubHttp, type HttpOptions } from "./http";
import type { Artifact, Issue, Owner, RepoRef, Repository, TokenInfo, TokenKind } from "./types";

const PER_PAGE = 100;
/** Search API が 1 つの検索で返す件数の上限 */
export const SEARCH_RESULT_LIMIT = 1000;

export interface CallOptions {
  signal?: AbortSignal;
}

export interface IssueSearchPage {
  totalCount: number;
  incomplete: boolean;
  issues: Issue[];
}

export interface DownloadRequest {
  url: string;
  headers: Array<{ name: string; value: string }>;
}

export class GitHubClient {
  readonly http: GitHubHttp;

  constructor(options: HttpOptions | GitHubHttp) {
    this.http = options instanceof GitHubHttp ? options : new GitHubHttp(options);
  }

  async getAuthenticatedUser(options: CallOptions = {}): Promise<Owner> {
    const { data } = await this.http.json("/user", options);
    return decode(() => decodeOwner(data, "user"));
  }

  /** トークンの種類・スコープ・有効期限と、ログインしているユーザーを調べる */
  async inspectToken(token: string, options: CallOptions = {}): Promise<TokenInfo> {
    const { data, response } = await this.http.json("/user", options);
    const scopesHeader = response.headers.get("x-oauth-scopes");
    return {
      kind: tokenKindFromPrefix(token),
      user: decode(() => decodeOwner(data, "user")),
      // Fine-grained PAT にはこのヘッダーが付かない
      scopes: scopesHeader === null ? null : splitScopes(scopesHeader),
      expiresAt: parseTokenExpiration(response.headers.get("github-authentication-token-expiration")),
    };
  }

  async listMyOrganizations(options: CallOptions = {}): Promise<Owner[]> {
    const orgs: Owner[] = [];
    for await (const page of this.http.paginate("/user/orgs", { ...options, query: { per_page: PER_PAGE } })) {
      orgs.push(...decode(() => decodeArrayOf(page, "orgs", decodeOrganization)));
    }
    return orgs;
  }

  /** 自分がアクセスできるリポジトリ（自分の所有・コラボレーター・所属 Org）を全部返す */
  async listMyRepositories(options: CallOptions = {}): Promise<Repository[]> {
    const repos: Repository[] = [];
    const query = { per_page: PER_PAGE, affiliation: "owner,collaborator,organization_member", sort: "full_name" };
    for await (const page of this.http.paginate("/user/repos", { ...options, query })) {
      repos.push(...decode(() => decodeArrayOf(page, "repos", decodeRepository)));
    }
    return repos;
  }

  async listRepoArtifacts(repo: RepoRef, options: CallOptions = {}): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];
    const path = `${repoPath(repo)}/actions/artifacts`;
    for await (const page of this.http.paginate(path, { ...options, query: { per_page: PER_PAGE } })) {
      artifacts.push(...decode(() => decodeArtifactPage(page, repo).artifacts));
    }
    return artifacts;
  }

  async deleteArtifact(artifact: Pick<Artifact, "id" | "repo">, options: CallOptions = {}): Promise<void> {
    await this.http.request(`${repoPath(artifact.repo)}/actions/artifacts/${artifact.id}`, {
      ...options,
      method: "DELETE",
    });
  }

  /**
   * アーティファクトの ZIP を取得するための URL とヘッダー。
   * chrome.downloads.download({ url, headers }) に渡す想定。
   * この URL は署名付きのストレージ URL へリダイレクトする。
   */
  artifactDownloadRequest(artifact: Pick<Artifact, "id" | "repo">): DownloadRequest {
    const url = this.http.url(`${repoPath(artifact.repo)}/actions/artifacts/${artifact.id}/zip`);
    const headers = Object.entries(this.http.headers()).map(([name, value]) => ({ name, value }));
    return { url, headers };
  }

  /** Search API の 1 ページ分 */
  async searchIssuesPage(
    q: string,
    page: number,
    options: CallOptions & { sort?: "created" | "updated" | "comments"; order?: "asc" | "desc" } = {},
  ): Promise<IssueSearchPage> {
    const { sort = "updated", order = "desc", ...rest } = options;
    const { data } = await this.http.json("/search/issues", {
      ...rest,
      query: { q, sort, order, per_page: PER_PAGE, page },
    });
    return decode(() => decodeIssueSearchPage(data));
  }

  /**
   * 検索結果を上限（1000 件）まで全ページ取得する。
   * totalCount が上限を超えていれば truncated: true になる。
   */
  async searchIssues(
    q: string,
    options: CallOptions & { firstPage?: IssueSearchPage } = {},
  ): Promise<IssueSearchPage & { truncated: boolean }> {
    const { firstPage, ...rest } = options;
    const first = firstPage ?? (await this.searchIssuesPage(q, 1, rest));
    const issues = [...first.issues];
    let incomplete = first.incomplete;
    const reachable = Math.min(first.totalCount, SEARCH_RESULT_LIMIT);
    const lastPage = Math.ceil(reachable / PER_PAGE);
    for (let page = 2; page <= lastPage; page++) {
      const p = await this.searchIssuesPage(q, page, rest);
      issues.push(...p.issues);
      incomplete ||= p.incomplete;
      if (p.issues.length === 0) break;
    }
    return { totalCount: first.totalCount, incomplete, issues, truncated: first.totalCount > SEARCH_RESULT_LIMIT };
  }
}

export function repoPath(repo: RepoRef): string {
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

/** デコード失敗を GitHubApiError(kind: "decode") に包む */
function decode<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof DecodeError) {
      throw new GitHubApiError({ kind: "decode", message: `Unexpected response shape: ${e.message}`, cause: e });
    }
    throw e;
  }
}

export function tokenKindFromPrefix(token: string): TokenKind {
  if (token.startsWith("ghp_")) return "classic-pat";
  if (token.startsWith("github_pat_")) return "fine-grained-pat";
  if (token.startsWith("gho_")) return "oauth";
  if (token.startsWith("ghu_")) return "github-app-user";
  return "unknown";
}

/**
 * GitHub-Authentication-Token-Expiration ヘッダー（例: "2026-11-30 12:34:56 UTC"）を ISO 8601 にする。
 * 解釈できなければ null。
 */
export function parseTokenExpiration(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const zone = m[3] === undefined || m[3] === "UTC" || m[3] === "Z" ? "Z" : m[3].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

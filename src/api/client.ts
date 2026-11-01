// 個々の API 呼び出し。レスポンスは decode.ts でドメイン型に変換して返す。

import {
  decodeArrayOf,
  decodeArtifactPage,
  decodeBranchNames,
  decodeCachePage,
  decodeEnvironmentNames,
  decodeWorkflowPage,
  decodeWorkflowRunPage,
  decodeIssueSearchPage,
  decodeOrganization,
  decodeOwner,
  decodeRepository,
  splitScopes,
} from "./decode";
import { DecodeError, GitHubApiError } from "./errors";
import { GitHubHttp, type HttpOptions } from "./http";
import type {
  ActionsCache,
  Artifact,
  Issue,
  Owner,
  RepoRef,
  Repository,
  TokenInfo,
  TokenKind,
  Workflow,
  WorkflowRun,
} from "./types";

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
    const kind = tokenKindFromPrefix(token);
    // スコープを持つのは Classic PAT と OAuth トークンだけ。
    // スコープを持たないトークンにも空の X-OAuth-Scopes が付くことがあるので、ヘッダーの有無では判断しない
    const hasScopes = kind === "classic-pat" || kind === "oauth";
    return {
      kind,
      user: decode(() => decodeOwner(data, "user")),
      scopes: hasScopes && scopesHeader !== null ? splitScopes(scopesHeader) : null,
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

  async listRepoWorkflows(repo: RepoRef, options: CallOptions = {}): Promise<Workflow[]> {
    const workflows: Workflow[] = [];
    const path = `${repoPath(repo)}/actions/workflows`;
    for await (const page of this.http.paginate(path, { ...options, query: { per_page: PER_PAGE } })) {
      workflows.push(...decode(() => decodeWorkflowPage(page, repo)));
    }
    return workflows;
  }

  /** リポジトリの新しい順の実行履歴（1 ページ分）。ワークフローごとの最新の実行を知るために使う */
  async listRecentRuns(repo: RepoRef, options: CallOptions & { perPage?: number } = {}): Promise<WorkflowRun[]> {
    const { perPage = PER_PAGE, ...rest } = options;
    const { data } = await this.http.json(`${repoPath(repo)}/actions/runs`, { ...rest, query: { per_page: perPage } });
    return decode(() => decodeWorkflowRunPage(data, repo));
  }

  /**
   * 条件に合う実行履歴を新しい順に取得する。GitHub は条件付きの検索で最大 1,000 件までしか返さないので、
   * それを超える分は返らない（truncated が true になる）
   */
  async listRuns(
    repo: RepoRef,
    filter: { created?: string; status?: string },
    options: CallOptions & { maxResults?: number } = {},
  ): Promise<{ runs: WorkflowRun[]; totalCount: number; truncated: boolean }> {
    const { maxResults = 1000, ...rest } = options;
    const runs: WorkflowRun[] = [];
    let totalCount = 0;
    const query = { per_page: PER_PAGE, ...(filter.created ? { created: filter.created } : {}), ...(filter.status ? { status: filter.status } : {}) };
    for await (const page of this.http.paginate(`${repoPath(repo)}/actions/runs`, { ...rest, query })) {
      const o = page as { total_count?: unknown };
      if (typeof o.total_count === "number") totalCount = o.total_count;
      runs.push(...decode(() => decodeWorkflowRunPage(page, repo)));
      if (runs.length >= maxResults) break;
    }
    return { runs: runs.slice(0, maxResults), totalCount, truncated: totalCount > Math.min(runs.length, maxResults) };
  }

  async deleteRun(run: Pick<WorkflowRun, "id" | "repo">, options: CallOptions = {}): Promise<void> {
    await this.http.request(`${repoPath(run.repo)}/actions/runs/${run.id}`, { ...options, method: "DELETE" });
  }

  /** キャッシュを最後に使われた新しい順に全部取得する */
  async listRepoCaches(repo: RepoRef, options: CallOptions = {}): Promise<ActionsCache[]> {
    const caches: ActionsCache[] = [];
    const query = { per_page: PER_PAGE, sort: "last_accessed_at", direction: "desc" };
    for await (const page of this.http.paginate(`${repoPath(repo)}/actions/caches`, { ...options, query })) {
      caches.push(...decode(() => decodeCachePage(page, repo)));
    }
    return caches;
  }

  async deleteCache(cache: Pick<ActionsCache, "id" | "repo">, options: CallOptions = {}): Promise<void> {
    await this.http.request(`${repoPath(cache.repo)}/actions/caches/${cache.id}`, { ...options, method: "DELETE" });
  }

  /** ファイルの中身をテキストで取得する（ワークフローの YAML を読むため） */
  async getFileText(repo: RepoRef, path: string, ref?: string, options: CallOptions = {}): Promise<string> {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const response = await this.http.request(`${repoPath(repo)}/contents/${encodedPath}`, {
      ...options,
      accept: "application/vnd.github.raw+json",
      ...(ref ? { query: { ref } } : {}),
    });
    return response.text();
  }

  async listBranches(repo: RepoRef, options: CallOptions = {}): Promise<string[]> {
    const names: string[] = [];
    for await (const page of this.http.paginate(`${repoPath(repo)}/branches`, { ...options, query: { per_page: PER_PAGE } })) {
      names.push(...decode(() => decodeBranchNames(page)));
    }
    return names;
  }

  async listEnvironments(repo: RepoRef, options: CallOptions = {}): Promise<string[]> {
    const names: string[] = [];
    for await (const page of this.http.paginate(`${repoPath(repo)}/environments`, { ...options, query: { per_page: PER_PAGE } })) {
      names.push(...decode(() => decodeEnvironmentNames(page)));
    }
    return names;
  }

  /** workflow_dispatch でワークフローを実行する。入力値は文字列で送る（GitHub の画面と同じ） */
  async dispatchWorkflow(
    workflow: Pick<Workflow, "id" | "repo">,
    ref: string,
    inputs: Record<string, string>,
    options: CallOptions = {},
  ): Promise<void> {
    await this.http.request(`${repoPath(workflow.repo)}/actions/workflows/${workflow.id}/dispatches`, {
      ...options,
      method: "POST",
      body: { ref, inputs },
    });
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

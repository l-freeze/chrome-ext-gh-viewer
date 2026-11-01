// 複数のリポジトリ・所有者にまたがる取得。
// 1 つのリポジトリで失敗しても全体は止めず、結果ごとに成否を返す。

import type { GitHubClient } from "./client";
import { GitHubApiError } from "./errors";
import type { Artifact, Issue, Owner, Repository, Workflow, WorkflowRun } from "./types";

export type RepoArtifactsResult =
  | { repo: Repository; ok: true; artifacts: Artifact[] }
  | { repo: Repository; ok: false; error: GitHubApiError };

export interface Progress {
  done: number;
  total: number;
}

export interface ListArtifactsOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: Progress, result: RepoArtifactsResult) => void;
}

/** 固定のクライアント、または対象ごとに使うクライアントを返す関数 */
export type ClientFor<T> = GitHubClient | ((target: T) => GitHubClient);

function resolve<T>(clientFor: ClientFor<T>, target: T): GitHubClient {
  return typeof clientFor === "function" ? clientFor(target) : clientFor;
}

export async function listArtifactsForRepos(
  client: ClientFor<Repository>,
  repos: readonly Repository[],
  options: ListArtifactsOptions = {},
): Promise<RepoArtifactsResult[]> {
  let done = 0;
  return mapWithConcurrency(repos, options.concurrency ?? 4, async (repo) => {
    let result: RepoArtifactsResult;
    try {
      const artifacts = await resolve(client, repo).listRepoArtifacts(
        { owner: repo.owner.login, name: repo.name },
        options.signal ? { signal: options.signal } : {},
      );
      result = { repo, ok: true, artifacts };
    } catch (e) {
      const error = toApiError(e);
      if (error.kind === "aborted") throw error;
      result = { repo, ok: false, error };
    }
    done++;
    options.onProgress?.({ done, total: repos.length }, result);
    return result;
  });
}

export type DeleteResult =
  | { artifact: Artifact; ok: true }
  | { artifact: Artifact; ok: false; error: GitHubApiError };

export async function deleteArtifacts(
  client: ClientFor<Artifact>,
  artifacts: readonly Artifact[],
  options: { concurrency?: number; signal?: AbortSignal; onProgress?: (p: Progress, r: DeleteResult) => void } = {},
): Promise<DeleteResult[]> {
  let done = 0;
  return mapWithConcurrency(artifacts, options.concurrency ?? 2, async (artifact) => {
    let result: DeleteResult;
    try {
      await resolve(client, artifact).deleteArtifact(artifact, options.signal ? { signal: options.signal } : {});
      result = { artifact, ok: true };
    } catch (e) {
      const error = toApiError(e);
      if (error.kind === "aborted") throw error;
      // すでに消えているなら目的は果たしているので成功扱い
      result = error.kind === "not_found" ? { artifact, ok: true } : { artifact, ok: false, error };
    }
    done++;
    options.onProgress?.({ done, total: artifacts.length }, result);
    return result;
  });
}

// ---------------------------------------------------------------------------
// 汎用: リポジトリごとの取得と、まとめての削除

export type RepoItemsResult<T> =
  | { repo: Repository; ok: true; items: T[]; truncated: boolean }
  | { repo: Repository; ok: false; error: GitHubApiError };

export interface ForEachOptions<R> {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: Progress, result: R) => void;
}

/** リポジトリごとに fetch を呼び、結果を集める。失敗したリポジトリはエラーとして返し、ほかは続ける */
export async function collectForRepos<T>(
  repos: readonly Repository[],
  fetch: (repo: Repository, signal: AbortSignal | undefined) => Promise<{ items: T[]; truncated?: boolean }>,
  options: ForEachOptions<RepoItemsResult<T>> = {},
): Promise<RepoItemsResult<T>[]> {
  let done = 0;
  return mapWithConcurrency(repos, options.concurrency ?? 4, async (repo) => {
    let result: RepoItemsResult<T>;
    try {
      const { items, truncated = false } = await fetch(repo, options.signal);
      result = { repo, ok: true, items, truncated };
    } catch (e) {
      const error = toApiError(e);
      if (error.kind === "aborted") throw error;
      result = { repo, ok: false, error };
    }
    done++;
    options.onProgress?.({ done, total: repos.length }, result);
    return result;
  });
}

export type ItemResult<T> = { item: T; ok: true } | { item: T; ok: false; error: GitHubApiError };

/** 1 件ずつ削除する。すでに消えている（404）ものは目的を果たしているので成功扱い。中断されたら止める */
export async function deleteEach<T>(
  items: readonly T[],
  remove: (item: T, signal: AbortSignal | undefined) => Promise<void>,
  options: ForEachOptions<ItemResult<T>> = {},
): Promise<ItemResult<T>[]> {
  let done = 0;
  return mapWithConcurrency(items, options.concurrency ?? 2, async (item) => {
    let result: ItemResult<T>;
    try {
      if (options.signal?.aborted) throw new GitHubApiError({ kind: "aborted", message: "Aborted" });
      await remove(item, options.signal);
      result = { item, ok: true };
    } catch (e) {
      const error = toApiError(e);
      if (error.kind === "aborted") throw error;
      result = error.kind === "not_found" ? { item, ok: true } : { item, ok: false, error };
    }
    done++;
    options.onProgress?.({ done, total: items.length }, result);
    return result;
  });
}

// ---------------------------------------------------------------------------
// ワークフロー

export interface WorkflowWithRun {
  workflow: Workflow;
  /** 最近の実行履歴（1 ページ分）の中での最新の実行。なければ null */
  lastRun: WorkflowRun | null;
}

export type RepoWorkflowsResult =
  | { repo: Repository; ok: true; workflows: WorkflowWithRun[] }
  | { repo: Repository; ok: false; error: GitHubApiError };

export interface ListWorkflowsOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: Progress, result: RepoWorkflowsResult) => void;
}

/** 新しい順に並んだ実行履歴から、ワークフローごとの最新の実行を取り出す */
export function latestRunByWorkflow(runs: readonly WorkflowRun[]): Map<number, WorkflowRun> {
  const latest = new Map<number, WorkflowRun>();
  for (const run of runs) {
    const cur = latest.get(run.workflowId);
    if (!cur || Date.parse(run.createdAt) > Date.parse(cur.createdAt)) latest.set(run.workflowId, run);
  }
  return latest;
}

/** リポジトリごとにワークフローと最新の実行を取得する。ワークフローがなければ実行履歴は取りにいかない */
export async function listWorkflowsForRepos(
  client: ClientFor<Repository>,
  repos: readonly Repository[],
  options: ListWorkflowsOptions = {},
): Promise<RepoWorkflowsResult[]> {
  let done = 0;
  return mapWithConcurrency(repos, options.concurrency ?? 4, async (repo) => {
    const ref = { owner: repo.owner.login, name: repo.name };
    const call = options.signal ? { signal: options.signal } : {};
    let result: RepoWorkflowsResult;
    try {
      const c = resolve(client, repo);
      const workflows = await c.listRepoWorkflows(ref, call);
      const latest =
        workflows.length > 0 ? latestRunByWorkflow(await c.listRecentRuns(ref, call)) : new Map<number, WorkflowRun>();
      result = {
        repo,
        ok: true,
        workflows: workflows.map((workflow) => ({ workflow, lastRun: latest.get(workflow.id) ?? null })),
      };
    } catch (e) {
      const error = toApiError(e);
      if (error.kind === "aborted") throw error;
      result = { repo, ok: false, error };
    }
    done++;
    options.onProgress?.({ done, total: repos.length }, result);
    return result;
  });
}

// ---------------------------------------------------------------------------
// Issue の横断検索
// ---------------------------------------------------------------------------

export type IssueStateFilter = "open" | "closed" | "all";

export interface IssueSearchFilter {
  state?: IssueStateFilter;
  /** 追加の検索条件（例: "label:bug"） */
  extra?: string;
}

export interface DateRange {
  /** YYYY-MM-DD（両端を含む） */
  from: string;
  to: string;
}

/** 検索クエリは所有者 1 つごとに作る（複数の org:/user: をまとめたときの解釈に依存しないため） */
export function buildIssueQuery(
  owner: Pick<Owner, "login" | "type">,
  filter: IssueSearchFilter = {},
  created?: DateRange,
): string {
  const parts = ["is:issue"];
  const state = filter.state ?? "open";
  if (state !== "all") parts.push(`is:${state}`);
  parts.push(`${owner.type === "Organization" ? "org" : "user"}:${owner.login}`);
  if (created) parts.push(`created:${created.from}..${created.to}`);
  const extra = filter.extra?.trim();
  if (extra) parts.push(extra);
  return parts.join(" ");
}

export interface OwnerIssuesResult {
  owner: Owner;
  issues: Issue[];
  /** 1 日単位まで分割しても 1000 件を超え、取りきれなかった */
  truncated: boolean;
  error: GitHubApiError | null;
}

export interface SearchIssuesOptions {
  signal?: AbortSignal;
  /** 分割検索を始める日付。GitHub のサービス開始前なので全件を含む */
  since?: string;
  /** 今日の日付（YYYY-MM-DD）。テスト用 */
  today?: string;
  onOwnerDone?: (result: OwnerIssuesResult) => void;
}

/**
 * 所有者ごとに Issue を検索し、全件を集める。
 * 1 回の検索で 1000 件を超える場合は、作成日の範囲を半分ずつに分けて検索し直す。
 * Search API のレート制限（1 分 30 回）があるため、所有者は 1 つずつ順に処理する。
 */
export async function searchIssuesForOwners(
  client: ClientFor<Owner>,
  owners: readonly Owner[],
  filter: IssueSearchFilter = {},
  options: SearchIssuesOptions = {},
): Promise<OwnerIssuesResult[]> {
  const results: OwnerIssuesResult[] = [];
  const range = { from: options.since ?? "2008-01-01", to: options.today ?? new Date().toISOString().slice(0, 10) };
  const call = options.signal ? { signal: options.signal } : {};

  for (const owner of owners) {
    const ownerClient = resolve(client, owner);
    const seen = new Map<number, Issue>();
    let truncated = false;
    let error: GitHubApiError | null = null;

    const searchRange = async (r: DateRange | undefined): Promise<void> => {
      const q = buildIssueQuery(owner, filter, r);
      const first = await ownerClient.searchIssuesPage(q, 1, call);
      if (first.totalCount > 1000) {
        const current = r ?? range;
        const split = splitRange(current);
        if (split) {
          await searchRange(split[0]);
          await searchRange(split[1]);
          return;
        }
      }
      const res = await ownerClient.searchIssues(q, { ...call, firstPage: first });
      truncated ||= res.truncated;
      for (const issue of res.issues) seen.set(issue.id, issue);
    };

    try {
      await searchRange(undefined);
    } catch (e) {
      error = toApiError(e);
      if (error.kind === "aborted") throw error;
    }
    const result = { owner, issues: [...seen.values()], truncated, error };
    results.push(result);
    options.onOwnerDone?.(result);
  }
  return results;
}

/** 日付範囲を重ならない 2 つに分ける。1 日だけなら分けられないので null */
export function splitRange(range: DateRange): [DateRange, DateRange] | null {
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  const days = Math.round((to - from) / DAY_MS);
  if (!(days >= 1)) return null;
  const mid = from + Math.floor(days / 2) * DAY_MS;
  return [
    { from: range.from, to: ymd(mid) },
    { from: ymd(mid + DAY_MS), to: range.to },
  ];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------

function toApiError(e: unknown): GitHubApiError {
  if (e instanceof GitHubApiError) return e;
  return new GitHubApiError({ kind: "unexpected", message: String(e), cause: e });
}

/** 同時実行数を limit に抑えて fn を適用する。結果は入力と同じ順に並ぶ */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker);
  await Promise.all(workers);
  return results;
}

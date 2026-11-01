// Actions のワークフローと実行: 一覧・検索・削除・手動実行（workflow_dispatch）。

import { arrayOf, num, obj, optStr, str } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, repoPath, type GitHubHttp, type RepoPath } from "./http";

export interface GitHubWorkflow {
  id: number;
  name: string;
  /** .github/workflows/ci.yml など。GitHub が内部で動かすものは dynamic/... になる */
  path: string;
  /** active / disabled_manually / disabled_inactivity など */
  state: string;
  html_url: string;
}

export interface GitHubRun {
  id: number;
  workflow_id: number;
  /** ワークフロー名 */
  name: string | null;
  display_title: string | null;
  run_number: number;
  /** queued / in_progress / completed など */
  status: string | null;
  /** success / failure / cancelled など。完了前は null */
  conclusion: string | null;
  event: string;
  head_branch: string | null;
  actor: { login: string; avatar_url: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface Call {
  signal?: AbortSignal;
}

export function readWorkflow(v: unknown, path = "workflow"): GitHubWorkflow {
  const o = obj(v, path);
  return {
    id: num(o, "id", path),
    name: str(o, "name", path),
    path: str(o, "path", path),
    state: str(o, "state", path),
    html_url: str(o, "html_url", path),
  };
}

export function readRun(v: unknown, path = "run"): GitHubRun {
  const o = obj(v, path);
  const actor = o["actor"];
  const a = actor === null || actor === undefined ? null : obj(actor, `${path}.actor`);
  return {
    id: num(o, "id", path),
    workflow_id: num(o, "workflow_id", path),
    name: optStr(o, "name", path),
    display_title: optStr(o, "display_title", path),
    run_number: num(o, "run_number", path),
    status: optStr(o, "status", path),
    conclusion: optStr(o, "conclusion", path),
    event: str(o, "event", path),
    head_branch: optStr(o, "head_branch", path),
    actor: a && { login: str(a, "login", `${path}.actor`), avatar_url: str(a, "avatar_url", `${path}.actor`) },
    created_at: str(o, "created_at", path),
    updated_at: str(o, "updated_at", path),
    html_url: str(o, "html_url", path),
  };
}

const readRunPage = (page: unknown) => arrayOf(obj(page, "runs")["workflow_runs"], "runs.workflow_runs", readRun);

export async function listWorkflows(http: GitHubHttp, repo: RepoPath, call: Call = {}): Promise<GitHubWorkflow[]> {
  const workflows: GitHubWorkflow[] = [];
  for await (const page of http.paginate(`${repoPath(repo)}/actions/workflows`, { ...call, query: { per_page: PER_PAGE } })) {
    workflows.push(...decode(() => arrayOf(obj(page, "workflows")["workflows"], "workflows.workflows", readWorkflow)));
  }
  return workflows;
}

/** 新しい順の実行履歴（1 ページ分） */
export async function listRecentRuns(http: GitHubHttp, repo: RepoPath, call: Call & { perPage?: number } = {}): Promise<GitHubRun[]> {
  const { perPage = PER_PAGE, ...rest } = call;
  const { data } = await http.json(`${repoPath(repo)}/actions/runs`, { ...rest, query: { per_page: perPage } });
  return decode(() => readRunPage(data));
}

/**
 * 条件に合う実行履歴を新しい順に取得する。GitHub は条件付きの検索で最大 1,000 件までしか返さないので、
 * それを超える分は返らない（truncated が true になる）
 */
export async function searchRuns(
  http: GitHubHttp,
  repo: RepoPath,
  filter: { created?: string; status?: string },
  call: Call & { maxResults?: number } = {},
): Promise<{ runs: GitHubRun[]; totalCount: number; truncated: boolean }> {
  const { maxResults = 1000, ...rest } = call;
  const runs: GitHubRun[] = [];
  let totalCount = 0;
  const query = {
    per_page: PER_PAGE,
    ...(filter.created ? { created: filter.created } : {}),
    ...(filter.status ? { status: filter.status } : {}),
  };
  for await (const page of http.paginate(`${repoPath(repo)}/actions/runs`, { ...rest, query })) {
    const total = (page as { total_count?: unknown }).total_count;
    if (typeof total === "number") totalCount = total;
    runs.push(...decode(() => readRunPage(page)));
    if (runs.length >= maxResults) break;
  }
  return { runs: runs.slice(0, maxResults), totalCount, truncated: totalCount > Math.min(runs.length, maxResults) };
}

export async function deleteRun(http: GitHubHttp, repo: RepoPath, id: number, call: Call = {}): Promise<void> {
  await http.request(`${repoPath(repo)}/actions/runs/${id}`, { ...call, method: "DELETE" });
}

export async function getRun(http: GitHubHttp, repo: RepoPath, id: number, call: Call = {}): Promise<GitHubRun> {
  const { data } = await http.json(`${repoPath(repo)}/actions/runs/${id}`, call);
  return decode(() => readRun(data));
}

/** 実行を依頼したときに GitHub が返す、作られた実行 */
export interface GitHubDispatchedRun {
  workflow_run_id: number;
  html_url: string;
}

export function readDispatchedRun(v: unknown, path = "dispatch"): GitHubDispatchedRun {
  const o = obj(v, path);
  return { workflow_run_id: num(o, "workflow_run_id", path), html_url: str(o, "html_url", path) };
}

/**
 * workflow_dispatch でワークフローを実行する。入力値は文字列で送る（GitHub の画面と同じ）。
 * return_run_details を付けて、作られた実行の ID を受け取る。返らなかったとき（204）は null
 */
export async function dispatchWorkflow(
  http: GitHubHttp,
  repo: RepoPath,
  workflowId: number,
  ref: string,
  inputs: Record<string, string>,
  call: Call = {},
): Promise<GitHubDispatchedRun | null> {
  const response = await http.request(`${repoPath(repo)}/actions/workflows/${workflowId}/dispatches`, {
    ...call,
    method: "POST",
    body: { ref, inputs, return_run_details: true },
  });
  if (response.status === 204) return null;
  const text = await response.text();
  if (text.trim() === "") return null;
  return decode(() => readDispatchedRun(JSON.parse(text)));
}

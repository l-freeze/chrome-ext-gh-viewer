// API レスポンス（unknown）を検証してドメイン型へ変換する。
// 必須フィールドが欠けていたり型が違ったりしたら DecodeError を投げる。

import { DecodeError } from "./errors";
import type {
  AccessToken,
  Artifact,
  DeviceCode,
  Issue,
  IssueState,
  Label,
  Owner,
  RepoRef,
  Repository,
  UserRef,
  ActionsCache,
  Workflow,
  WorkflowRun,
  WorkflowRunRef,
} from "./types";

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new DecodeError(path, "object", v);
  return v as Obj;
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new DecodeError(path, "array", v);
  return v;
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new DecodeError(`${path}.${key}`, "string", v);
  return v;
}

function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new DecodeError(`${path}.${key}`, "number", v);
  return v;
}

function bool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") throw new DecodeError(`${path}.${key}`, "boolean", v);
  return v;
}

/** null / undefined を許す文字列 */
function optStr(o: Obj, key: string, path: string): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new DecodeError(`${path}.${key}`, "string | null", v);
  return v;
}

function optNum(o: Obj, key: string, path: string): number | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new DecodeError(`${path}.${key}`, "number | null", v);
  return v;
}

export function decodeArrayOf<T>(v: unknown, path: string, item: (v: unknown, path: string) => T): T[] {
  return arr(v, path).map((x, i) => item(x, `${path}[${i}]`));
}

export function decodeOwner(v: unknown, path = "owner"): Owner {
  const o = obj(v, path);
  const type = optStr(o, "type", path);
  return {
    login: str(o, "login", path),
    id: num(o, "id", path),
    // Bot などは User 扱いにする。/user/orgs の要素は type を持たないので呼び出し側で上書きする。
    type: type === "Organization" ? "Organization" : "User",
    avatarUrl: str(o, "avatar_url", path),
  };
}

export function decodeOrganization(v: unknown, path = "org"): Owner {
  return { ...decodeOwner(v, path), type: "Organization" };
}

function decodeUserRef(v: unknown, path: string): UserRef {
  const o = obj(v, path);
  return { login: str(o, "login", path), avatarUrl: str(o, "avatar_url", path) };
}

export function decodeRepository(v: unknown, path = "repo"): Repository {
  const o = obj(v, path);
  return {
    id: num(o, "id", path),
    owner: decodeOwner(o["owner"], `${path}.owner`),
    name: str(o, "name", path),
    fullName: str(o, "full_name", path),
    private: bool(o, "private", path),
    archived: bool(o, "archived", path),
    htmlUrl: str(o, "html_url", path),
    pushedAt: optStr(o, "pushed_at", path),
    defaultBranch: optStr(o, "default_branch", path),
  };
}

function decodeWorkflowRun(v: unknown, path: string): WorkflowRunRef | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  return {
    id: optNum(o, "id", path),
    headBranch: optStr(o, "head_branch", path),
    headSha: optStr(o, "head_sha", path),
  };
}

export function decodeArtifact(v: unknown, repo: RepoRef, path = "artifact"): Artifact {
  const o = obj(v, path);
  return {
    id: num(o, "id", path),
    repo,
    name: str(o, "name", path),
    sizeInBytes: num(o, "size_in_bytes", path),
    expired: bool(o, "expired", path),
    createdAt: optStr(o, "created_at", path),
    expiresAt: optStr(o, "expires_at", path),
    updatedAt: optStr(o, "updated_at", path),
    digest: optStr(o, "digest", path),
    workflowRun: decodeWorkflowRun(o["workflow_run"], `${path}.workflow_run`),
  };
}

export function decodeArtifactPage(v: unknown, repo: RepoRef): { totalCount: number; artifacts: Artifact[] } {
  const o = obj(v, "artifacts");
  return {
    totalCount: num(o, "total_count", "artifacts"),
    artifacts: decodeArrayOf(o["artifacts"], "artifacts.artifacts", (x, p) => decodeArtifact(x, repo, p)),
  };
}

function decodeLabel(v: unknown, path: string): Label {
  // labels は文字列だけの形で返ることもある
  if (typeof v === "string") return { name: v, color: null, description: null };
  const o = obj(v, path);
  return { name: str(o, "name", path), color: optStr(o, "color", path), description: optStr(o, "description", path) };
}

const REPO_URL_RE = /\/repos\/([^/]+)\/([^/]+)\/?$/;

/** repository_url（https://api.github.com/repos/{owner}/{repo}）から所有者とリポジトリ名を取り出す */
export function parseRepositoryUrl(url: string, path = "repository_url"): RepoRef {
  const m = REPO_URL_RE.exec(url);
  if (!m || m[1] === undefined || m[2] === undefined) throw new DecodeError(path, "repository API URL", url);
  return { owner: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) };
}

/** PR が混ざっていたら null を返す */
export function decodeIssue(v: unknown, path = "issue"): Issue | null {
  const o = obj(v, path);
  if (o["pull_request"] !== undefined && o["pull_request"] !== null) return null;
  const state = str(o, "state", path);
  if (state !== "open" && state !== "closed") throw new DecodeError(`${path}.state`, '"open" | "closed"', state);
  const user = o["user"];
  const assignees = o["assignees"];
  return {
    id: num(o, "id", path),
    number: num(o, "number", path),
    repo: parseRepositoryUrl(str(o, "repository_url", path), `${path}.repository_url`),
    title: str(o, "title", path),
    state: state satisfies IssueState,
    stateReason: optStr(o, "state_reason", path),
    htmlUrl: str(o, "html_url", path),
    author: user === null || user === undefined ? null : decodeUserRef(user, `${path}.user`),
    labels: decodeArrayOf(o["labels"], `${path}.labels`, decodeLabel),
    assignees:
      assignees === null || assignees === undefined ? [] : decodeArrayOf(assignees, `${path}.assignees`, decodeUserRef),
    comments: num(o, "comments", path),
    createdAt: str(o, "created_at", path),
    updatedAt: str(o, "updated_at", path),
    closedAt: optStr(o, "closed_at", path),
  };
}

export function decodeIssueSearchPage(v: unknown): { totalCount: number; incomplete: boolean; issues: Issue[] } {
  const o = obj(v, "search");
  const issues = decodeArrayOf(o["items"], "search.items", decodeIssue).filter((x): x is Issue => x !== null);
  return { totalCount: num(o, "total_count", "search"), incomplete: bool(o, "incomplete_results", "search"), issues };
}

export function decodeDeviceCode(v: unknown): DeviceCode {
  const o = obj(v, "device_code");
  return {
    deviceCode: str(o, "device_code", "device_code"),
    userCode: str(o, "user_code", "device_code"),
    verificationUri: str(o, "verification_uri", "device_code"),
    expiresIn: num(o, "expires_in", "device_code"),
    interval: num(o, "interval", "device_code"),
  };
}

export type AccessTokenPollResult =
  | { ok: true; token: AccessToken }
  | { ok: false; error: string; description: string | null; interval: number | null };

export function decodeAccessTokenResponse(v: unknown): AccessTokenPollResult {
  const o = obj(v, "access_token");
  if (typeof o["access_token"] === "string") {
    const scope = optStr(o, "scope", "access_token") ?? "";
    return {
      ok: true,
      token: {
        accessToken: o["access_token"],
        tokenType: str(o, "token_type", "access_token"),
        scopes: splitScopes(scope),
      },
    };
  }
  return {
    ok: false,
    error: str(o, "error", "access_token"),
    description: optStr(o, "error_description", "access_token"),
    interval: optNum(o, "interval", "access_token"),
  };
}

/** "repo, read:org" や "repo,read:org" をスコープの配列にする */
export function splitScopes(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function decodeWorkflow(v: unknown, repo: RepoRef, path = "workflow"): Workflow {
  const o = obj(v, path);
  return {
    id: num(o, "id", path),
    repo,
    name: str(o, "name", path),
    path: str(o, "path", path),
    state: str(o, "state", path),
    htmlUrl: str(o, "html_url", path),
  };
}

export function decodeWorkflowPage(v: unknown, repo: RepoRef): Workflow[] {
  const o = obj(v, "workflows");
  return decodeArrayOf(o["workflows"], "workflows.workflows", (x, p) => decodeWorkflow(x, repo, p));
}

export function decodeRun(v: unknown, repo: RepoRef, path = "run"): WorkflowRun {
  const o = obj(v, path);
  const actor = o["actor"];
  return {
    id: num(o, "id", path),
    workflowId: num(o, "workflow_id", path),
    repo,
    name: optStr(o, "name", path),
    displayTitle: optStr(o, "display_title", path),
    runNumber: num(o, "run_number", path),
    status: optStr(o, "status", path),
    conclusion: optStr(o, "conclusion", path),
    event: str(o, "event", path),
    headBranch: optStr(o, "head_branch", path),
    actor: actor === null || actor === undefined ? null : decodeUserRef(actor, `${path}.actor`),
    createdAt: str(o, "created_at", path),
    updatedAt: str(o, "updated_at", path),
    htmlUrl: str(o, "html_url", path),
  };
}

export function decodeWorkflowRunPage(v: unknown, repo: RepoRef): WorkflowRun[] {
  const o = obj(v, "runs");
  return decodeArrayOf(o["workflow_runs"], "runs.workflow_runs", (x, p) => decodeRun(x, repo, p));
}

/** ブランチ一覧の要素から名前だけを取り出す */
export function decodeBranchNames(v: unknown): string[] {
  return decodeArrayOf(v, "branches", (x, p) => str(obj(x, p), "name", p));
}

export function decodeEnvironmentNames(v: unknown): string[] {
  const o = obj(v, "environments");
  return decodeArrayOf(o["environments"], "environments.environments", (x, p) => str(obj(x, p), "name", p));
}

export function decodeCache(v: unknown, repo: RepoRef, path = "cache"): ActionsCache {
  const o = obj(v, path);
  return {
    id: num(o, "id", path),
    repo,
    ref: str(o, "ref", path),
    key: str(o, "key", path),
    version: optStr(o, "version", path),
    sizeInBytes: num(o, "size_in_bytes", path),
    lastAccessedAt: optStr(o, "last_accessed_at", path),
    createdAt: optStr(o, "created_at", path),
  };
}

export function decodeCachePage(v: unknown, repo: RepoRef): ActionsCache[] {
  const o = obj(v, "caches");
  return decodeArrayOf(o["actions_caches"], "caches.actions_caches", (x, p) => decodeCache(x, repo, p));
}

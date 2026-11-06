// Actions の Secrets と Variables: リポジトリ単位と Environment 単位の一覧（閲覧のみ）。
// Secrets は値を返さない（名前と日時だけ）。Variables は値も返す。

import { arrayOf, obj, str } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, repoPath, type GitHubHttp, type RepoPath } from "./http";

/** Variables の一覧は 1 ページ 30 件まで */
export const VARIABLES_PER_PAGE = 30;

export interface GitHubSecret {
  name: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubVariable extends GitHubSecret {
  value: string;
}

interface Call {
  signal?: AbortSignal;
}

export function readSecret(v: unknown, path = "secret"): GitHubSecret {
  const o = obj(v, path);
  return { name: str(o, "name", path), created_at: str(o, "created_at", path), updated_at: str(o, "updated_at", path) };
}

export function readVariable(v: unknown, path = "variable"): GitHubVariable {
  const o = obj(v, path);
  return { ...readSecret(v, path), value: str(o, "value", path) };
}

const envPath = (repo: RepoPath, environment: string) => `${repoPath(repo)}/environments/${encodeURIComponent(environment)}`;

async function collect<T>(http: GitHubHttp, path: string, key: string, perPage: number, read: (v: unknown, p: string) => T, call: Call): Promise<T[]> {
  const items: T[] = [];
  for await (const page of http.paginate(path, { ...call, query: { per_page: perPage } })) {
    items.push(...decode(() => arrayOf(obj(page, key)[key], `${key}.${key}`, read)));
  }
  return items;
}

export function listRepoSecrets(http: GitHubHttp, repo: RepoPath, call: Call = {}): Promise<GitHubSecret[]> {
  return collect(http, `${repoPath(repo)}/actions/secrets`, "secrets", PER_PAGE, readSecret, call);
}

export function listRepoVariables(http: GitHubHttp, repo: RepoPath, call: Call = {}): Promise<GitHubVariable[]> {
  return collect(http, `${repoPath(repo)}/actions/variables`, "variables", VARIABLES_PER_PAGE, readVariable, call);
}

export function listEnvironmentSecrets(http: GitHubHttp, repo: RepoPath, environment: string, call: Call = {}): Promise<GitHubSecret[]> {
  return collect(http, `${envPath(repo, environment)}/secrets`, "secrets", PER_PAGE, readSecret, call);
}

export function listEnvironmentVariables(http: GitHubHttp, repo: RepoPath, environment: string, call: Call = {}): Promise<GitHubVariable[]> {
  return collect(http, `${envPath(repo, environment)}/variables`, "variables", VARIABLES_PER_PAGE, readVariable, call);
}

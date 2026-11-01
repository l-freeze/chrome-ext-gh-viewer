// Actions のキャッシュ: 一覧・削除。

import { arrayOf, num, obj, optStr, str } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, repoPath, type GitHubHttp, type RepoPath } from "./http";

export interface GitHubCache {
  id: number;
  /** refs/heads/main、refs/pull/12/merge など */
  ref: string;
  key: string;
  version: string | null;
  size_in_bytes: number;
  last_accessed_at: string | null;
  created_at: string | null;
}

interface Call {
  signal?: AbortSignal;
}

export function readCache(v: unknown, path = "cache"): GitHubCache {
  const o = obj(v, path);
  return {
    id: num(o, "id", path),
    ref: str(o, "ref", path),
    key: str(o, "key", path),
    version: optStr(o, "version", path),
    size_in_bytes: num(o, "size_in_bytes", path),
    last_accessed_at: optStr(o, "last_accessed_at", path),
    created_at: optStr(o, "created_at", path),
  };
}

/** 最後に使われた新しい順に全部取得する */
export async function listCaches(http: GitHubHttp, repo: RepoPath, call: Call = {}): Promise<GitHubCache[]> {
  const caches: GitHubCache[] = [];
  const query = { per_page: PER_PAGE, sort: "last_accessed_at", direction: "desc" };
  for await (const page of http.paginate(`${repoPath(repo)}/actions/caches`, { ...call, query })) {
    caches.push(...decode(() => arrayOf(obj(page, "caches")["actions_caches"], "caches.actions_caches", readCache)));
  }
  return caches;
}

export async function deleteCache(http: GitHubHttp, repo: RepoPath, id: number, call: Call = {}): Promise<void> {
  await http.request(`${repoPath(repo)}/actions/caches/${id}`, { ...call, method: "DELETE" });
}

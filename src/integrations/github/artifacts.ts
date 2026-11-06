// Actions のアーティファクト: 一覧・削除・ZIP の取得先。

import { arrayOf, bool, num, obj, optNum, optStr, str } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, repoPath, type GitHubHttp, type RepoPath } from "./http";

export interface GitHubArtifact {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  created_at: string | null;
  expires_at: string | null;
  updated_at: string | null;
  digest: string | null;
  workflow_run: { id: number | null; head_branch: string | null; head_sha: string | null } | null;
}

interface Call {
  signal?: AbortSignal;
}

export function readArtifact(v: unknown, path = "artifact"): GitHubArtifact {
  const o = obj(v, path);
  const run = o["workflow_run"];
  const r = run === null || run === undefined ? null : obj(run, `${path}.workflow_run`);
  return {
    id: num(o, "id", path),
    name: str(o, "name", path),
    size_in_bytes: num(o, "size_in_bytes", path),
    expired: bool(o, "expired", path),
    created_at: optStr(o, "created_at", path),
    expires_at: optStr(o, "expires_at", path),
    updated_at: optStr(o, "updated_at", path),
    digest: optStr(o, "digest", path),
    workflow_run: r && {
      id: optNum(r, "id", `${path}.workflow_run`),
      head_branch: optStr(r, "head_branch", `${path}.workflow_run`),
      head_sha: optStr(r, "head_sha", `${path}.workflow_run`),
    },
  };
}

export async function listArtifacts(http: GitHubHttp, repo: RepoPath, call: Call = {}): Promise<GitHubArtifact[]> {
  const artifacts: GitHubArtifact[] = [];
  for await (const page of http.paginate(`${repoPath(repo)}/actions/artifacts`, { ...call, query: { per_page: PER_PAGE } })) {
    artifacts.push(...decode(() => arrayOf(obj(page, "artifacts")["artifacts"], "artifacts.artifacts", readArtifact)));
  }
  return artifacts;
}

export async function deleteArtifact(http: GitHubHttp, repo: RepoPath, id: number, call: Call = {}): Promise<void> {
  await http.request(`${repoPath(repo)}/actions/artifacts/${id}`, { ...call, method: "DELETE" });
}

/**
 * ZIP を取得するための URL とヘッダー。この URL は署名付きのストレージ URL へリダイレクトする。
 * ブラウザのダウンロード機能に渡す想定
 */
export function artifactDownloadUrl(http: GitHubHttp, repo: RepoPath, id: number): Promise<string> {
  return http.downloadUrl(`${repoPath(repo)}/actions/artifacts/${id}/zip`, "application/vnd.github+json");
}

// Releases: 一覧と、添付ファイルのダウンロード（閲覧のみ）。

import { arrayOf, bool, num, obj, optStr, str } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, repoPath, type GitHubHttp, type RepoPath } from "./http";

export interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  download_count: number;
  content_type: string | null;
  updated_at: string;
}

export interface GitHubRelease {
  id: number;
  name: string | null;
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  /** 下書きでは null */
  published_at: string | null;
  html_url: string;
  author: { login: string; avatar_url: string } | null;
  assets: GitHubReleaseAsset[];
}

interface Call {
  signal?: AbortSignal;
}

export function readReleaseAsset(v: unknown, path = "asset"): GitHubReleaseAsset {
  const o = obj(v, path);
  return {
    id: num(o, "id", path),
    name: str(o, "name", path),
    size: num(o, "size", path),
    download_count: num(o, "download_count", path),
    content_type: optStr(o, "content_type", path),
    updated_at: str(o, "updated_at", path),
  };
}

export function readRelease(v: unknown, path = "release"): GitHubRelease {
  const o = obj(v, path);
  const author = o["author"];
  const a = author === null || author === undefined ? null : obj(author, `${path}.author`);
  return {
    id: num(o, "id", path),
    name: optStr(o, "name", path),
    tag_name: str(o, "tag_name", path),
    draft: bool(o, "draft", path),
    prerelease: bool(o, "prerelease", path),
    created_at: str(o, "created_at", path),
    published_at: optStr(o, "published_at", path),
    html_url: str(o, "html_url", path),
    author: a && { login: str(a, "login", `${path}.author`), avatar_url: str(a, "avatar_url", `${path}.author`) },
    assets: arrayOf(o["assets"], `${path}.assets`, readReleaseAsset),
  };
}

/** 新しい順に 1 ページ分（最大 100 件）。1 回の呼び出しで済ませるため、それより古いものは取らない */
export async function listReleases(http: GitHubHttp, repo: RepoPath, call: Call = {}): Promise<GitHubRelease[]> {
  const { data } = await http.json(`${repoPath(repo)}/releases`, { ...call, query: { per_page: PER_PAGE } });
  return decode(() => arrayOf(data, "releases", readRelease));
}

/**
 * 添付ファイルの署名つきの URL。API の URL に application/octet-stream を求めると、
 * GitHub が保存先へ転送する（private リポジトリのファイルも、トークンを保存先へ渡さずに落とせる）
 */
export function releaseAssetDownloadUrl(http: GitHubHttp, repo: RepoPath, assetId: number): Promise<string> {
  return http.downloadUrl(`${repoPath(repo)}/releases/assets/${assetId}`, "application/octet-stream");
}

import type { GitHubHttp } from "../../../integrations/github/http";
import { listReleases, releaseAssetDownloadUrl, type GitHubRelease } from "../../../integrations/github/releases";
import type { RepoRef } from "../../workspace/repository";
import type { Release } from "../release";
import type { ReleaseSource } from "../ports";

export function toRelease(r: GitHubRelease, repo: RepoRef): Release {
  return {
    id: r.id,
    repo,
    title: r.name?.trim() || r.tag_name,
    tag: r.tag_name,
    draft: r.draft,
    prerelease: r.prerelease,
    date: r.published_at ?? r.created_at,
    htmlUrl: r.html_url,
    author: r.author && { login: r.author.login, avatarUrl: r.author.avatar_url },
    assets: r.assets.map((a) => ({ id: a.id, repo, name: a.name, sizeInBytes: a.size, downloadCount: a.download_count, updatedAt: a.updated_at })),
  };
}

export function createGitHubReleaseSource(httpFor: (repo: RepoRef) => GitHubHttp): ReleaseSource {
  return {
    list: async (repo, signal) => (await listReleases(httpFor(repo), repo, signal ? { signal } : {})).map((r) => toRelease(r, repo)),
    downloadUrl: (asset) => releaseAssetDownloadUrl(httpFor(asset.repo), asset.repo, asset.id),
  };
}

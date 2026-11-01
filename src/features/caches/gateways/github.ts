import { deleteCache, listCaches, type GitHubCache } from "../../../integrations/github/caches";
import { isGitHubApiError } from "../../../integrations/github/errors";
import type { GitHubHttp } from "../../../integrations/github/http";
import type { RepoRef } from "../../workspace/repository";
import type { ActionsCache } from "../cache";
import type { CacheSource } from "../ports";

export function toCache(c: GitHubCache, repo: RepoRef): ActionsCache {
  return {
    id: c.id,
    repo,
    ref: c.ref,
    key: c.key,
    version: c.version,
    sizeInBytes: c.size_in_bytes,
    lastAccessedAt: c.last_accessed_at,
    createdAt: c.created_at,
  };
}

export function createGitHubCacheSource(httpFor: (repo: RepoRef) => GitHubHttp): CacheSource {
  return {
    async list(repo, signal) {
      return (await listCaches(httpFor(repo), repo, signal ? { signal } : {})).map((c) => toCache(c, repo));
    },
    async remove(item, signal) {
      try {
        await deleteCache(httpFor(item.repo), item.repo, item.id, signal ? { signal } : {});
      } catch (e) {
        if (!isGitHubApiError(e, "not_found")) throw e;
      }
    },
  };
}

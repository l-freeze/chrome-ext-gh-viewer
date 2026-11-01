// キャッシュ一覧の絞り込み・並べ替え・集計。

import { sortBy, type SortDirection, type SortState } from "../../lib/sort";
import { repoKey, usageByRepo, type RepoUsage } from "../workspace/repository";
import { daysSinceUsed, isPullRequestRef, refLabel, UNUSED_DAYS, type ActionsCache } from "./cache";

export interface CacheFilter {
  repoQuery: string;
  /** ref（ブランチ名・PR 番号など）の部分一致 */
  refQuery: string;
  /** 最後に使われてからこの日数より経ったものだけ */
  unusedForDays: number | null;
  minSizeMB: number | null;
}

export const DEFAULT_CACHE_FILTER: CacheFilter = { repoQuery: "", refQuery: "", unusedForDays: null, minSizeMB: null };

export type CacheSortKey = "key" | "repo" | "ref" | "size" | "lastUsed" | "created";
export type CacheSort = SortState<CacheSortKey>;

export const DEFAULT_CACHE_SORT: CacheSort = { key: "size", dir: "desc" };

export function defaultCacheSortDir(key: CacheSortKey): SortDirection {
  return key === "key" || key === "repo" || key === "ref" ? "asc" : "desc";
}

export function filterCaches(list: readonly ActionsCache[], filter: CacheFilter, nowMs: number): ActionsCache[] {
  const repoQ = filter.repoQuery.trim().toLowerCase();
  const refQ = filter.refQuery.trim().toLowerCase();
  const minBytes = filter.minSizeMB === null ? null : filter.minSizeMB * 1024 * 1024;
  return list.filter((c) => {
    if (repoQ && !repoKey(c.repo).toLowerCase().includes(repoQ)) return false;
    if (refQ && !`${c.ref}\n${refLabel(c.ref)}`.toLowerCase().includes(refQ)) return false;
    if (filter.unusedForDays !== null) {
      const days = daysSinceUsed(c, nowMs);
      if (days === null || days <= filter.unusedForDays) return false;
    }
    if (minBytes !== null && c.sizeInBytes < minBytes) return false;
    return true;
  });
}

export function sortCaches(list: readonly ActionsCache[], sort: CacheSort): ActionsCache[] {
  const value = (c: ActionsCache): string | number | null => {
    switch (sort.key) {
      case "key":
        return c.key;
      case "repo":
        return repoKey(c.repo);
      case "ref":
        return refLabel(c.ref);
      case "size":
        return c.sizeInBytes;
      case "lastUsed":
        return c.lastAccessedAt === null ? null : Date.parse(c.lastAccessedAt);
      case "created":
        return c.createdAt === null ? null : Date.parse(c.createdAt);
    }
  };
  return sortBy(list, value, sort.dir, (a, b) => a.id - b.id);
}

export interface CacheSummary {
  totalBytes: number;
  count: number;
  repos: number;
  /** PR の ref のキャッシュ（PR が閉じたあとも残りがち） */
  pullRequest: ActionsCache[];
  pullRequestBytes: number;
  /** UNUSED_DAYS より長く使われていないもの */
  unused: ActionsCache[];
  unusedBytes: number;
  byRepo: RepoUsage[];
}

export function summarizeCaches(list: readonly ActionsCache[], nowMs: number): CacheSummary {
  const pullRequest = list.filter((c) => isPullRequestRef(c.ref));
  const unused = list.filter((c) => {
    const days = daysSinceUsed(c, nowMs);
    return days !== null && days > UNUSED_DAYS;
  });
  const sum = (xs: readonly ActionsCache[]) => xs.reduce((s, c) => s + c.sizeInBytes, 0);
  const byRepo = usageByRepo(list, (c) => c.repo, (c) => c.sizeInBytes);
  return {
    totalBytes: sum(list),
    count: list.length,
    repos: byRepo.length,
    pullRequest,
    pullRequestBytes: sum(pullRequest),
    unused,
    unusedBytes: sum(unused),
    byRepo,
  };
}

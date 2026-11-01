// Actions キャッシュの絞り込み・並べ替え・集計。

import type { ActionsCache } from "../api/types";
import { repoKey, type RepoUsage, type SortDirection } from "./artifacts";
import { DAY_MS } from "./format";

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

export interface CacheSort {
  key: CacheSortKey;
  dir: SortDirection;
}

export const DEFAULT_CACHE_SORT: CacheSort = { key: "size", dir: "desc" };

/** しばらく使われていないとみなす日数（GitHub は 7 日使われないキャッシュを自動で消す） */
export const UNUSED_DAYS = 3;

export function isPullRequestRef(ref: string): boolean {
  return ref.startsWith("refs/pull/");
}

/** refs/heads/main → main、refs/pull/12/merge → PR #12、refs/tags/v1 → v1 */
export function refLabel(ref: string): string {
  const pr = /^refs\/pull\/(\d+)\//.exec(ref);
  if (pr) return `PR #${pr[1]}`;
  return ref.replace(/^refs\/(heads|tags)\//, "");
}

/** 最後に使われてからの日数。不明なら null */
export function daysSinceUsed(c: ActionsCache, nowMs: number): number | null {
  const at = c.lastAccessedAt ?? c.createdAt;
  return at === null ? null : Math.floor((nowMs - Date.parse(at)) / DAY_MS);
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
  const sign = sort.dir === "asc" ? 1 : -1;
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
  return [...list].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    // 値のないものは向きにかかわらず末尾
    if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0) || a.id - b.id;
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return c * sign || a.id - b.id;
  });
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
  const usage = new Map<string, RepoUsage>();
  const pullRequest: ActionsCache[] = [];
  const unused: ActionsCache[] = [];
  let totalBytes = 0;
  for (const c of list) {
    totalBytes += c.sizeInBytes;
    const key = repoKey(c.repo);
    const u = usage.get(key) ?? { repo: c.repo, key, bytes: 0, count: 0 };
    u.bytes += c.sizeInBytes;
    u.count++;
    usage.set(key, u);
    if (isPullRequestRef(c.ref)) pullRequest.push(c);
    const days = daysSinceUsed(c, nowMs);
    if (days !== null && days > UNUSED_DAYS) unused.push(c);
  }
  const sum = (xs: ActionsCache[]) => xs.reduce((s, c) => s + c.sizeInBytes, 0);
  return {
    totalBytes,
    count: list.length,
    repos: usage.size,
    pullRequest,
    pullRequestBytes: sum(pullRequest),
    unused,
    unusedBytes: sum(unused),
    byRepo: [...usage.values()].sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key)),
  };
}

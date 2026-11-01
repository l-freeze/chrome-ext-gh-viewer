// アーティファクト一覧の絞り込み・並べ替え・集計。

import { sortBy, type SortDirection, type SortState } from "../../lib/sort";
import { repoKey, usageByRepo, type RepoUsage } from "../workspace/repository";
import { ageDays, expiryState, isExpired, type Artifact } from "./artifact";

export type ArtifactStatusFilter = "all" | "active" | "expired";

export interface ArtifactFilter {
  /** リポジトリ名（owner/name）の部分一致 */
  repoQuery: string;
  /** 作成からこの日数より古いものだけ */
  olderThanDays: number | null;
  /** このサイズ（MB）以上のものだけ */
  minSizeMB: number | null;
  status: ArtifactStatusFilter;
}

export const DEFAULT_ARTIFACT_FILTER: ArtifactFilter = { repoQuery: "", olderThanDays: null, minSizeMB: null, status: "all" };

export type ArtifactSortKey = "name" | "repo" | "branch" | "size" | "created" | "expires";
export type ArtifactSort = SortState<ArtifactSortKey>;

export const DEFAULT_ARTIFACT_SORT: ArtifactSort = { key: "created", dir: "desc" };

/** 文字の列は昇順、数値・日付の列は降順から始める */
export function defaultArtifactSortDir(key: ArtifactSortKey): SortDirection {
  return key === "name" || key === "repo" || key === "branch" ? "asc" : "desc";
}

/** 古いものを選ぶ基準の日数 */
export const STALE_DAYS = 30;
/** 期限切れが近いとみなす日数 */
export const EXPIRING_SOON_DAYS = 7;

export function filterArtifacts(list: readonly Artifact[], filter: ArtifactFilter, nowMs: number): Artifact[] {
  const q = filter.repoQuery.trim().toLowerCase();
  const minBytes = filter.minSizeMB === null ? null : filter.minSizeMB * 1024 * 1024;
  return list.filter((a) => {
    if (q && !repoKey(a.repo).toLowerCase().includes(q)) return false;
    if (filter.olderThanDays !== null) {
      const age = ageDays(a, nowMs);
      if (age === null || age <= filter.olderThanDays) return false;
    }
    if (minBytes !== null && a.sizeInBytes < minBytes) return false;
    if (filter.status === "active" && isExpired(a, nowMs)) return false;
    if (filter.status === "expired" && !isExpired(a, nowMs)) return false;
    return true;
  });
}

export function sortArtifacts(list: readonly Artifact[], sort: ArtifactSort): Artifact[] {
  const value = (a: Artifact): string | number | null => {
    switch (sort.key) {
      case "name":
        return a.name;
      case "repo":
        return repoKey(a.repo);
      case "branch":
        return a.workflowRun?.headBranch ?? null;
      case "size":
        return a.sizeInBytes;
      case "created":
        return a.createdAt === null ? null : Date.parse(a.createdAt);
      case "expires":
        return a.expiresAt === null ? null : Date.parse(a.expiresAt);
    }
  };
  return sortBy(list, value, sort.dir, (a, b) => a.id - b.id);
}

export interface ArtifactSummary {
  /** 有効（期限切れでない）アーティファクトの合計サイズ */
  liveBytes: number;
  liveCount: number;
  expiredCount: number;
  /** アーティファクトが 1 件以上あるリポジトリの数 */
  reposWithArtifacts: number;
  /** STALE_DAYS より古い有効なアーティファクト（サイズの大きい順） */
  stale: Artifact[];
  staleBytes: number;
  expiringSoon: Artifact[];
  /** 有効なアーティファクトのリポジトリ別合計（大きい順） */
  byRepo: RepoUsage[];
}

export function summarizeArtifacts(list: readonly Artifact[], nowMs: number, staleDays = STALE_DAYS): ArtifactSummary {
  const live = list.filter((a) => !isExpired(a, nowMs));
  const stale = live
    .filter((a) => {
      const age = ageDays(a, nowMs);
      return age !== null && age > staleDays;
    })
    .sort((a, b) => b.sizeInBytes - a.sizeInBytes || a.id - b.id);
  const expiringSoon = live.filter((a) => {
    const e = expiryState(a, nowMs);
    return e.kind === "today" || e.kind === "tomorrow" || (e.kind === "days" && e.days < EXPIRING_SOON_DAYS);
  });
  const sum = (xs: readonly Artifact[]) => xs.reduce((s, a) => s + a.sizeInBytes, 0);
  return {
    liveBytes: sum(live),
    liveCount: live.length,
    expiredCount: list.length - live.length,
    reposWithArtifacts: new Set(list.map((a) => repoKey(a.repo))).size,
    stale,
    staleBytes: sum(stale),
    expiringSoon,
    byRepo: usageByRepo(live, (a) => a.repo, (a) => a.sizeInBytes),
  };
}

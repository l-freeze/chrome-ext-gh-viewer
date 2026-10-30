// アーティファクト一覧の絞り込み・並べ替え・集計。画面にも API にも依存しない純粋な処理。

import type { Artifact, RepoRef } from "../api/types";
import { DAY_MS } from "./format";

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

export const DEFAULT_ARTIFACT_FILTER: ArtifactFilter = {
  repoQuery: "",
  olderThanDays: null,
  minSizeMB: null,
  status: "all",
};

export type ArtifactSortKey = "name" | "repo" | "branch" | "size" | "created" | "expires";
export type SortDirection = "asc" | "desc";

export interface ArtifactSort {
  key: ArtifactSortKey;
  dir: SortDirection;
}

export const DEFAULT_ARTIFACT_SORT: ArtifactSort = { key: "created", dir: "desc" };

/** 古いものを選ぶ基準の日数 */
export const STALE_DAYS = 30;
/** 期限切れが近いとみなす日数 */
export const EXPIRING_SOON_DAYS = 7;

export function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

/** 期限切れか（API の expired フラグか、期限を過ぎているか） */
export function isExpired(a: Artifact, nowMs: number): boolean {
  if (a.expired) return true;
  if (a.expiresAt === null) return false;
  return Date.parse(a.expiresAt) <= nowMs;
}

/** 作成からの経過日数。作成日が不明なら null */
export function ageDays(a: Artifact, nowMs: number): number | null {
  if (a.createdAt === null) return null;
  return Math.floor((nowMs - Date.parse(a.createdAt)) / DAY_MS);
}

export type ExpiryState =
  | { kind: "expired" }
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "days"; days: number }
  | { kind: "unknown" };

/** ローカル時刻の暦日の通し番号（日付の差を数えるため） */
function localDay(ms: number): number {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** 期限までの残り。表示する日付と食い違わないよう、24 時間単位ではなく暦日で数える */
export function expiryState(a: Artifact, nowMs: number): ExpiryState {
  if (isExpired(a, nowMs)) return { kind: "expired" };
  if (a.expiresAt === null) return { kind: "unknown" };
  const days = localDay(Date.parse(a.expiresAt)) - localDay(nowMs);
  if (days <= 0) return { kind: "today" };
  if (days === 1) return { kind: "tomorrow" };
  return { kind: "days", days };
}

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

function compareNullable<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number): number {
  // 値のないものは並び順にかかわらず末尾に置く
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return cmp(a, b);
}

const byString = (x: string, y: string) => x.localeCompare(y);
const byNumber = (x: number, y: number) => x - y;

export function sortArtifacts(list: readonly Artifact[], sort: ArtifactSort): Artifact[] {
  const sign = sort.dir === "asc" ? 1 : -1;
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
  return [...list].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) return compareNullable(va, vb, () => 0) || a.id - b.id;
    const c = typeof va === "number" && typeof vb === "number" ? byNumber(va, vb) : byString(String(va), String(vb));
    return c * sign || a.id - b.id;
  });
}

export interface RepoUsage {
  repo: RepoRef;
  key: string;
  bytes: number;
  count: number;
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
  let liveBytes = 0;
  let liveCount = 0;
  let expiredCount = 0;
  const stale: Artifact[] = [];
  const expiringSoon: Artifact[] = [];
  const repos = new Set<string>();
  const usage = new Map<string, RepoUsage>();

  for (const a of list) {
    const key = repoKey(a.repo);
    repos.add(key);
    if (isExpired(a, nowMs)) {
      expiredCount++;
      continue;
    }
    liveCount++;
    liveBytes += a.sizeInBytes;
    const u = usage.get(key) ?? { repo: a.repo, key, bytes: 0, count: 0 };
    u.bytes += a.sizeInBytes;
    u.count++;
    usage.set(key, u);
    const age = ageDays(a, nowMs);
    if (age !== null && age > staleDays) stale.push(a);
    const e = expiryState(a, nowMs);
    if (e.kind === "today" || e.kind === "tomorrow" || (e.kind === "days" && e.days < EXPIRING_SOON_DAYS)) {
      expiringSoon.push(a);
    }
  }

  stale.sort((a, b) => b.sizeInBytes - a.sizeInBytes || a.id - b.id);
  return {
    liveBytes,
    liveCount,
    expiredCount,
    reposWithArtifacts: repos.size,
    stale,
    staleBytes: stale.reduce((s, a) => s + a.sizeInBytes, 0),
    expiringSoon,
    byRepo: [...usage.values()].sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key)),
  };
}

export interface SelectionSummary {
  count: number;
  bytes: number;
  repoCount: number;
}

export function summarizeSelection(selected: readonly Artifact[]): SelectionSummary {
  return {
    count: selected.length,
    bytes: selected.reduce((s, a) => s + a.sizeInBytes, 0),
    repoCount: new Set(selected.map((a) => repoKey(a.repo))).size,
  };
}

/** ダウンロード時のファイル名（owner-repo-name-id.zip）。ファイル名に使えない文字は _ にする */
export function downloadFilename(a: Artifact): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_");
  return `${safe(a.repo.owner)}-${safe(a.repo.name)}-${safe(a.name)}-${a.id}.zip`;
}

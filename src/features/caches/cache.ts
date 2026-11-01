// Actions のキャッシュ。

import { elapsedDays } from "../../lib/time";
import type { RepoRef } from "../workspace/repository";

export interface ActionsCache {
  id: number;
  repo: RepoRef;
  /** refs/heads/main、refs/pull/12/merge など */
  ref: string;
  key: string;
  version: string | null;
  sizeInBytes: number;
  lastAccessedAt: string | null;
  createdAt: string | null;
}

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
  return elapsedDays(c.lastAccessedAt ?? c.createdAt, nowMs);
}

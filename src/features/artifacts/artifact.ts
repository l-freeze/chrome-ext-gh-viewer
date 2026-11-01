// Actions のアーティファクトと、その期限の判定。

import { elapsedDays, localDay } from "../../lib/time";
import type { RepoRef } from "../workspace/repository";

export interface Artifact {
  id: number;
  repo: RepoRef;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  createdAt: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  digest: string | null;
  workflowRun: { id: number | null; headBranch: string | null; headSha: string | null } | null;
}

/** 期限切れか（API の expired フラグか、期限を過ぎているか） */
export function isExpired(a: Artifact, nowMs: number): boolean {
  if (a.expired) return true;
  if (a.expiresAt === null) return false;
  return Date.parse(a.expiresAt) <= nowMs;
}

/** 作成からの経過日数。作成日が不明なら null */
export function ageDays(a: Artifact, nowMs: number): number | null {
  return elapsedDays(a.createdAt, nowMs);
}

export type ExpiryState =
  | { kind: "expired" }
  | { kind: "today" }
  | { kind: "tomorrow" }
  | { kind: "days"; days: number }
  | { kind: "unknown" };

/** 期限までの残り。表示する日付と食い違わないよう、24 時間単位ではなく暦日で数える */
export function expiryState(a: Artifact, nowMs: number): ExpiryState {
  if (isExpired(a, nowMs)) return { kind: "expired" };
  if (a.expiresAt === null) return { kind: "unknown" };
  const days = localDay(Date.parse(a.expiresAt)) - localDay(nowMs);
  if (days <= 0) return { kind: "today" };
  if (days === 1) return { kind: "tomorrow" };
  return { kind: "days", days };
}

/** ダウンロード時のファイル名（owner-repo-name-id.zip）。ファイル名に使えない文字は _ にする */
export function downloadFilename(a: Artifact): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_");
  return `${safe(a.repo.owner)}-${safe(a.repo.name)}-${safe(a.name)}-${a.id}.zip`;
}

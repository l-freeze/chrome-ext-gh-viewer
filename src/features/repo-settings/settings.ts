// リポジトリの設定のモデル: 並べる設定の一覧と、その値。閲覧のみで、変える操作は持たない。

import type { RepoRef } from "../workspace/repository";

export type SettingGroup = "general" | "pullRequests" | "commits" | "protection";

/** 表に並べる設定（この順に並べる）。protection は既定のブランチに効いている保護 */
export const SETTINGS = [
  { key: "visibility", group: "general" },
  { key: "defaultBranch", group: "general" },
  { key: "issues", group: "general" },
  { key: "projects", group: "general" },
  { key: "wiki", group: "general" },
  { key: "discussions", group: "general" },
  { key: "mergeCommit", group: "pullRequests" },
  { key: "squashMerge", group: "pullRequests" },
  { key: "rebaseMerge", group: "pullRequests" },
  { key: "autoMerge", group: "pullRequests" },
  { key: "deleteBranchOnMerge", group: "pullRequests" },
  { key: "updateBranch", group: "pullRequests" },
  { key: "webSignoff", group: "commits" },
  { key: "protected", group: "protection" },
  { key: "requirePullRequest", group: "protection" },
  { key: "requiredChecks", group: "protection" },
  { key: "blockForcePush", group: "protection" },
  { key: "restrictDeletion", group: "protection" },
  { key: "linearHistory", group: "protection" },
  { key: "signedCommits", group: "protection" },
] as const satisfies ReadonlyArray<{ key: string; group: SettingGroup }>;

export type SettingKey = (typeof SETTINGS)[number]["key"];

/**
 * value: 読めた値。requirePullRequest は必要な承認の数（不要なら false）、requiredChecks は必須のチェックの名前を並べた文字列（無ければ false）
 * unknown: 読めなかった（トークンの権限で返らない、空のリポジトリで既定のブランチが無いなど）
 * unavailable: リポジトリのプランでは使えない（無料プランの private リポジトリのブランチ保護など）
 */
export type SettingValue = { kind: "value"; value: string | number | boolean } | { kind: "unknown" } | { kind: "unavailable" };

export interface RepoSettings {
  repo: RepoRef;
  values: Record<SettingKey, SettingValue>;
}

export const UNKNOWN: SettingValue = { kind: "unknown" };
export const UNAVAILABLE: SettingValue = { kind: "unavailable" };

export function known(value: string | number | boolean | null | undefined): SettingValue {
  return value === null || value === undefined ? UNKNOWN : { kind: "value", value };
}

/** 比べるための値。読めなかったものは null（比べない） */
export function comparable(v: SettingValue): string | null {
  return v.kind === "value" ? JSON.stringify(v.value) : null;
}

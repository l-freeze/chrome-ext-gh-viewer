// GitHub の操作ごとに必要なトークンの権限。GitHub が応答ヘッダーで教えてくれればそれを使い、
// なければこの表で補う。

import type { GitHubApiError } from "./errors";

export type GitHubOperation =
  | "artifacts.list"
  | "artifacts.delete"
  | "artifacts.download"
  | "workflows.list"
  | "workflow.read"
  | "workflow.dispatch"
  | "issues.search"
  | "caches.list"
  | "caches.delete"
  | "runs.list"
  | "runs.delete"
  | "secrets.list"
  | "releases.list"
  | "projects.list"
  | "projects.move"
  | "labels.list"
  | "labels.write"
  | "repoSettings.read"
  | "repoSettings.write"
  | "repoSettings.branches";

interface Requirement {
  /** Fine-grained PAT の権限（"名前=read|write"）。すべて必要 */
  fineGrained: string[];
  /** Classic PAT / OAuth のスコープ */
  classic: string[];
}

// Classic の repo は private リポジトリに必要。public リポジトリの読み取りだけなら不要
const REQUIREMENTS: Record<GitHubOperation, Requirement> = {
  "artifacts.list": { fineGrained: ["actions=read"], classic: ["repo"] },
  "artifacts.delete": { fineGrained: ["actions=write"], classic: ["repo"] },
  "artifacts.download": { fineGrained: ["actions=read"], classic: ["repo"] },
  "workflows.list": { fineGrained: ["actions=read"], classic: ["repo"] },
  "workflow.read": { fineGrained: ["contents=read"], classic: ["repo"] },
  "workflow.dispatch": { fineGrained: ["actions=write"], classic: ["repo"] },
  "issues.search": { fineGrained: ["issues=read"], classic: ["repo"] },
  "caches.list": { fineGrained: ["actions=read"], classic: ["repo"] },
  "caches.delete": { fineGrained: ["actions=write"], classic: ["repo"] },
  "runs.list": { fineGrained: ["actions=read"], classic: ["repo"] },
  "runs.delete": { fineGrained: ["actions=write"], classic: ["repo"] },
  "releases.list": { fineGrained: ["contents=read"], classic: ["repo"] },
  // Environment の一覧と、その Secrets・Variables も読む
  "secrets.list": { fineGrained: ["secrets=read", "variables=read", "environments=read"], classic: ["repo"] },
  // Fine-grained PAT の Projects 権限は Organization の権限
  "projects.list": { fineGrained: ["organization_projects=read"], classic: ["read:project"] },
  "projects.move": { fineGrained: ["organization_projects=write"], classic: ["project"] },
  "labels.list": { fineGrained: ["issues=read"], classic: ["repo"] },
  "labels.write": { fineGrained: ["issues=write"], classic: ["repo"] },
  "repoSettings.read": { fineGrained: ["metadata=read"], classic: ["repo"] },
  // 公開範囲と既定のブランチの変更。リポジトリの削除と同じ権限
  "repoSettings.write": { fineGrained: ["administration=write"], classic: ["repo"] },
  "repoSettings.branches": { fineGrained: ["contents=read"], classic: ["repo"] },
};

export interface PermissionHint {
  /** どれか 1 組を満たせばよい。各組の権限はすべて必要 */
  fineGrained: string[][];
  classic: string[];
  /** GitHub の応答ヘッダーから得たものか（false なら一般的な要件） */
  fromGitHub: boolean;
}

/** 権限不足が原因でありうるエラーなら、必要な権限を返す */
export function permissionHint(error: GitHubApiError, operation: GitHubOperation): PermissionHint | null {
  if (error.kind !== "forbidden" && error.kind !== "not_found" && error.kind !== "unauthorized") return null;
  const fallback = REQUIREMENTS[operation];
  const fromGitHub = error.acceptedPermissions !== undefined || error.acceptedScopes !== undefined;
  return {
    fineGrained: error.acceptedPermissions ?? [fallback.fineGrained],
    classic: error.acceptedScopes ?? fallback.classic,
    fromGitHub,
  };
}

export type PermissionLevel = "read" | "write" | "admin";

/** トークンの作成画面での名前が、権限の名前から作る名前と違うもの */
const PERMISSION_NAMES: Record<string, string> = {
  organization_projects: "Projects (Organization permissions)",
};

/** "pull_requests=write" → { name: "Pull requests", level: "write" } */
export function describePermission(permission: string): { name: string; level: PermissionLevel } {
  const [rawName = "", rawLevel = "read"] = permission.split("=");
  const words = rawName.split("_").filter(Boolean);
  const name = PERMISSION_NAMES[rawName] ?? words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
  const level: PermissionLevel = rawLevel === "write" || rawLevel === "admin" ? rawLevel : "read";
  return { name, level };
}

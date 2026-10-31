// 操作ごとに必要なトークンの権限。GitHub が応答ヘッダーで教えてくれればそれを使い、
// なければこの表で補う。

import type { GitHubApiError } from "../api/errors";

export type Operation =
  | "artifacts.list"
  | "artifacts.delete"
  | "artifacts.download"
  | "workflows.list"
  | "workflow.read"
  | "workflow.dispatch"
  | "issues.search";

interface Requirement {
  /** Fine-grained PAT の権限（"名前=read|write"）。すべて必要 */
  fineGrained: string[];
  /** Classic PAT / OAuth のスコープ */
  classic: string[];
}

// Classic の repo は private リポジトリに必要。public リポジトリの読み取りだけなら不要
const REQUIREMENTS: Record<Operation, Requirement> = {
  "artifacts.list": { fineGrained: ["actions=read"], classic: ["repo"] },
  "artifacts.delete": { fineGrained: ["actions=write"], classic: ["repo"] },
  "artifacts.download": { fineGrained: ["actions=read"], classic: ["repo"] },
  "workflows.list": { fineGrained: ["actions=read"], classic: ["repo"] },
  "workflow.read": { fineGrained: ["contents=read"], classic: ["repo"] },
  "workflow.dispatch": { fineGrained: ["actions=write"], classic: ["repo"] },
  "issues.search": { fineGrained: ["issues=read"], classic: ["repo"] },
};

export interface PermissionHint {
  /** どれか 1 組を満たせばよい。各組の権限はすべて必要 */
  fineGrained: string[][];
  classic: string[];
  /** GitHub の応答ヘッダーから得たものか（false なら一般的な要件） */
  fromGitHub: boolean;
}

/** 権限不足が原因でありうるエラーなら、必要な権限を返す */
export function permissionHint(error: GitHubApiError, operation: Operation): PermissionHint | null {
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

/** "pull_requests=write" → { name: "Pull requests", level: "write" } */
export function describePermission(permission: string): { name: string; level: PermissionLevel } {
  const [rawName = "", rawLevel = "read"] = permission.split("=");
  const words = rawName.split("_").filter(Boolean);
  const name = words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
  const level: PermissionLevel = rawLevel === "write" || rawLevel === "admin" ? rawLevel : "read";
  return { name, level };
}

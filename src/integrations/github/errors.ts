// GitHub API のエラーの分類。

import { ValidationError } from "../../lib/validation";

export type GitHubErrorKind =
  /** 401: トークンが無効・失効 */
  | "unauthorized"
  /** 403: 権限不足（Org の OAuth App 制限、PAT の権限不足など） */
  | "forbidden"
  /** 403: SAML SSO でトークンの承認が必要 */
  | "sso_required"
  /** 403/429: プライマリまたはセカンダリのレート制限 */
  | "rate_limited"
  /** 404: 存在しない、または見る権限がない */
  | "not_found"
  /** 410: 期限切れのアーティファクトなど */
  | "gone"
  /** 422: クエリやパラメータの誤り */
  | "validation"
  /** 5xx */
  | "server"
  /** 通信そのものの失敗・時間切れ */
  | "network"
  /** レスポンスの形が想定と違う */
  | "decode"
  /** 中断 */
  | "aborted"
  | "unexpected";

export interface RateLimit {
  limit: number;
  remaining: number;
  used: number;
  /** リセット時刻（UNIX 秒） */
  reset: number;
  resource: string;
}

export interface GitHubApiErrorInit {
  kind: GitHubErrorKind;
  message: string;
  status?: number;
  url?: string;
  rateLimit?: RateLimit;
  /** 再試行までに待つべき秒数（Retry-After またはレート制限のリセット時刻から算出） */
  retryAfterSec?: number;
  /** SAML SSO の承認ページ */
  ssoUrl?: string;
  documentationUrl?: string;
  /**
   * X-Accepted-GitHub-Permissions の内容。Fine-grained PAT / GitHub App に必要な権限の組み合わせで、
   * どれか 1 組を満たせばよい。例: [["contents=read"]]
   */
  acceptedPermissions?: string[][];
  /** X-Accepted-OAuth-Scopes の内容。Classic PAT / OAuth で受け付けるスコープ */
  acceptedScopes?: string[];
  cause?: unknown;
}

export class GitHubApiError extends Error {
  override readonly name = "GitHubApiError";
  readonly kind: GitHubErrorKind;
  readonly status: number | undefined;
  readonly url: string | undefined;
  readonly rateLimit: RateLimit | undefined;
  readonly retryAfterSec: number | undefined;
  readonly ssoUrl: string | undefined;
  readonly documentationUrl: string | undefined;
  readonly acceptedPermissions: string[][] | undefined;
  readonly acceptedScopes: string[] | undefined;

  constructor(init: GitHubApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.status = init.status;
    this.url = init.url;
    this.rateLimit = init.rateLimit;
    this.retryAfterSec = init.retryAfterSec;
    this.ssoUrl = init.ssoUrl;
    this.documentationUrl = init.documentationUrl;
    this.acceptedPermissions = init.acceptedPermissions;
    this.acceptedScopes = init.acceptedScopes;
  }
}

export function isGitHubApiError(e: unknown, kind?: GitHubErrorKind): e is GitHubApiError {
  return e instanceof GitHubApiError && (kind === undefined || e.kind === kind);
}

/** 応答の形の検証を行い、失敗したら kind: "decode" のエラーにする */
export function decode<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ValidationError) {
      throw new GitHubApiError({ kind: "decode", message: `Unexpected response shape: ${e.message}`, cause: e });
    }
    throw e;
  }
}

/** 何であれ GitHubApiError にそろえる */
export function toGitHubApiError(e: unknown): GitHubApiError {
  if (e instanceof GitHubApiError) return e;
  if (e instanceof DOMException && e.name === "AbortError") return new GitHubApiError({ kind: "aborted", message: "Aborted", cause: e });
  return new GitHubApiError({ kind: "unexpected", message: String(e), cause: e });
}

/**
 * X-Accepted-GitHub-Permissions（例: "contents=read,metadata=read; actions=write"）を読む。
 * ";" で区切られた組のどれか 1 つを満たせばよい。権限の要らない旨だけの値なら undefined
 */
export function parseAcceptedPermissions(value: string | null): string[][] | undefined {
  if (!value) return undefined;
  const sets = value
    .split(";")
    .map((set) =>
      set
        .split(",")
        .map((p) => p.trim())
        .filter((p) => /^[a-z_]+=(read|write|admin)$/.test(p)),
    )
    .filter((set) => set.length > 0);
  return sets.length > 0 ? sets : undefined;
}

/** X-Accepted-OAuth-Scopes（例: "repo, public_repo"）を読む */
export function parseAcceptedScopes(value: string | null): string[] | undefined {
  const scopes = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return scopes.length > 0 ? scopes : undefined;
}

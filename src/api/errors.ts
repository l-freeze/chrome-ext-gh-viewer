import type { RateLimit } from "./types";

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
  /** 通信そのものの失敗 */
  | "network"
  /** レスポンスの形が想定と違う */
  | "decode"
  /** AbortSignal による中断 */
  | "aborted"
  | "unexpected";

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

  constructor(init: GitHubApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.kind = init.kind;
    this.status = init.status;
    this.url = init.url;
    this.rateLimit = init.rateLimit;
    this.retryAfterSec = init.retryAfterSec;
    this.ssoUrl = init.ssoUrl;
    this.documentationUrl = init.documentationUrl;
  }
}

export class DecodeError extends Error {
  override readonly name = "DecodeError";
  constructor(readonly path: string, readonly expected: string, readonly actual: unknown) {
    super(`${path}: expected ${expected}, got ${describe(actual)}`);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function isGitHubApiError(e: unknown, kind?: GitHubErrorKind): e is GitHubApiError {
  return e instanceof GitHubApiError && (kind === undefined || e.kind === kind);
}

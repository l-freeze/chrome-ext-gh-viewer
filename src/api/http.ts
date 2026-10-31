// GitHub REST API への HTTP 呼び出しの共通部分。
// 認証ヘッダー、エラーの分類、レート制限、再試行、ページネーションを扱う。

import { GitHubApiError } from "./errors";
import type { RateLimit } from "./types";

export const DEFAULT_API_BASE_URL = "https://api.github.com";
export const API_VERSION = "2022-11-28";

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface HttpOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: Sleep;
  /** 現在時刻（ミリ秒）。テスト用 */
  now?: () => number;
  /** 再試行の最大回数 */
  maxRetries?: number;
  /** レート制限で自動的に待つ最大秒数。これより長く待つ必要があればエラーにする */
  maxRetryWaitSec?: number;
  /** レスポンスのたびに最新のレート制限情報を通知する */
  onRateLimit?: (rateLimit: RateLimit) => void;
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Query;
  body?: unknown;
  accept?: string;
  signal?: AbortSignal;
}

/** セカンダリレート制限で Retry-After がないときの待ち時間 */
const SECONDARY_RATE_LIMIT_WAIT_SEC = 60;
/** 5xx・通信エラー時の再試行間隔の基準 */
const BACKOFF_BASE_MS = 1000;

export const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function abortError(signal: AbortSignal | undefined): GitHubApiError {
  return new GitHubApiError({ kind: "aborted", message: "Request aborted", cause: signal?.reason });
}

export class GitHubHttp {
  readonly baseUrl: string;
  private readonly origin: string;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: Sleep;
  private readonly now: () => number;
  private readonly maxRetries: number;
  private readonly maxRetryWaitSec: number;
  private readonly onRateLimit: ((rateLimit: RateLimit) => void) | undefined;
  lastRateLimit: RateLimit | null = null;

  constructor(options: HttpOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
    this.origin = new URL(this.baseUrl).origin;
    this.token = options.token;
    // fetch を素のまま保持すると this が外れて Illegal invocation になる環境があるため包む
    const f = options.fetch ?? globalThis.fetch;
    this.fetchFn = (input, init) => f(input, init);
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.maxRetries = options.maxRetries ?? 2;
    this.maxRetryWaitSec = options.maxRetryWaitSec ?? 60;
    this.onRateLimit = options.onRateLimit;
  }

  /** パスまたは API と同じオリジンの絶対 URL から、クエリ付きの URL を作る */
  url(pathOrUrl: string, query?: Query): string {
    const url = /^https?:\/\//.test(pathOrUrl) ? new URL(pathOrUrl) : new URL(this.baseUrl + pathOrUrl);
    // トークンを GitHub 以外へ送らないよう、オリジンが違う URL は拒否する
    if (url.origin !== this.origin) {
      throw new GitHubApiError({ kind: "unexpected", message: `Refusing to send token to ${url.origin}` });
    }
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  headers(accept = "application/vnd.github+json"): Record<string, string> {
    return {
      Accept: accept,
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": API_VERSION,
    };
  }

  /** 成功（2xx）したレスポンスを返す。失敗は GitHubApiError を投げる */
  async request(pathOrUrl: string, options: RequestOptions = {}): Promise<Response> {
    const method = options.method ?? "GET";
    const url = this.url(pathOrUrl, options.query);
    const headers = this.headers(options.accept);
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    for (let attempt = 0; ; attempt++) {
      if (options.signal?.aborted) throw abortError(options.signal);
      let error: GitHubApiError;
      try {
        const res = await this.fetchFn(url, {
          method,
          headers,
          ...(body !== undefined ? { body } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });
        const rateLimit = parseRateLimit(res.headers);
        if (rateLimit) {
          this.lastRateLimit = rateLimit;
          this.onRateLimit?.(rateLimit);
        }
        if (res.ok) return res;
        error = await toApiError(res, url, rateLimit, this.now());
      } catch (e) {
        if (e instanceof GitHubApiError) throw e;
        if (options.signal?.aborted) throw abortError(options.signal);
        error = new GitHubApiError({ kind: "network", message: `Network error: ${String(e)}`, url, cause: e });
      }

      const waitMs = this.retryWaitMs(error, method, attempt);
      if (waitMs === null) throw error;
      await this.sleep(waitMs, options.signal);
    }
  }

  /** 再試行するなら待ち時間（ミリ秒）、しないなら null */
  private retryWaitMs(error: GitHubApiError, method: string, attempt: number): number | null {
    if (attempt >= this.maxRetries) return null;
    if (error.kind === "rate_limited") {
      const sec = error.retryAfterSec ?? SECONDARY_RATE_LIMIT_WAIT_SEC;
      return sec <= this.maxRetryWaitSec ? sec * 1000 : null;
    }
    // サーバーエラーと通信エラーは、副作用のない GET だけ再試行する
    if ((error.kind === "server" || error.kind === "network") && method === "GET") {
      return BACKOFF_BASE_MS * 2 ** attempt;
    }
    return null;
  }

  async json(pathOrUrl: string, options: RequestOptions = {}): Promise<{ data: unknown; response: Response }> {
    const response = await this.request(pathOrUrl, options);
    try {
      return { data: await response.json(), response };
    } catch (e) {
      throw new GitHubApiError({
        kind: "decode",
        message: "Response body is not valid JSON",
        status: response.status,
        url: response.url,
        cause: e,
      });
    }
  }

  /** Link ヘッダーの rel="next" をたどり、各ページの JSON を順に返す */
  async *paginate(path: string, options: RequestOptions = {}): AsyncGenerator<unknown, void, undefined> {
    let next: string | null = this.url(path, options.query);
    const { query: _query, ...rest } = options;
    while (next !== null) {
      const { data, response }: { data: unknown; response: Response } = await this.json(next, rest);
      yield data;
      next = parseNextLink(response.headers.get("link"));
    }
  }
}

export function parseRateLimit(headers: Headers): RateLimit | null {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (limit === null || remaining === null || reset === null) return null;
  const values = [limit, remaining, reset].map(Number);
  if (values.some((n) => !Number.isFinite(n))) return null;
  return {
    limit: values[0]!,
    remaining: values[1]!,
    reset: values[2]!,
    used: Number(headers.get("x-ratelimit-used") ?? values[0]! - values[1]!),
    resource: headers.get("x-ratelimit-resource") ?? "core",
  };
}

const NEXT_LINK_RE = /<([^>]+)>\s*;\s*rel="?next"?/;

export function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = NEXT_LINK_RE.exec(part);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function readErrorBody(res: Response): Promise<{ message: string | null; documentationUrl: string | null }> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null) {
      const o = body as Record<string, unknown>;
      return {
        message: typeof o["message"] === "string" ? o["message"] : null,
        documentationUrl: typeof o["documentation_url"] === "string" ? o["documentation_url"] : null,
      };
    }
  } catch {
    // 本文が JSON でなくても分類はできるので無視する
  }
  return { message: null, documentationUrl: null };
}

async function toApiError(
  res: Response,
  url: string,
  rateLimit: RateLimit | null,
  nowMs: number,
): Promise<GitHubApiError> {
  const { message, documentationUrl } = await readErrorBody(res);
  const status = res.status;
  const acceptedPermissions = parseAcceptedPermissions(res.headers.get("x-accepted-github-permissions"));
  const acceptedScopes = parseAcceptedScopes(res.headers.get("x-accepted-oauth-scopes"));
  const base = {
    status,
    url,
    message: message ?? `HTTP ${status}`,
    ...(rateLimit ? { rateLimit } : {}),
    ...(documentationUrl ? { documentationUrl } : {}),
    ...(acceptedPermissions ? { acceptedPermissions } : {}),
    ...(acceptedScopes ? { acceptedScopes } : {}),
  };

  if (status === 403 || status === 429) {
    const retryAfter = res.headers.get("retry-after");
    if (rateLimit && rateLimit.remaining === 0) {
      const sec = Math.max(0, Math.ceil(rateLimit.reset - nowMs / 1000));
      return new GitHubApiError({ ...base, kind: "rate_limited", retryAfterSec: sec });
    }
    if (retryAfter !== null && Number.isFinite(Number(retryAfter))) {
      return new GitHubApiError({ ...base, kind: "rate_limited", retryAfterSec: Number(retryAfter) });
    }
    if (status === 429 || /rate limit/i.test(message ?? "")) {
      return new GitHubApiError({ ...base, kind: "rate_limited" });
    }
    const sso = res.headers.get("x-github-sso");
    if (sso !== null) {
      const ssoUrl = /url=(\S+)/.exec(sso)?.[1];
      return new GitHubApiError({ ...base, kind: "sso_required", ...(ssoUrl ? { ssoUrl } : {}) });
    }
    return new GitHubApiError({ ...base, kind: "forbidden" });
  }
  if (status === 401) return new GitHubApiError({ ...base, kind: "unauthorized" });
  if (status === 404) return new GitHubApiError({ ...base, kind: "not_found" });
  if (status === 410) return new GitHubApiError({ ...base, kind: "gone" });
  if (status === 422) return new GitHubApiError({ ...base, kind: "validation" });
  if (status >= 500) return new GitHubApiError({ ...base, kind: "server" });
  return new GitHubApiError({ ...base, kind: "unexpected" });
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

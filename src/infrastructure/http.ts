// 汎用の HTTP 送信: タイムアウト、中断、通信エラーの区別、再試行の仕組み。
// どのサービスかもトークンも知らない。いつ・どれだけ待って再試行するかは呼び出し側が決める。

import { sleep as defaultSleep, type Sleep } from "../lib/time";

export type TransportErrorKind = "network" | "timeout" | "aborted";

/** 応答を受け取れなかった（通信できない・時間切れ・中断） */
export class TransportError extends Error {
  override readonly name = "TransportError";
  constructor(
    readonly kind: TransportErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface RetryContext {
  /** 何回目の試行の結果か。最初は 0 */
  attempt: number;
  /** 最初の試行を始めてからの時間（待った時間を含む） */
  elapsedMs: number;
  /** 次の 1 回にかかりうる最長の時間 */
  timeoutMs: number;
}

/** 再試行の判断。待つならミリ秒、やめるなら null を返す */
export interface RetryPolicy {
  onResponse?(response: Response, context: RetryContext): Promise<number | null> | number | null;
  onError?(error: TransportError, context: RetryContext): number | null;
}

/**
 * 再試行してよいメソッド。同じリクエストを繰り返しても結果が変わらないもの（RFC 9110 の冪等なメソッド）だけで、
 * 呼び出し側の判断にかかわらず、ほかのメソッドは再試行しない
 */
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

export interface HttpClient {
  /** 応答を返す（ステータスにかかわらず）。応答を得られなければ TransportError を投げる */
  send(request: HttpRequest, retry?: RetryPolicy): Promise<Response>;
}

export interface HttpClientOptions {
  fetch?: typeof fetch;
  sleep?: Sleep;
  /** 1 回のリクエストの時間切れ（ミリ秒） */
  timeoutMs?: number;
  now?: () => number;
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  // fetch を素のまま保持すると this が外れて Illegal invocation になる環境があるため包む
  const f = options.fetch ?? globalThis.fetch;
  const fetchFn: typeof fetch = (input, init) => f(input, init);
  const wait = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const now = options.now ?? (() => Date.now());

  async function once(request: HttpRequest): Promise<Response> {
    if (request.signal?.aborted) throw new TransportError("aborted", "Request aborted", { cause: request.signal.reason });
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    try {
      return await fetchFn(request.url, {
        method: request.method ?? "GET",
        ...(request.headers ? { headers: request.headers } : {}),
        ...(request.body !== undefined ? { body: request.body } : {}),
        signal,
      });
    } catch (e) {
      if (request.signal?.aborted) throw new TransportError("aborted", "Request aborted", { cause: e });
      if (timeout.aborted) throw new TransportError("timeout", `No response within ${timeoutMs} ms`, { cause: e });
      throw new TransportError("network", `Network error: ${String(e)}`, { cause: e });
    }
  }

  return {
    async send(request, retry) {
      const policy = RETRYABLE_METHODS.has((request.method ?? "GET").toUpperCase()) ? retry : undefined;
      const started = now();
      for (let attempt = 0; ; attempt++) {
        const context = (): RetryContext => ({ attempt, elapsedMs: now() - started, timeoutMs });
        let waitMs: number | null;
        try {
          const response = await once(request);
          waitMs = policy?.onResponse ? await policy.onResponse(response, context()) : null;
          if (waitMs === null) return response;
          // 使わない応答の本文は閉じてから次を送る
          await response.body?.cancel().catch(() => undefined);
        } catch (e) {
          if (!(e instanceof TransportError) || e.kind === "aborted") throw e;
          waitMs = policy?.onError ? policy.onError(e, context()) : null;
          if (waitMs === null) throw e;
        }
        try {
          await wait(waitMs, request.signal);
        } catch (e) {
          throw new TransportError("aborted", "Request aborted", { cause: e });
        }
      }
    },
  };
}

/** Link ヘッダー（RFC 8288）の rel="next" の URL */
export function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Retry-After ヘッダー（RFC 9110: 秒数か HTTP の日時）を、今から待つミリ秒にする。ない・読めないときは null */
export function retryAfterMs(headers: Headers, nowMs = Date.now()): number | null {
  const value = headers.get("retry-after")?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs);
}

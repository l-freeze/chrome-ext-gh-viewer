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

/** 再試行の判断。待つならミリ秒、やめるなら null を返す。attempt は 0 から数える */
export interface RetryPolicy {
  onResponse?(response: Response, attempt: number): Promise<number | null> | number | null;
  onError?(error: TransportError, attempt: number): number | null;
}

export interface HttpClient {
  /** 応答を返す（ステータスにかかわらず）。応答を得られなければ TransportError を投げる */
  send(request: HttpRequest, retry?: RetryPolicy): Promise<Response>;
}

export interface HttpClientOptions {
  fetch?: typeof fetch;
  sleep?: Sleep;
  /** 1 回のリクエストの時間切れ（ミリ秒） */
  timeoutMs?: number;
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  // fetch を素のまま保持すると this が外れて Illegal invocation になる環境があるため包む
  const f = options.fetch ?? globalThis.fetch;
  const fetchFn: typeof fetch = (input, init) => f(input, init);
  const wait = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 30_000;

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
      for (let attempt = 0; ; attempt++) {
        let waitMs: number | null;
        try {
          const response = await once(request);
          waitMs = retry?.onResponse ? await retry.onResponse(response, attempt) : null;
          if (waitMs === null) return response;
        } catch (e) {
          if (!(e instanceof TransportError) || e.kind === "aborted") throw e;
          waitMs = retry?.onError ? retry.onError(e, attempt) : null;
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

/** Retry-After ヘッダーの秒数（数値の形だけを扱う） */
export function retryAfterSeconds(headers: Headers): number | null {
  const v = headers.get("retry-after");
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

import { describe, expect, it, vi } from "vitest";
import { GitHubApiError } from "../../../src/integrations/github/errors";
import { parseNextLink } from "../../../src/infrastructure/http";
import { GitHubHttp, parseRateLimit } from "../../../src/integrations/github/http";
import { json, mockFetch, recordingSleep, type Handler } from "../../helpers";

function setup(handler: Handler, options: { now?: () => number; maxRetryWaitSec?: number } = {}) {
  const { fetch, calls } = mockFetch(handler);
  const { sleep, waits } = recordingSleep();
  const onRateLimit = vi.fn();
  const http = new GitHubHttp({ token: "tok", fetch, sleep, onRateLimit, ...options });
  return { http, calls, waits, onRateLimit };
}

async function errorOf(p: Promise<unknown>): Promise<GitHubApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof GitHubApiError) return e;
    throw e;
  }
  throw new Error("expected rejection");
}

const rateHeaders = (remaining: number, reset = 1_000_100) => ({
  "x-ratelimit-limit": "5000",
  "x-ratelimit-remaining": String(remaining),
  "x-ratelimit-used": String(5000 - remaining),
  "x-ratelimit-reset": String(reset),
  "x-ratelimit-resource": "core",
});

describe("GitHubHttp.request", () => {
  it("認証・API バージョンのヘッダーとクエリを付ける", async () => {
    const { http, calls } = setup(() => json({}));
    await http.request("/user/repos", { query: { per_page: 100, skip: undefined, flag: true } });
    const call = calls[0]!;
    expect(call.url.toString()).toBe("https://api.github.com/user/repos?per_page=100&flag=true");
    expect(call.headers.get("authorization")).toBe("Bearer tok");
    expect(call.headers.get("accept")).toBe("application/vnd.github+json");
    expect(call.headers.get("x-github-api-version")).toBe("2022-11-28");
  });

  it("API と違うオリジンの URL にはトークンを送らない", async () => {
    const { http, calls } = setup(() => json({}));
    const err = await errorOf(http.request("https://evil.example/repos"));
    expect(err.kind).toBe("unexpected");
    expect(calls).toHaveLength(0);
  });

  it("レート制限ヘッダーを記録して通知する", async () => {
    const { http, onRateLimit } = setup(() => json({}, { headers: rateHeaders(4999) }));
    await http.request("/user");
    expect(http.lastRateLimit).toEqual({ limit: 5000, remaining: 4999, used: 1, reset: 1_000_100, resource: "core" });
    expect(onRateLimit).toHaveBeenCalledOnce();
  });

  it.each([
    [401, {}, "unauthorized"],
    [403, {}, "forbidden"],
    [404, {}, "not_found"],
    [410, {}, "gone"],
    [422, {}, "validation"],
    [418, {}, "unexpected"],
  ] as const)("HTTP %i を %s に分類する", async (status, headers, kind) => {
    const { http } = setup(() => json({ message: "msg", documentation_url: "https://docs" }, { status, headers }));
    const err = await errorOf(http.request("/x"));
    expect(err.kind).toBe(kind);
    expect(err.status).toBe(status);
    expect(err.message).toBe("msg");
    expect(err.documentationUrl).toBe("https://docs");
  });

  it("本文が JSON でないエラーも分類できる", async () => {
    const { http } = setup(() => new Response("<html>", { status: 404 }));
    const err = await errorOf(http.request("/x"));
    expect(err.kind).toBe("not_found");
    expect(err.message).toBe("HTTP 404");
  });

  it("SAML SSO が必要な 403 は承認 URL を取り出す", async () => {
    const { http } = setup(() =>
      json({ message: "Resource protected by organization SAML enforcement." }, {
        status: 403,
        headers: { "x-github-sso": "required; url=https://github.com/orgs/acme/sso?authorization_request=abc" },
      }),
    );
    const err = await errorOf(http.request("/x"));
    expect(err.kind).toBe("sso_required");
    expect(err.ssoUrl).toBe("https://github.com/orgs/acme/sso?authorization_request=abc");
  });

  it("残り 0 の 403 はリセットまで待って再試行する", async () => {
    let n = 0;
    const { http, waits, calls } = setup(
      () => (n++ === 0 ? json({ message: "API rate limit exceeded" }, { status: 403, headers: rateHeaders(0, 1_000_030) }) : json({ ok: 1 })),
      { now: () => 1_000_000_000 },
    );
    const res = await http.request("/x");
    expect(await res.json()).toEqual({ ok: 1 });
    expect(waits).toEqual([30_000]);
    expect(calls).toHaveLength(2);
  });

  it("待ち時間が上限を超えるレート制限は再試行せずエラーにする", async () => {
    const { http, waits } = setup(
      () => json({ message: "API rate limit exceeded" }, { status: 403, headers: rateHeaders(0, 1_003_600) }),
      { now: () => 1_000_000_000 },
    );
    const err = await errorOf(http.request("/x"));
    expect(err.kind).toBe("rate_limited");
    expect(err.retryAfterSec).toBe(3600);
    expect(waits).toEqual([]);
  });

  it("Retry-After 付きのセカンダリレート制限は指定秒数待つ", async () => {
    let n = 0;
    const { http, waits } = setup(() =>
      n++ === 0
        ? json({ message: "You have exceeded a secondary rate limit" }, { status: 403, headers: { "retry-after": "5" } })
        : json({}),
    );
    await http.request("/x");
    expect(waits).toEqual([5000]);
  });

  it("Retry-After のないセカンダリレート制限は 60 秒待つ", async () => {
    let n = 0;
    const { http, waits } = setup(() =>
      n++ === 0 ? json({ message: "You have exceeded a secondary rate limit" }, { status: 403 }) : json({}),
    );
    await http.request("/x");
    expect(waits).toEqual([60_000]);
  });

  it("GET の 5xx は指数バックオフで再試行し、回数を超えたらエラー", async () => {
    const { http, waits, calls } = setup(() => json({ message: "boom" }, { status: 502 }));
    const err = await errorOf(http.request("/x"));
    expect(err.kind).toBe("server");
    expect(waits).toEqual([1000, 2000]);
    expect(calls).toHaveLength(3);
  });

  it("DELETE の 5xx は再試行しない", async () => {
    const { http, calls } = setup(() => json({}, { status: 500 }));
    const err = await errorOf(http.request("/x", { method: "DELETE" }));
    expect(err.kind).toBe("server");
    expect(calls).toHaveLength(1);
  });

  it("通信エラーは network に分類し、GET なら再試行する", async () => {
    let n = 0;
    const { http, calls } = setup(() => {
      if (n++ === 0) throw new TypeError("Failed to fetch");
      return json({});
    });
    await http.request("/x");
    expect(calls).toHaveLength(2);

    const { http: http2 } = setup(() => {
      throw new TypeError("Failed to fetch");
    });
    const err = await errorOf(http2.request("/x", { method: "DELETE" }));
    expect(err.kind).toBe("network");
  });

  it("中断されたら aborted を投げる", async () => {
    const { http, calls } = setup(() => json({}));
    const ac = new AbortController();
    ac.abort();
    const err = await errorOf(http.request("/x", { signal: ac.signal }));
    expect(err.kind).toBe("aborted");
    expect(calls).toHaveLength(0);
  });

  it("本文が JSON でなければ json() は decode エラー", async () => {
    const { http } = setup(() => new Response("not json", { status: 200 }));
    const err = await errorOf(http.json("/x"));
    expect(err.kind).toBe("decode");
  });
});

describe("GitHubHttp.paginate", () => {
  it("Link の next をたどって全ページを返す", async () => {
    const { http, calls } = setup((call) => {
      const page = Number(call.url.searchParams.get("page") ?? "1");
      const link = page < 3 ? `<https://api.github.com/user/repos?per_page=1&page=${page + 1}>; rel="next", <https://api.github.com/user/repos?per_page=1&page=3>; rel="last"` : "";
      return json([page], { headers: link ? { link } : {} });
    });
    const pages: unknown[] = [];
    for await (const p of http.paginate("/user/repos", { query: { per_page: 1 } })) pages.push(p);
    expect(pages).toEqual([[1], [2], [3]]);
    expect(calls.map((c) => c.url.searchParams.get("page"))).toEqual([null, "2", "3"]);
  });

  it("next が別オリジンを指していたらトークンを送らずに止める", async () => {
    const { http, calls } = setup(() => json([1], { headers: { link: '<https://evil.example/next>; rel="next"' } }));
    const it = http.paginate("/x");
    await it.next();
    const err = await errorOf(it.next());
    expect(err.kind).toBe("unexpected");
    expect(calls).toHaveLength(1);
  });
});

describe("parseNextLink / parseRateLimit", () => {
  it("next がなければ null", () => {
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull();
  });

  it("ヘッダーが欠けていれば null", () => {
    expect(parseRateLimit(new Headers({ "x-ratelimit-limit": "60" }))).toBeNull();
  });
});

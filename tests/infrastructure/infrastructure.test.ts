import { describe, expect, it } from "vitest";
import { createHttpClient, parseNextLink, retryAfterMs, TransportError, type RetryContext } from "../../src/infrastructure/http";
import { typedStore } from "../../src/infrastructure/storage/contracts";
import { memoryDriver } from "../../src/infrastructure/storage/drivers/memory";
import { ValidationError } from "../../src/lib/validation";
import { mockFetch, recordingSleep } from "../helpers";

describe("HTTP の送信", () => {
  it("応答はステータスにかかわらず返し、再試行は呼び出し側の判断に従う", async () => {
    let n = 0;
    const { fetch, calls } = mockFetch(() => new Response(null, { status: n++ === 0 ? 503 : 200 }));
    const { sleep, waits } = recordingSleep();
    let t = 0;
    const client = createHttpClient({ fetch, sleep, timeoutMs: 5000, now: () => (t += 100) });
    const contexts: RetryContext[] = [];
    const res = await client.send(
      { url: "https://example.test/x" },
      { onResponse: (r, c) => (contexts.push(c), r.status === 503 && c.attempt === 0 ? 1500 : null) },
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([1500]);
    // 判断には、何回目か・最初からの経過時間・次の 1 回の時間切れを渡す
    expect(contexts.map((c) => [c.attempt, c.timeoutMs])).toEqual([[0, 5000], [1, 5000]]);
    expect(contexts[1]!.elapsedMs).toBeGreaterThan(contexts[0]!.elapsedMs);
  });

  it("冪等でないメソッド（POST・PATCH）は、呼び出し側が待つと答えても再試行しない", async () => {
    for (const method of ["POST", "PATCH"]) {
      const { fetch, calls } = mockFetch(() => new Response(null, { status: 503 }));
      const client = createHttpClient({ fetch, sleep: recordingSleep().sleep });
      const res = await client.send({ url: "https://example.test/x", method }, { onResponse: () => 10, onError: () => 10 });
      expect(res.status).toBe(503);
      expect(calls).toHaveLength(1);
    }
    let n = 0;
    const { fetch, calls } = mockFetch(() => new Response(null, { status: n++ === 0 ? 503 : 204 }));
    const client = createHttpClient({ fetch, sleep: recordingSleep().sleep });
    expect((await client.send({ url: "https://example.test/x", method: "DELETE" }, { onResponse: (r) => (r.status === 503 ? 10 : null) })).status).toBe(204);
    expect(calls).toHaveLength(2);
  });

  it("再試行する前に、使わない応答の本文を閉じる", async () => {
    let cancelled = 0;
    let n = 0;
    const { fetch } = mockFetch(() => {
      if (n++ > 0) return new Response("ok");
      const body = new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(1)), cancel: () => void cancelled++ });
      return new Response(body, { status: 503 });
    });
    const client = createHttpClient({ fetch, sleep: recordingSleep().sleep });
    await client.send({ url: "https://example.test/x" }, { onResponse: (r) => (r.status === 503 ? 10 : null) });
    expect(cancelled).toBe(1);
  });

  it("通信できなければ network、中断なら aborted の TransportError", async () => {
    const { fetch } = mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const client = createHttpClient({ fetch, sleep: recordingSleep().sleep });
    await expect(client.send({ url: "https://example.test/x" })).rejects.toMatchObject({ name: "TransportError", kind: "network" });
    const ac = new AbortController();
    ac.abort();
    const err = await client.send({ url: "https://example.test/x", signal: ac.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).kind).toBe("aborted");
  });

  it("時間内に応答がなければ timeout", async () => {
    const hanging = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("t", "AbortError"))))) as typeof fetch;
    const client = createHttpClient({ fetch: hanging, timeoutMs: 20 });
    await expect(client.send({ url: "https://example.test/x" })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("Link と Retry-After のヘッダーを読む", () => {
    expect(parseNextLink('<https://e.test/a?page=2>; rel="next", <https://e.test/a?page=9>; rel="last"')).toBe("https://e.test/a?page=2");
    expect(parseNextLink('<https://e.test/a?page=1>; rel="prev"')).toBeNull();
    const now = Date.parse("2026-11-06T00:00:00Z");
    expect(retryAfterMs(new Headers({ "retry-after": "5" }), now)).toBe(5000);
    expect(retryAfterMs(new Headers({ "retry-after": "Fri, 06 Nov 2026 00:00:30 GMT" }), now)).toBe(30_000);
    expect(retryAfterMs(new Headers({ "retry-after": "Thu, 05 Nov 2026 00:00:00 GMT" }), now)).toBe(0);
    expect(retryAfterMs(new Headers({ "retry-after": "soon" }), now)).toBeNull();
    expect(retryAfterMs(new Headers())).toBeNull();
  });
});

describe("型付きの保存", () => {
  const contract = {
    key: "count",
    input: { parse: (v: unknown) => { if (typeof v !== "number" || v < 0) throw new ValidationError("bad input"); return v; } },
    output: { parse: (v: unknown) => { if (typeof v !== "object" || v === null || typeof (v as { n?: unknown }).n !== "number") throw new ValidationError("bad stored value"); return (v as { n: number }).n; } },
    empty: () => 0,
    encode: (n: number) => ({ n }),
  };

  it("未保存なら空の値、保存した値は検証して読み出す", async () => {
    const store = typedStore(memoryDriver(), contract);
    expect(await store.load()).toBe(0);
    await store.save(3);
    expect(await store.load()).toBe(3);
  });

  it("保存する値と、壊れた保存済みの値を拒否する", async () => {
    await expect(typedStore(memoryDriver(), contract).save(-1)).rejects.toThrow("bad input");
    await expect(typedStore(memoryDriver({ count: "broken" }), contract).load()).rejects.toThrow("bad stored value");
  });
});

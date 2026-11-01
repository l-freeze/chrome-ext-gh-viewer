import { describe, expect, it } from "vitest";
import { isAbort, mapWithConcurrency, settleEach } from "../../src/lib/concurrency";
import { sortBy, toggleSort } from "../../src/lib/sort";
import { DAY_MS, elapsedDays, localDay, utcDate } from "../../src/lib/time";
import { arrayOf, num, obj, optStr, validatedAction, ValidationError } from "../../src/lib/validation";

describe("mapWithConcurrency", () => {
  it("同時実行数を守り、結果を入力順に返す", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (ms, i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("settleEach", () => {
  it("失敗しても続け、対象ごとの成否と進捗を返す", async () => {
    const progress: number[] = [];
    const res = await settleEach(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("no");
        return n * 10;
      },
      { onProgress: (p) => progress.push(p.done) },
    );
    expect(res.map((r) => (r.ok ? r.value : "ng"))).toEqual([10, "ng", 30]);
    expect(progress).toEqual([1, 2, 3]);
  });

  it("中断されたら残りを止めて AbortError で失敗する", async () => {
    const ac = new AbortController();
    const seen: number[] = [];
    const err = await settleEach(
      [1, 2, 3, 4],
      async (n) => {
        seen.push(n);
        if (n === 1) ac.abort();
      },
      { concurrency: 1, signal: ac.signal },
    ).catch((e: unknown) => e);
    expect(isAbort(err)).toBe(true);
    expect(seen).toEqual([1]);
  });
});

describe("sortBy / toggleSort", () => {
  const list = [
    { id: 1, v: 5 as number | null },
    { id: 2, v: null },
    { id: 3, v: 9 },
  ];
  it("値のないものは向きにかかわらず末尾、同じ値は tieBreak 順", () => {
    const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;
    expect(sortBy(list, (x) => x.v, "desc", byId).map((x) => x.id)).toEqual([3, 1, 2]);
    expect(sortBy(list, (x) => x.v, "asc", byId).map((x) => x.id)).toEqual([1, 3, 2]);
    expect(list.map((x) => x.id)).toEqual([1, 2, 3]);
  });
  it("同じ列は向きを反転し、違う列は既定の向き", () => {
    const def = (k: "a" | "b"): "asc" | "desc" => (k === "a" ? "asc" : "desc");
    expect(toggleSort({ key: "a", dir: "asc" }, "a", def)).toEqual({ key: "a", dir: "desc" });
    expect(toggleSort({ key: "a", dir: "asc" }, "b", def)).toEqual({ key: "b", dir: "desc" });
  });
});

describe("time", () => {
  it("暦日・UTC の日付・経過日数", () => {
    const now = new Date(2026, 9, 30, 12).getTime();
    expect(localDay(new Date(2026, 9, 31, 1).getTime()) - localDay(now)).toBe(1);
    expect(utcDate(Date.UTC(2026, 0, 2, 23))).toBe("2026-01-02");
    expect(elapsedDays(new Date(now - 3.5 * DAY_MS).toISOString(), now)).toBe(3);
    expect(elapsedDays(null, now)).toBeNull();
  });
});

describe("validation", () => {
  it("形の違いをパス付きで知らせる", () => {
    expect(() => arrayOf([{ n: 1 }, { n: "x" }], "items", (x, p) => num(obj(x, p), "n", p))).toThrow(
      "items[1].n: expected number, got string",
    );
    expect(optStr({ a: null }, "a", "o")).toBeNull();
  });
  it("検証してから実行し、検証に失敗したら実行しない", async () => {
    let ran = false;
    const action = validatedAction(
      { parse: (raw) => { if (typeof raw !== "string") throw new ValidationError("string only"); return raw; } },
      async (s: string) => { ran = true; return s.length; },
    );
    expect(await action("abc")).toBe(3);
    ran = false;
    await expect(action(1)).rejects.toThrow("string only");
    expect(ran).toBe(false);
  });
});

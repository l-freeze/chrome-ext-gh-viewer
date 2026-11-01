import { describe, expect, it } from "vitest";
import { reuseUnchanged, sameValue } from "../../src/lib/reuse";

describe("取り直した値の再利用", () => {
  it("同じキーで同じ値なら前のオブジェクトを返し、並びは新しいほうに合わせる", () => {
    const a = { id: 1, title: "A" };
    const b = { id: 2, title: "B" };
    const next = reuseUnchanged([a, b], [{ id: 2, title: "B" }, { id: 1, title: "A2" }, { id: 3, title: "C" }], (x) => x.id);
    expect(next[0]).toBe(b);
    expect(next[1]).not.toBe(a);
    expect(next.map((x) => x.title)).toEqual(["B", "A2", "C"]);
  });

  it("値の比較は JSON にした形で行う", () => {
    expect(sameValue({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameValue(undefined, undefined)).toBe(true);
  });
});

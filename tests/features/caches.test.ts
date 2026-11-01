import { describe, expect, it } from "vitest";
import { isPullRequestRef, refLabel, type ActionsCache } from "../../src/features/caches/cache";
import { DEFAULT_CACHE_FILTER, filterCaches, sortCaches, summarizeCaches } from "../../src/features/caches/listing";
import { DAY_MS } from "../../src/lib/time";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const MB = 1024 * 1024;
function cache(id: number, o: Partial<ActionsCache> & { usedDaysAgo?: number } = {}): ActionsCache {
  const { usedDaysAgo = 0, ...rest } = o;
  return {
    id, repo: { owner: "acme", name: "web" }, ref: "refs/heads/main", key: `node-${id}`, version: null, sizeInBytes: MB,
    lastAccessedAt: new Date(NOW - usedDaysAgo * DAY_MS).toISOString(), createdAt: new Date(NOW - 10 * DAY_MS).toISOString(), ...rest,
  };
}

describe("キャッシュ", () => {
  it("ref を読みやすく表示する", () => {
    expect(refLabel("refs/heads/feat/x")).toBe("feat/x");
    expect(refLabel("refs/pull/12/merge")).toBe("PR #12");
    expect(refLabel("refs/tags/v1.2")).toBe("v1.2");
    expect(isPullRequestRef("refs/pull/3/merge")).toBe(true);
    expect(isPullRequestRef("refs/heads/pull")).toBe(false);
  });

  it("リポジトリ・ref（PR 番号でも）・未使用日数・サイズで絞り込む", () => {
    const list = [cache(1, { ref: "refs/pull/12/merge", usedDaysAgo: 5 }), cache(2, { repo: { owner: "acme", name: "api" }, sizeInBytes: 300 * MB }), cache(3, { usedDaysAgo: 1 })];
    const ids = (f: Partial<typeof DEFAULT_CACHE_FILTER>) => filterCaches(list, { ...DEFAULT_CACHE_FILTER, ...f }, NOW).map((c) => c.id);
    expect(ids({ refQuery: "pr #12" })).toEqual([1]);
    expect(ids({ refQuery: "main" })).toEqual([2, 3]);
    expect(ids({ repoQuery: "API" })).toEqual([2]);
    expect(ids({ unusedForDays: 3 })).toEqual([1]);
    expect(ids({ minSizeMB: 100 })).toEqual([2]);
  });

  it("並べ替えでは値のないものを末尾に置く", () => {
    const list = [cache(1, { sizeInBytes: 5 }), cache(2, { lastAccessedAt: null, sizeInBytes: 9 }), cache(3, { usedDaysAgo: 2 })];
    expect(sortCaches(list, { key: "lastUsed", dir: "desc" }).map((c) => c.id)).toEqual([1, 3, 2]);
    expect(sortCaches(list, { key: "size", dir: "desc" }).map((c) => c.id)).toEqual([3, 2, 1]);
  });

  it("合計・PR のキャッシュ・未使用・リポジトリ別を集計する", () => {
    const s = summarizeCaches([cache(1, { ref: "refs/pull/1/merge", sizeInBytes: 10 * MB }), cache(2, { usedDaysAgo: 6, sizeInBytes: 20 * MB }), cache(3, { repo: { owner: "acme", name: "api" }, sizeInBytes: 5 * MB })], NOW);
    expect([s.totalBytes / MB, s.count, s.repos]).toEqual([35, 3, 2]);
    expect(s.pullRequest.map((c) => c.id)).toEqual([1]);
    expect(s.unused.map((c) => c.id)).toEqual([2]);
    expect(s.byRepo.map((r) => [r.key, r.bytes / MB])).toEqual([["acme/web", 30], ["acme/api", 5]]);
  });
});

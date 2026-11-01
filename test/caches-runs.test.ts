import { describe, expect, it } from "vitest";
import { collectForRepos, deleteEach } from "../src/api/aggregate";
import { decodeRepository } from "../src/api/decode";
import { GitHubApiError } from "../src/api/errors";
import type { ActionsCache, WorkflowRun } from "../src/api/types";
import {
  DEFAULT_CACHE_FILTER,
  filterCaches,
  isPullRequestRef,
  refLabel,
  sortCaches,
  summarizeCaches,
} from "../src/domain/caches";
import { DAY_MS } from "../src/domain/format";
import { matchesWorkflow, runSearchFilter, summarizeRuns } from "../src/domain/runCleanup";
import { json, rawRepo, testClient } from "./helpers";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const MB = 1024 * 1024;

function cache(id: number, o: Partial<ActionsCache> & { usedDaysAgo?: number } = {}): ActionsCache {
  const { usedDaysAgo = 0, ...rest } = o;
  return {
    id,
    repo: { owner: "acme", name: "web" },
    ref: "refs/heads/main",
    key: `node-${id}`,
    version: null,
    sizeInBytes: MB,
    lastAccessedAt: new Date(NOW - usedDaysAgo * DAY_MS).toISOString(),
    createdAt: new Date(NOW - 10 * DAY_MS).toISOString(),
    ...rest,
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
    const list = [
      cache(1, { ref: "refs/pull/12/merge", usedDaysAgo: 5 }),
      cache(2, { repo: { owner: "acme", name: "api" }, sizeInBytes: 300 * MB }),
      cache(3, { usedDaysAgo: 1 }),
    ];
    const ids = (f: Partial<typeof DEFAULT_CACHE_FILTER>) =>
      filterCaches(list, { ...DEFAULT_CACHE_FILTER, ...f }, NOW).map((c) => c.id);
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
    const s = summarizeCaches(
      [
        cache(1, { ref: "refs/pull/1/merge", sizeInBytes: 10 * MB }),
        cache(2, { usedDaysAgo: 6, sizeInBytes: 20 * MB }),
        cache(3, { repo: { owner: "acme", name: "api" }, sizeInBytes: 5 * MB }),
      ],
      NOW,
    );
    expect(s.totalBytes).toBe(35 * MB);
    expect(s.count).toBe(3);
    expect(s.repos).toBe(2);
    expect(s.pullRequest.map((c) => c.id)).toEqual([1]);
    expect(s.pullRequestBytes).toBe(10 * MB);
    expect(s.unused.map((c) => c.id)).toEqual([2]);
    expect(s.byRepo.map((r) => [r.key, r.bytes / MB])).toEqual([
      ["acme/web", 30],
      ["acme/api", 5],
    ]);
  });
});

describe("実行履歴の整理の条件", () => {
  it("作成日は「指定日数より前」、結果は完了系の status にする", () => {
    expect(runSearchFilter({ olderThanDays: 30, conclusion: "all", workflowQuery: "" }, NOW)).toEqual({
      created: "<2026-10-02",
      status: "completed",
    });
    expect(runSearchFilter({ olderThanDays: 0, conclusion: "failure", workflowQuery: "" }, NOW)).toEqual({
      created: "<2026-11-01",
      status: "failure",
    });
  });

  it("ワークフロー名で絞り込み、リポジトリごとに集計する", () => {
    const run = (id: number, name: string | null, createdAt: string) => ({ id, name, createdAt }) as WorkflowRun;
    expect(matchesWorkflow(run(1, "Deploy prod", ""), "deploy")).toBe(true);
    expect(matchesWorkflow(run(1, "CI", ""), "deploy")).toBe(false);
    expect(matchesWorkflow(run(1, null, ""), "")).toBe(true);
    expect(
      summarizeRuns([run(1, "CI", "2026-09-01T00:00:00Z"), run(2, "CI", "2026-08-01T00:00:00Z"), run(3, "Deploy", "2026-09-15T00:00:00Z")]),
    ).toEqual({
      count: 3,
      byWorkflow: [
        { name: "CI", count: 2 },
        { name: "Deploy", count: 1 },
      ],
      oldest: "2026-08-01T00:00:00Z",
      newest: "2026-09-15T00:00:00Z",
    });
  });
});

const rawCache = (id: number, ref = "refs/heads/main") => ({
  id,
  ref,
  key: `k-${id}`,
  version: "abc",
  last_accessed_at: "2026-10-30T00:00:00Z",
  created_at: "2026-10-01T00:00:00Z",
  size_in_bytes: 1024 * id,
});
const rawRun = (id: number) => ({
  id,
  name: "CI",
  display_title: "Fix",
  workflow_id: 1,
  run_number: id,
  status: "completed",
  conclusion: "success",
  event: "push",
  head_branch: "main",
  actor: null,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  html_url: "",
});

describe("GitHubClient: キャッシュと実行履歴", () => {
  const repo = { owner: "acme", name: "web" };

  it("listRepoCaches は最終使用の新しい順で全ページを取る", async () => {
    const { client, calls } = testClient((call) =>
      call.url.searchParams.get("page") === "2"
        ? json({ total_count: 2, actions_caches: [rawCache(2, "refs/pull/3/merge")] })
        : json(
            { total_count: 2, actions_caches: [rawCache(1)] },
            { headers: { link: '<https://api.github.com/repos/acme/web/actions/caches?per_page=100&page=2>; rel="next"' } },
          ),
    );
    const caches = await client.listRepoCaches(repo);
    expect(caches.map((c) => [c.id, c.ref, c.sizeInBytes])).toEqual([
      [1, "refs/heads/main", 1024],
      [2, "refs/pull/3/merge", 2048],
    ]);
    expect(calls[0]!.url.searchParams.get("sort")).toBe("last_accessed_at");
  });

  it("deleteCache・deleteRun は DELETE を送る", async () => {
    const { client, calls } = testClient(() => new Response(null, { status: 204 }));
    await client.deleteCache({ id: 5, repo });
    await client.deleteRun({ id: 9, repo });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      "DELETE /repos/acme/web/actions/caches/5",
      "DELETE /repos/acme/web/actions/runs/9",
    ]);
  });

  it("listRuns は条件を付けて検索し、上限を超えていれば truncated", async () => {
    const { client, calls } = testClient((call) => {
      const page = Number(call.url.searchParams.get("page") ?? "1");
      return json(
        { total_count: 2500, workflow_runs: Array.from({ length: 100 }, (_, i) => rawRun(page * 1000 + i)) },
        page < 20 ? { headers: { link: `<https://api.github.com/repos/acme/web/actions/runs?per_page=100&page=${page + 1}>; rel="next"` } } : {},
      );
    });
    const res = await client.listRuns(repo, { created: "<2026-10-01", status: "completed" }, { maxResults: 250 });
    expect(res.runs).toHaveLength(250);
    expect(res.truncated).toBe(true);
    expect(res.runs[0]).toMatchObject({ name: "CI", displayTitle: "Fix" });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url.searchParams.get("created")).toBe("<2026-10-01");
    expect(calls[0]!.url.searchParams.get("status")).toBe("completed");
  });
});

describe("collectForRepos / deleteEach", () => {
  const repo = (name: string, id: number) => decodeRepository(rawRepo("acme", name, "Organization", id));

  it("リポジトリごとの成否を返し、truncated を引き継ぐ", async () => {
    const res = await collectForRepos([repo("a", 1), repo("b", 2)], async (r) => {
      if (r.name === "b") throw new GitHubApiError({ kind: "forbidden", message: "no" });
      return { items: [1, 2], truncated: true };
    });
    expect(res.map((r) => (r.ok ? ["ok", r.items.length, r.truncated] : ["ng", r.error.kind]))).toEqual([
      ["ok", 2, true],
      ["ng", "forbidden"],
    ]);
  });

  it("404 は成功扱い、ほかの失敗は返し、中断されたら止める", async () => {
    const res = await deleteEach([1, 2, 3], async (n) => {
      if (n === 2) throw new GitHubApiError({ kind: "not_found", message: "gone" });
      if (n === 3) throw new GitHubApiError({ kind: "forbidden", message: "no" });
    });
    expect(res.map((r) => r.ok)).toEqual([true, true, false]);

    const ac = new AbortController();
    const seen: number[] = [];
    await expect(
      deleteEach(
        [1, 2, 3, 4],
        async (n) => {
          seen.push(n);
          if (n === 1) ac.abort();
        },
        { concurrency: 1, signal: ac.signal },
      ),
    ).rejects.toMatchObject({ kind: "aborted" });
    expect(seen).toEqual([1]);
  });
});

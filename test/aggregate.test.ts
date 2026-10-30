import { describe, expect, it } from "vitest";
import {
  buildIssueQuery,
  deleteArtifacts,
  listArtifactsForRepos,
  mapWithConcurrency,
  searchIssuesForOwners,
  splitRange,
} from "../src/api/aggregate";
import { decodeRepository } from "../src/api/decode";
import type { Artifact, Owner } from "../src/api/types";
import { json, rawArtifact, rawIssue, rawRepo, testClient } from "./helpers";

const repo = (owner: string, name: string, id = 1) => decodeRepository(rawRepo(owner, name, "User", id));
const org = (login: string): Owner => ({ login, id: 1, type: "Organization", avatarUrl: "" });
const user = (login: string): Owner => ({ login, id: 2, type: "User", avatarUrl: "" });

describe("listArtifactsForRepos", () => {
  it("失敗したリポジトリはエラーとして返し、ほかは続ける", async () => {
    const { client } = testClient((call) =>
      call.url.pathname.includes("/locked/")
        ? json({ message: "Must have admin rights" }, { status: 403 })
        : json({ total_count: 1, artifacts: [rawArtifact(1)] }),
    );
    const progress: number[] = [];
    const results = await listArtifactsForRepos(client, [repo("me", "a"), repo("me", "locked"), repo("me", "c")], {
      onProgress: (p) => progress.push(p.done),
    });
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    const failed = results[1]!;
    expect(!failed.ok && failed.error.kind).toBe("forbidden");
    expect(progress).toEqual([1, 2, 3]);
  });

  it("中断されたら全体を止める", async () => {
    const { client } = testClient(() => json({ total_count: 0, artifacts: [] }));
    const ac = new AbortController();
    ac.abort();
    await expect(listArtifactsForRepos(client, [repo("me", "a")], { signal: ac.signal })).rejects.toMatchObject({
      kind: "aborted",
    });
  });
});

describe("deleteArtifacts", () => {
  const artifact = (id: number): Artifact => ({
    id,
    repo: { owner: "me", name: "a" },
    name: "x",
    sizeInBytes: 1,
    expired: false,
    createdAt: null,
    expiresAt: null,
    updatedAt: null,
    digest: null,
    workflowRun: null,
  });

  it("404（削除済み）は成功扱い、403 は失敗として返す", async () => {
    const { client } = testClient((call) => {
      if (call.url.pathname.endsWith("/2")) return json({ message: "Not Found" }, { status: 404 });
      if (call.url.pathname.endsWith("/3")) return json({ message: "Forbidden" }, { status: 403 });
      return new Response(null, { status: 204 });
    });
    const results = await deleteArtifacts(client, [artifact(1), artifact(2), artifact(3)]);
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
  });
});

describe("buildIssueQuery", () => {
  it("所有者の種類で org: と user: を使い分ける", () => {
    expect(buildIssueQuery(org("acme"))).toBe("is:issue is:open org:acme");
    expect(buildIssueQuery(user("me"), { state: "all", extra: " label:bug " })).toBe("is:issue user:me label:bug");
    expect(buildIssueQuery(user("me"), { state: "closed" }, { from: "2026-01-01", to: "2026-06-30" })).toBe(
      "is:issue is:closed user:me created:2026-01-01..2026-06-30",
    );
  });
});

describe("splitRange", () => {
  it("重ならない 2 つの範囲に分ける", () => {
    expect(splitRange({ from: "2026-01-01", to: "2026-01-10" })).toEqual([
      { from: "2026-01-01", to: "2026-01-05" },
      { from: "2026-01-06", to: "2026-01-10" },
    ]);
    expect(splitRange({ from: "2026-01-01", to: "2026-01-02" })).toEqual([
      { from: "2026-01-01", to: "2026-01-01" },
      { from: "2026-01-02", to: "2026-01-02" },
    ]);
  });

  it("1 日だけなら分けられない", () => {
    expect(splitRange({ from: "2026-01-01", to: "2026-01-01" })).toBeNull();
  });
});

describe("searchIssuesForOwners", () => {
  it("所有者ごとに検索し、失敗した所有者はエラーとして返す", async () => {
    const { client, calls } = testClient((call) => {
      const q = call.url.searchParams.get("q")!;
      if (q.includes("org:locked")) return json({ message: "forbidden" }, { status: 403 });
      return json({ total_count: 1, incomplete_results: false, items: [rawIssue(q.includes("org:acme") ? 1 : 2)] });
    });
    const results = await searchIssuesForOwners(client, [org("acme"), org("locked"), user("me")]);
    expect(results.map((r) => [r.owner.login, r.issues.map((i) => i.id), r.error?.kind ?? null])).toEqual([
      ["acme", [1], null],
      ["locked", [], "forbidden"],
      ["me", [2], null],
    ]);
    expect(calls).toHaveLength(3);
  });

  it("1000 件を超える所有者は作成日の範囲を分けて全件を集める", async () => {
    // 2026-01-01〜2026-01-04 に 1 日 600 件ずつ、計 2400 件ある想定
    const perDay = 600;
    const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"];
    const { client, calls } = testClient((call) => {
      const q = call.url.searchParams.get("q")!;
      const page = Number(call.url.searchParams.get("page"));
      const m = /created:(\S+)\.\.(\S+)/.exec(q);
      const inRange = m ? days.filter((d) => d >= m[1]! && d <= m[2]!) : days;
      const ids = inRange.flatMap((d) => Array.from({ length: perDay }, (_, i) => days.indexOf(d) * 10_000 + i));
      const items = ids.slice((page - 1) * 100, page * 100).map((id) => rawIssue(id));
      return json({ total_count: ids.length, incomplete_results: false, items });
    });
    const [result] = await searchIssuesForOwners(client, [org("acme")], {}, { since: "2026-01-01", today: "2026-01-04" });
    expect(result!.issues).toHaveLength(2400);
    expect(new Set(result!.issues.map((i) => i.id)).size).toBe(2400);
    expect(result!.truncated).toBe(false);
    // 全体(1) → 01-01..02(1200件, 1) → 各日(600件, 1+5 ページ) × 2 → 03..04 も同様
    const queries = new Set(calls.map((c) => c.url.searchParams.get("q")));
    expect(queries).toContain("is:issue is:open org:acme created:2026-01-01..2026-01-01");
    expect(queries).toContain("is:issue is:open org:acme created:2026-01-04..2026-01-04");
  });

  it("1 日で 1000 件を超えると truncated になる", async () => {
    const { client } = testClient((call) => {
      const page = Number(call.url.searchParams.get("page"));
      const items = Array.from({ length: 100 }, (_, i) => rawIssue(page * 100 + i));
      return json({ total_count: 1500, incomplete_results: false, items });
    });
    const [result] = await searchIssuesForOwners(client, [user("me")], {}, { since: "2026-01-01", today: "2026-01-01" });
    expect(result!.truncated).toBe(true);
    expect(result!.issues).toHaveLength(1000);
  });
});

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
  });

  it("空配列でも動く", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

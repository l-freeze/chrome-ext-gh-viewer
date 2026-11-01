import { describe, expect, it } from "vitest";
import {
  buildIssueQuery,
  parseRepositoryUrl,
  readIssue,
  readSearchPage,
  searchIssues,
  searchOwnerIssues,
  splitRange,
} from "../../../src/integrations/github/search";
import { ValidationError } from "../../../src/lib/validation";
import { json, rawIssue, testHttp } from "../../helpers";

describe("Issue の読み取り", () => {
  it("repository_url から所有者とリポジトリを取り出し、PR は除く", () => {
    expect(readIssue(rawIssue(5, "acme", "web"))).toMatchObject({ number: 5, repository: { owner: "acme", name: "web" } });
    expect(readIssue(rawIssue(1, "acme", "web", { pull_request: { url: "x" } }))).toBeNull();
    expect(readSearchPage({ total_count: 2, incomplete_results: false, items: [rawIssue(1), rawIssue(2, "a", "b", { pull_request: {} })] }).issues).toHaveLength(1);
  });

  it("文字列だけのラベル、user: null、assignees なしを受け付ける", () => {
    const { assignees: _a, ...raw } = rawIssue(1, "acme", "web", { labels: ["wip"], user: null });
    expect(readIssue(raw)).toMatchObject({ labels: [{ name: "wip", color: null, description: null }], user: null, assignees: [] });
  });

  it("想定外の state や repository_url は失敗する", () => {
    expect(() => readIssue(rawIssue(1, "a", "b", { state: "merged" }))).toThrow(ValidationError);
    expect(() => parseRepositoryUrl("https://api.github.com/users/acme")).toThrow(ValidationError);
    expect(parseRepositoryUrl("https://api.github.com/repos/acme/my.repo/")).toEqual({ owner: "acme", name: "my.repo" });
  });
});

describe("検索", () => {
  it("所有者の種類で org: と user: を使い分ける", () => {
    expect(buildIssueQuery({ login: "acme", type: "Organization" })).toBe("is:issue is:open org:acme");
    expect(buildIssueQuery({ login: "me", type: "User" }, { state: "all", extra: " label:bug " })).toBe("is:issue user:me label:bug");
    expect(buildIssueQuery({ login: "me", type: "User" }, { state: "closed" }, { from: "2026-01-01", to: "2026-06-30" })).toBe(
      "is:issue is:closed user:me created:2026-01-01..2026-06-30",
    );
  });

  it("日付範囲を重ならない 2 つに分け、1 日なら分けない", () => {
    expect(splitRange({ from: "2026-01-01", to: "2026-01-10" })).toEqual([
      { from: "2026-01-01", to: "2026-01-05" },
      { from: "2026-01-06", to: "2026-01-10" },
    ]);
    expect(splitRange({ from: "2026-01-01", to: "2026-01-01" })).toBeNull();
  });

  it("1000 件の上限までページを取り、超えていれば truncated", async () => {
    const { http, calls } = testHttp((call) => {
      const page = Number(call.url.searchParams.get("page"));
      return json({ total_count: 2500, incomplete_results: false, items: Array.from({ length: 100 }, (_, i) => rawIssue(page * 1000 + i)) });
    });
    const res = await searchIssues(http, "is:issue org:acme");
    expect(calls).toHaveLength(10);
    expect(res.issues).toHaveLength(1000);
    expect(res.truncated).toBe(true);
  });

  it("1000 件を超える所有者は作成日の範囲を分けて全件を集める", async () => {
    const days = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"];
    const { http } = testHttp((call) => {
      const q = call.url.searchParams.get("q")!;
      const page = Number(call.url.searchParams.get("page"));
      const m = /created:(\S+)\.\.(\S+)/.exec(q);
      const inRange = m ? days.filter((d) => d >= m[1]! && d <= m[2]!) : days;
      const ids = inRange.flatMap((d) => Array.from({ length: 600 }, (_, i) => days.indexOf(d) * 10_000 + i));
      return json({ total_count: ids.length, incomplete_results: false, items: ids.slice((page - 1) * 100, page * 100).map((id) => rawIssue(id)) });
    });
    const res = await searchOwnerIssues(http, { login: "acme", type: "Organization" }, {}, { since: "2026-01-01", today: "2026-01-04" });
    expect(res.issues).toHaveLength(2400);
    expect(new Set(res.issues.map((i) => i.id)).size).toBe(2400);
    expect(res.truncated).toBe(false);
  });

  it("1 日で 1000 件を超えると truncated", async () => {
    const { http } = testHttp((call) => {
      const page = Number(call.url.searchParams.get("page"));
      return json({ total_count: 1500, incomplete_results: false, items: Array.from({ length: 100 }, (_, i) => rawIssue(page * 100 + i)) });
    });
    const res = await searchOwnerIssues(http, { login: "me", type: "User" }, {}, { since: "2026-01-01", today: "2026-01-01" });
    expect(res.truncated).toBe(true);
    expect(res.issues).toHaveLength(1000);
  });
});

import { describe, expect, it } from "vitest";
import { createIssuesFeature } from "../../src/features/issues/compose";
import { filterIssues, groupIssuesByRepo, type Issue } from "../../src/features/issues/issue";
import type { Owner } from "../../src/features/workspace/repository";

const issue = (id: number, repo: string, o: Partial<Issue> = {}): Issue => ({
  id, number: id, repo: { owner: repo.split("/")[0]!, name: repo.split("/")[1]! }, title: `Issue ${id}`, state: "open", stateReason: null, htmlUrl: "",
  author: { login: "alice", avatarUrl: "" }, labels: [], assignees: [], comments: 0, createdAt: "2026-01-01T00:00:00Z",
  updatedAt: `2026-01-${String(id).padStart(2, "0")}T00:00:00Z`, closedAt: null, ...o,
});
const list = [
  issue(1, "acme/web", { title: "Crash on login", labels: [{ name: "bug", color: null, description: null }] }),
  issue(2, "acme/api", { assignees: [{ login: "bob", avatarUrl: "" }] }),
  issue(3, "acme/web", { title: "Dark mode" }),
];

describe("Issue の一覧", () => {
  it("空白で区切った語をすべて含むものを残す", () => {
    expect(filterIssues(list, "bug login").map((i) => i.id)).toEqual([1]);
    expect(filterIssues(list, "BOB").map((i) => i.id)).toEqual([2]);
    expect(filterIssues(list, "#3").map((i) => i.id)).toEqual([3]);
    expect(filterIssues(list, "  ").map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("リポジトリごとにまとめ、更新の新しい順に並べる", () => {
    expect(groupIssuesByRepo(list).map((g) => [g.key, g.issues.map((i) => i.id)])).toEqual([["acme/web", [3, 1]], ["acme/api", [2]]]);
  });
});

describe("Issue の検索", () => {
  const owner = (login: string): Owner => ({ login, id: 1, type: "Organization", avatarUrl: "" });

  it("所有者ごとに順に検索し、失敗した所有者はエラーとして返す", async () => {
    const order: string[] = [];
    const f = createIssuesFeature({
      source: {
        async searchOwner(o) {
          order.push(o.login);
          if (o.login === "locked") throw new Error("forbidden");
          return { issues: [issue(1, `${o.login}/web`)], truncated: false };
        },
      },
    });
    const done: string[] = [];
    const res = await f.search([owner("acme"), owner("locked"), owner("me")], "open", { onOwnerDone: (r) => done.push(r.owner.login) });
    expect(res.map((r) => [r.owner.login, r.issues.length, r.error === null])).toEqual([["acme", 1, true], ["locked", 0, false], ["me", 1, true]]);
    expect(order).toEqual(["acme", "locked", "me"]);
    expect(done).toEqual(order);
  });
});

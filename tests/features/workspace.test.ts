import { describe, expect, it } from "vitest";
import { createWorkspaceFeature } from "../../src/features/workspace/compose";
import type { RepositorySource } from "../../src/features/workspace/ports";
import { repoKey, usageByRepo, type Identity, type Owner, type Repository } from "../../src/features/workspace/repository";
import { createOwnerSelectionStorage } from "../../src/features/workspace/gateways/storage";
import { memoryDriver } from "../../src/infrastructure/storage/drivers/memory";
import { GitHubApiError } from "../../src/integrations/github/errors";

const owner = (login: string, type: Owner["type"] = "Organization"): Owner => ({ login, id: login.length, type, avatarUrl: "" });
const repo = (o: Owner, name: string, id: number): Repository => ({
  id, owner: o, name, fullName: `${o.login}/${name}`, private: true, archived: false, htmlUrl: "", pushedAt: null, defaultBranch: "main",
});
const identity = (id: string, broad = true, login = "me"): Identity => ({ id, login, avatarUrl: "", broad });

// 認証情報ごとに見えるものが違う偽の取得元
const views: Record<string, { repos: Repository[]; orgs: Owner[] | "forbidden" } | "unauthorized"> = {
  classic: { repos: [repo(owner("me", "User"), "dotfiles", 1), repo(owner("acme"), "web", 2)], orgs: [owner("acme")] },
  fg: { repos: [repo(owner("acme"), "web", 2), repo(owner("beta"), "api", 3)], orgs: "forbidden" },
  broken: "unauthorized",
};
const source: RepositorySource = {
  async listRepositories(i) {
    const v = views[i.id]!;
    if (v === "unauthorized") throw new GitHubApiError({ kind: "unauthorized", message: "Bad credentials" });
    return v.repos;
  },
  async listOrganizations(i) {
    const v = views[i.id]!;
    if (v === "unauthorized" || v.orgs === "forbidden") throw new GitHubApiError({ kind: "forbidden", message: "no" });
    return v.orgs;
  },
};

describe("作業範囲を調べる", () => {
  const feature = createWorkspaceFeature({ source, selection: createOwnerSelectionStorage(memoryDriver()) });

  it("全所有者に使える認証情報を優先してまとめ、失敗した認証情報は別に返す", async () => {
    const ws = await feature.discover([identity("fg", false), identity("classic"), identity("broken", true, "other")]);
    expect(ws.owners.map((o) => [o.owner.login, o.owner.type, o.repoCount, o.identityId, o.isViewer])).toEqual([
      ["me", "User", 1, "classic", true],
      ["acme", "Organization", 1, "classic", false],
      ["beta", "Organization", 1, "fg", false],
    ]);
    expect(ws.repos.map((r) => [r.repo.fullName, r.identityId])).toEqual([
      ["acme/web", "classic"],
      ["beta/api", "fg"],
      ["me/dotfiles", "classic"],
    ]);
    expect(ws.failures.map((f) => [f.identity.id, (f.error as GitHubApiError).kind])).toEqual([["broken", "unauthorized"]]);
  });

  it("所有者の選択を外す・戻すと保存される", async () => {
    const driver = memoryDriver();
    const f = createWorkspaceFeature({ source, selection: createOwnerSelectionStorage(driver) });
    expect(await f.loadHiddenOwners()).toEqual([]);
    expect(await f.toggleOwner([], "Acme")).toEqual(["acme"]);
    expect(await f.loadHiddenOwners()).toEqual(["acme"]);
    expect(await f.toggleOwner(["acme"], "acme")).toEqual([]);
  });
});

describe("リポジトリの語彙", () => {
  it("リポジトリ別の合計を大きい順に", () => {
    const items = [
      { repo: { owner: "a", name: "x" }, size: 1 },
      { repo: { owner: "a", name: "y" }, size: 5 },
      { repo: { owner: "a", name: "x" }, size: 2 },
    ];
    expect(usageByRepo(items, (i) => i.repo, (i) => i.size).map((u) => [u.key, u.bytes, u.count])).toEqual([
      ["a/y", 5, 1],
      ["a/x", 3, 2],
    ]);
    expect(repoKey({ owner: "o", name: "r" })).toBe("o/r");
  });
});

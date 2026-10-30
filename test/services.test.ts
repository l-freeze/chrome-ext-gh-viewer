import { describe, expect, it } from "vitest";
import { GitHubClient } from "../src/api/client";
import { memoryStore } from "../src/platform/storage";
import {
  activeCredentials,
  inspectCredential,
  loadAuthSettings,
  maskToken,
  missingScopes,
  saveAuthSettings,
  type Credential,
} from "../src/services/credentials";
import { createClientRouter, discoverWorkspace } from "../src/services/workspace";
import { json, mockFetch, rawRepo, rawUser, recordingSleep } from "./helpers";

function credential(id: string, o: Partial<Credential> = {}): Credential {
  return {
    id,
    source: "pat",
    token: `ghp_${id}`,
    kind: "classic-pat",
    login: "me",
    avatarUrl: "",
    scopes: ["repo", "read:org"],
    expiresAt: null,
    addedAt: "2026-10-30T00:00:00.000Z",
    ...o,
  };
}

describe("credentials", () => {
  it("保存したものを読み戻す。OAuth が使えないビルドでは PAT に切り替える", async () => {
    const store = memoryStore();
    expect(await loadAuthSettings(store, true)).toEqual({ method: "oauth", credentials: [] });
    expect(await loadAuthSettings(store, false)).toEqual({ method: "pat", credentials: [] });
    await saveAuthSettings(store, { method: "oauth", credentials: [credential("a", { source: "oauth" })] });
    expect((await loadAuthSettings(store, true)).method).toBe("oauth");
    expect((await loadAuthSettings(store, false)).method).toBe("pat");
  });

  it("選んだ方式の認証情報だけを、範囲の広いものから返す", () => {
    const list = activeCredentials({
      method: "pat",
      credentials: [
        credential("fg", { kind: "fine-grained-pat", scopes: null }),
        credential("oauth", { source: "oauth", kind: "oauth" }),
        credential("classic"),
      ],
    });
    expect(list.map((c) => c.id)).toEqual(["classic", "fg"]);
  });

  it("不足スコープは上位スコープを考慮する", () => {
    expect(missingScopes({ scopes: ["repo", "read:org"] })).toEqual([]);
    expect(missingScopes({ scopes: ["repo", "admin:org"] })).toEqual([]);
    expect(missingScopes({ scopes: ["public_repo"] })).toEqual(["repo", "read:org"]);
    expect(missingScopes({ scopes: null })).toEqual([]);
  });

  it("トークンの確認結果から認証情報を作る", async () => {
    const { fetch } = mockFetch(() => json(rawUser("me"), { headers: { "x-oauth-scopes": "repo" } }));
    const c = await inspectCredential("ghp_abcd1234", "pat", new GitHubClient({ token: "ghp_abcd1234", fetch }), {
      newId: () => "id1",
      now: () => new Date("2026-10-30T00:00:00Z"),
    });
    expect(c).toMatchObject({ id: "id1", kind: "classic-pat", login: "me", scopes: ["repo"], source: "pat" });
  });

  it("トークンは先頭の種類と末尾 4 文字だけ見せる", () => {
    expect(maskToken("ghp_abcdefgh1234")).toBe("ghp_…1234");
    expect(maskToken("github_pat_11AAAA_zzzz9876")).toBe("github_pat_…9876");
  });
});

describe("discoverWorkspace / createClientRouter", () => {
  // トークンごとに見えるリポジトリと Org が違う偽 API
  const views: Record<string, { repos: unknown[]; orgs: unknown[] | "forbidden" }> = {
    ghp_classic: {
      repos: [rawRepo("me", "dotfiles", "User", 1), rawRepo("acme", "web", "Organization", 2)],
      orgs: [{ login: "acme", id: 10, avatar_url: "a", description: null }],
    },
    github_pat_fg: {
      repos: [rawRepo("acme", "web", "Organization", 2), rawRepo("beta", "api", "Organization", 3)],
      orgs: "forbidden",
    },
    ghp_broken: { repos: [], orgs: [] },
  };

  function setup() {
    const { sleep } = recordingSleep();
    const calls: Array<{ token: string; path: string }> = [];
    const clientFor = (c: Credential) => {
      const { fetch } = mockFetch((call) => {
        const token = call.headers.get("authorization")!.replace("Bearer ", "");
        calls.push({ token, path: call.url.pathname });
        if (token === "ghp_broken") return json({ message: "Bad credentials" }, { status: 401 });
        const view = views[token]!;
        if (call.url.pathname === "/user/repos") return json(view.repos);
        if (call.url.pathname === "/user/orgs")
          return view.orgs === "forbidden" ? json({ message: "Forbidden" }, { status: 403 }) : json(view.orgs);
        return json({ total_count: 0, artifacts: [] });
      });
      return new GitHubClient({ token: c.token, fetch, sleep });
    };
    return { clientFor, calls };
  }

  const creds = [
    credential("classic", { token: "ghp_classic" }),
    credential("fg", { token: "github_pat_fg", kind: "fine-grained-pat", scopes: null }),
    credential("broken", { token: "ghp_broken", login: "other" }),
  ];

  it("認証情報ごとの結果をまとめ、失敗した認証情報は別に返す", async () => {
    const { clientFor } = setup();
    const ws = await discoverWorkspace(creds, clientFor);
    expect(ws.owners.map((o) => [o.owner.login, o.owner.type, o.repoCount, o.credentialId, o.isViewer])).toEqual([
      ["me", "User", 1, "classic", true],
      ["acme", "Organization", 1, "classic", false],
      ["beta", "Organization", 1, "fg", false],
    ]);
    expect(ws.repos.map((r) => [r.repo.fullName, r.credentialId])).toEqual([
      ["acme/web", "classic"],
      ["beta/api", "fg"],
      ["me/dotfiles", "classic"],
    ]);
    expect(ws.failures.map((f) => [f.credential.id, f.error.kind])).toEqual([["broken", "unauthorized"]]);
  });

  it("リポジトリ・所有者ごとに、見つけた認証情報のクライアントを使う", async () => {
    const { clientFor, calls } = setup();
    const ws = await discoverWorkspace(creds, clientFor);
    const router = createClientRouter(ws, creds, clientFor);
    calls.length = 0;
    await router.forRepo({ owner: "beta", name: "api" }).listRepoArtifacts({ owner: "beta", name: "api" });
    await router.forRepo({ owner: "ACME", name: "Web" }).listRepoArtifacts({ owner: "acme", name: "web" });
    await router.forOwner({ login: "beta" }).listMyOrganizations().catch(() => undefined);
    expect(calls.map((c) => c.token)).toEqual(["github_pat_fg", "ghp_classic", "github_pat_fg"]);
  });
});

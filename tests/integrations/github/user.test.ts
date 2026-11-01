import { describe, expect, it } from "vitest";
import { GitHubApiError } from "../../../src/integrations/github/errors";
import {
  inspectToken,
  listMyOrganizations,
  listMyRepositories,
  parseTokenExpiration,
  readAccount,
  readRepository,
  splitScopes,
  tokenKindFromPrefix,
} from "../../../src/integrations/github/user";
import { ValidationError } from "../../../src/lib/validation";
import { json, rawRepo, rawUser, testHttp } from "../../helpers";

describe("アカウントとリポジトリの読み取り", () => {
  it("type がなければ User、指定があればそれにする", () => {
    const { type: _t, ...noType } = rawUser("acme");
    expect(readAccount(noType).type).toBe("User");
    expect(readAccount(noType, "org", "Organization").type).toBe("Organization");
  });

  it("必須の項目が欠けていればどこかを示して失敗する", () => {
    const { full_name: _f, ...broken } = rawRepo("acme", "web");
    expect(() => readRepository(broken)).toThrow(ValidationError);
    expect(() => readRepository(broken)).toThrow("repo.full_name: expected string, got undefined");
  });
});

describe("API 呼び出し", () => {
  it("listMyRepositories は全所属のリポジトリを 100 件ずつ取得する", async () => {
    const { http, calls } = testHttp(() => json([rawRepo("me", "a"), rawRepo("acme", "b", "Organization")]));
    expect((await listMyRepositories(http)).map((r) => r.full_name)).toEqual(["me/a", "acme/b"]);
    expect(calls[0]!.url.pathname).toBe("/user/repos");
    expect(calls[0]!.url.searchParams.get("affiliation")).toBe("owner,collaborator,organization_member");
    expect(calls[0]!.url.searchParams.get("per_page")).toBe("100");
  });

  it("listMyOrganizations は Organization として返す", async () => {
    const { http } = testHttp(() => json([{ login: "acme", id: 2, avatar_url: "a", description: null }]));
    expect(await listMyOrganizations(http)).toEqual([{ login: "acme", id: 2, type: "Organization", avatar_url: "a" }]);
  });

  it("形の違う応答は kind: decode のエラーにする", async () => {
    const { http } = testHttp(() => json([{ id: "x" }]));
    const err = await listMyRepositories(http).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect((err as GitHubApiError).kind).toBe("decode");
    expect((err as GitHubApiError).message).toContain("repos[0].id");
  });

  it("inspectToken はスコープと有効期限をヘッダーから読む", async () => {
    const { http } = testHttp(() =>
      json(rawUser("me"), {
        headers: { "x-oauth-scopes": "repo, read:org", "github-authentication-token-expiration": "2026-11-30 12:34:56 UTC" },
      }),
    );
    expect(await inspectToken(http, "ghp_abc")).toEqual({
      kind: "classic-pat",
      user: { login: "me", id: 1, type: "User", avatar_url: "https://avatars.example/me" },
      scopes: ["repo", "read:org"],
      expiresAt: "2026-11-30T12:34:56.000Z",
    });
  });

  it("スコープを持たないトークンは、空の X-OAuth-Scopes が付いていてもスコープを null にする", async () => {
    // GitHub App のユーザートークンで、空の X-OAuth-Scopes が返ることを確認済み
    const { http } = testHttp(() => json(rawUser("me"), { headers: { "x-oauth-scopes": "" } }));
    const info = await inspectToken(http, "github_pat_abc");
    expect(info.kind).toBe("fine-grained-pat");
    expect(info.scopes).toBeNull();
    expect(info.expiresAt).toBeNull();
  });
});

describe("トークンの情報", () => {
  it.each([
    ["ghp_x", "classic-pat"],
    ["github_pat_x", "fine-grained-pat"],
    ["gho_x", "oauth"],
    ["ghu_x", "github-app-user"],
    ["abc", "unknown"],
  ] as const)("%s → %s", (token, kind) => {
    expect(tokenKindFromPrefix(token)).toBe(kind);
  });

  it.each([
    ["2026-11-30 12:34:56 UTC", "2026-11-30T12:34:56.000Z"],
    ["2026-11-30 21:34:56 +0900", "2026-11-30T12:34:56.000Z"],
    ["2026-11-30T12:34:56Z", "2026-11-30T12:34:56.000Z"],
    ["garbage", null],
    [null, null],
  ] as const)("有効期限 %s → %s", (input, expected) => {
    expect(parseTokenExpiration(input)).toBe(expected);
  });

  it("スコープの区切りの揺れを吸収する", () => {
    expect(splitScopes("repo, read:org,  ")).toEqual(["repo", "read:org"]);
    expect(splitScopes("")).toEqual([]);
  });
});

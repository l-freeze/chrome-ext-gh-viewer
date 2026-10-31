import { describe, expect, it } from "vitest";
import { parseTokenExpiration, tokenKindFromPrefix } from "../src/api/client";
import { GitHubApiError } from "../src/api/errors";
import { json, rawArtifact, rawIssue, rawRepo, rawUser, testClient } from "./helpers";

describe("GitHubClient", () => {
  it("listMyRepositories は全所属のリポジトリを 100 件ずつ取得する", async () => {
    const { client, calls } = testClient(() => json([rawRepo("me", "a"), rawRepo("acme", "b", "Organization")]));
    const repos = await client.listMyRepositories();
    expect(repos.map((r) => r.fullName)).toEqual(["me/a", "acme/b"]);
    const q = calls[0]!.url.searchParams;
    expect(calls[0]!.url.pathname).toBe("/user/repos");
    expect(q.get("affiliation")).toBe("owner,collaborator,organization_member");
    expect(q.get("per_page")).toBe("100");
  });

  it("listMyOrganizations は Organization として返す", async () => {
    const { client } = testClient(() => json([{ login: "acme", id: 2, avatar_url: "a", description: null }]));
    expect(await client.listMyOrganizations()).toEqual([{ login: "acme", id: 2, type: "Organization", avatarUrl: "a" }]);
  });

  it("listRepoArtifacts は複数ページを結合し、リポジトリ情報を付ける", async () => {
    const { client, calls } = testClient((call) =>
      call.url.searchParams.get("page") === "2"
        ? json({ total_count: 3, artifacts: [rawArtifact(3)] })
        : json(
            { total_count: 3, artifacts: [rawArtifact(1), rawArtifact(2)] },
            { headers: { link: '<https://api.github.com/repos/acme/my%20repo/actions/artifacts?per_page=100&page=2>; rel="next"' } },
          ),
    );
    const artifacts = await client.listRepoArtifacts({ owner: "acme", name: "my repo" });
    expect(artifacts.map((a) => a.id)).toEqual([1, 2, 3]);
    expect(artifacts[0]!.repo).toEqual({ owner: "acme", name: "my repo" });
    expect(calls[0]!.url.pathname).toBe("/repos/acme/my%20repo/actions/artifacts");
  });

  it("想定外の形のレスポンスは kind: decode のエラーにする", async () => {
    const { client } = testClient(() => json({ total_count: 1, artifacts: [{ id: "x" }] }));
    const err = await client.listRepoArtifacts({ owner: "a", name: "b" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubApiError);
    expect((err as GitHubApiError).kind).toBe("decode");
    expect((err as GitHubApiError).message).toContain("artifacts.artifacts[0].id");
  });

  it("deleteArtifact は DELETE を送る", async () => {
    const { client, calls } = testClient(() => new Response(null, { status: 204 }));
    await client.deleteArtifact({ id: 42, repo: { owner: "acme", name: "web" } });
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url.pathname).toBe("/repos/acme/web/actions/artifacts/42");
  });

  it("artifactDownloadRequest は chrome.downloads 用の URL とヘッダーを返す", () => {
    const { client } = testClient(() => json({}));
    const req = client.artifactDownloadRequest({ id: 7, repo: { owner: "acme", name: "web" } });
    expect(req.url).toBe("https://api.github.com/repos/acme/web/actions/artifacts/7/zip");
    expect(req.headers).toContainEqual({ name: "Authorization", value: "Bearer ghp_test" });
  });

  it("inspectToken はスコープと有効期限をヘッダーから読む", async () => {
    const { client } = testClient(() =>
      json(rawUser("me"), {
        headers: {
          "x-oauth-scopes": "repo, read:org",
          "github-authentication-token-expiration": "2026-11-30 12:34:56 UTC",
        },
      }),
    );
    expect(await client.inspectToken("ghp_abc")).toEqual({
      kind: "classic-pat",
      user: { login: "me", id: 1, type: "User", avatarUrl: "https://avatars.example/me" },
      scopes: ["repo", "read:org"],
      expiresAt: "2026-11-30T12:34:56.000Z",
    });
  });

  it("inspectToken は Fine-grained PAT ならスコープを null にする（空の X-OAuth-Scopes が付いていても）", async () => {
    // GitHub App のユーザートークンでは空の X-OAuth-Scopes が返ることを確認済み。Fine-grained PAT も同様でも誤判定しないこと
    const { client } = testClient(() => json(rawUser("me"), { headers: { "x-oauth-scopes": "" } }));
    const info = await client.inspectToken("github_pat_abc");
    expect(info.kind).toBe("fine-grained-pat");
    expect(info.scopes).toBeNull();
    expect(info.expiresAt).toBeNull();
  });

  it("searchIssues は 1000 件の上限までページを取り、超えていれば truncated", async () => {
    const { client, calls } = testClient((call) => {
      const page = Number(call.url.searchParams.get("page"));
      const items = Array.from({ length: 100 }, (_, i) => rawIssue(page * 1000 + i));
      return json({ total_count: 2500, incomplete_results: false, items });
    });
    const res = await client.searchIssues("is:issue org:acme");
    expect(calls).toHaveLength(10);
    expect(res.issues).toHaveLength(1000);
    expect(res.truncated).toBe(true);
    expect(calls[0]!.url.searchParams.get("q")).toBe("is:issue org:acme");
    expect(calls[0]!.url.searchParams.get("sort")).toBe("updated");
  });

  it("searchIssues は件数分だけページを取る", async () => {
    const { client, calls } = testClient((call) => {
      const page = Number(call.url.searchParams.get("page"));
      const n = page === 1 ? 100 : 50;
      return json({ total_count: 150, incomplete_results: page === 2, items: Array.from({ length: n }, (_, i) => rawIssue(page * 1000 + i)) });
    });
    const res = await client.searchIssues("q");
    expect(calls).toHaveLength(2);
    expect(res.issues).toHaveLength(150);
    expect(res.truncated).toBe(false);
    expect(res.incomplete).toBe(true);
  });
});

describe("tokenKindFromPrefix", () => {
  it.each([
    ["ghp_x", "classic-pat"],
    ["github_pat_x", "fine-grained-pat"],
    ["gho_x", "oauth"],
    ["ghu_x", "github-app-user"],
    ["abc", "unknown"],
  ] as const)("%s → %s", (token, kind) => {
    expect(tokenKindFromPrefix(token)).toBe(kind);
  });
});

describe("parseTokenExpiration", () => {
  it.each([
    ["2026-11-30 12:34:56 UTC", "2026-11-30T12:34:56.000Z"],
    ["2026-11-30 21:34:56 +0900", "2026-11-30T12:34:56.000Z"],
    ["2026-11-30T12:34:56Z", "2026-11-30T12:34:56.000Z"],
    ["garbage", null],
    [null, null],
  ] as const)("%s → %s", (input, expected) => {
    expect(parseTokenExpiration(input)).toBe(expected);
  });
});

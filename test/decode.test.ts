import { describe, expect, it } from "vitest";
import {
  decodeAccessTokenResponse,
  decodeArtifact,
  decodeIssue,
  decodeIssueSearchPage,
  decodeOrganization,
  decodeOwner,
  decodeRepository,
  parseRepositoryUrl,
  splitScopes,
} from "../src/api/decode";
import { DecodeError } from "../src/api/errors";
import { rawArtifact, rawIssue, rawRepo, rawUser } from "./helpers";

describe("decodeOwner / decodeOrganization", () => {
  it("Organization 以外の type は User 扱いにする", () => {
    expect(decodeOwner(rawUser("bot", "Bot")).type).toBe("User");
    expect(decodeOwner(rawUser("acme", "Organization")).type).toBe("Organization");
  });

  it("/user/orgs の要素は type がなくても Organization になる", () => {
    const { type: _t, ...noType } = rawUser("acme");
    expect(decodeOrganization(noType)).toEqual({
      login: "acme",
      id: 1,
      type: "Organization",
      avatarUrl: "https://avatars.example/acme",
    });
  });
});

describe("decodeRepository", () => {
  it("必要なフィールドをキャメルケースに変換する", () => {
    expect(decodeRepository(rawRepo("acme", "web", "Organization"))).toMatchObject({
      id: 100,
      name: "web",
      fullName: "acme/web",
      owner: { login: "acme", type: "Organization" },
      private: true,
      archived: false,
      pushedAt: "2026-10-01T00:00:00Z",
    });
  });

  it("必須フィールドが欠けていればパス付きの DecodeError を投げる", () => {
    const { full_name: _f, ...broken } = rawRepo("acme", "web");
    expect(() => decodeRepository(broken)).toThrow(DecodeError);
    expect(() => decodeRepository(broken)).toThrow("repo.full_name: expected string, got undefined");
  });
});

describe("decodeArtifact", () => {
  const repo = { owner: "acme", name: "web" };

  it("リポジトリ情報を付けて変換する", () => {
    expect(decodeArtifact(rawArtifact(3), repo)).toEqual({
      id: 3,
      repo,
      name: "build-3",
      sizeInBytes: 3072,
      expired: false,
      createdAt: "2026-09-01T00:00:00Z",
      expiresAt: "2026-11-30T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      digest: "sha256:abc",
      workflowRun: { id: 9, headBranch: "main", headSha: "deadbeef" },
    });
  });

  it("null になりうる日付・workflow_run・digest を受け付ける", () => {
    const raw = { ...rawArtifact(1), created_at: null, expires_at: null, updated_at: null, workflow_run: null };
    const { digest: _d, ...noDigest } = raw;
    const a = decodeArtifact(noDigest, repo);
    expect(a.createdAt).toBeNull();
    expect(a.expiresAt).toBeNull();
    expect(a.workflowRun).toBeNull();
    expect(a.digest).toBeNull();
  });

  it("size_in_bytes が数値でなければエラー", () => {
    expect(() => decodeArtifact({ ...rawArtifact(1), size_in_bytes: "1" }, repo)).toThrow(
      "artifact.size_in_bytes: expected number, got string",
    );
  });
});

describe("decodeIssue", () => {
  it("repository_url から所有者とリポジトリを取り出す", () => {
    const issue = decodeIssue(rawIssue(5, "acme", "web"));
    expect(issue).toMatchObject({
      number: 5,
      repo: { owner: "acme", name: "web" },
      state: "open",
      author: { login: "alice" },
      labels: [{ name: "bug", color: "d73a4a", description: "Something isn't working" }],
      assignees: [{ login: "bob" }],
    });
  });

  it("PR は null を返す", () => {
    expect(decodeIssue(rawIssue(1, "acme", "web", { pull_request: { url: "x" } }))).toBeNull();
  });

  it("文字列だけのラベル、user: null、assignees なしを受け付ける", () => {
    const { assignees: _a, ...raw } = rawIssue(1, "acme", "web", { labels: ["wip"], user: null });
    const issue = decodeIssue(raw)!;
    expect(issue.labels).toEqual([{ name: "wip", color: null, description: null }]);
    expect(issue.author).toBeNull();
    expect(issue.assignees).toEqual([]);
  });

  it("想定外の state はエラー", () => {
    expect(() => decodeIssue(rawIssue(1, "a", "b", { state: "merged" }))).toThrow(DecodeError);
  });

  it("検索結果から PR を除く", () => {
    const page = decodeIssueSearchPage({
      total_count: 2,
      incomplete_results: false,
      items: [rawIssue(1), rawIssue(2, "acme", "web", { pull_request: {} })],
    });
    expect(page.issues.map((i) => i.id)).toEqual([1]);
    expect(page.totalCount).toBe(2);
  });
});

describe("parseRepositoryUrl", () => {
  it("末尾のスラッシュやエンコードされた名前を扱う", () => {
    expect(parseRepositoryUrl("https://api.github.com/repos/acme/my.repo/")).toEqual({ owner: "acme", name: "my.repo" });
    expect(parseRepositoryUrl("https://ghe.example/api/v3/repos/a/b")).toEqual({ owner: "a", name: "b" });
  });

  it("形が違えばエラー", () => {
    expect(() => parseRepositoryUrl("https://api.github.com/users/acme")).toThrow(DecodeError);
  });
});

describe("decodeAccessTokenResponse", () => {
  it("成功時はスコープを配列にする", () => {
    expect(decodeAccessTokenResponse({ access_token: "gho_x", token_type: "bearer", scope: "repo,read:org" })).toEqual({
      ok: true,
      token: { accessToken: "gho_x", tokenType: "bearer", scopes: ["repo", "read:org"] },
    });
  });

  it("エラー時は error と interval を返す", () => {
    expect(decodeAccessTokenResponse({ error: "slow_down", interval: 10 })).toEqual({
      ok: false,
      error: "slow_down",
      description: null,
      interval: 10,
    });
  });
});

describe("splitScopes", () => {
  it("空白やカンマの揺れを吸収する", () => {
    expect(splitScopes("repo, read:org,  ")).toEqual(["repo", "read:org"]);
    expect(splitScopes("")).toEqual([]);
  });
});

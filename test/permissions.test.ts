import { describe, expect, it } from "vitest";
import { GitHubApiError } from "../src/api/errors";
import { GitHubHttp, parseAcceptedPermissions, parseAcceptedScopes } from "../src/api/http";
import { describePermission, permissionHint } from "../src/domain/permissions";
import { json, mockFetch, recordingSleep } from "./helpers";

describe("権限のヘッダーを読む", () => {
  it("X-Accepted-GitHub-Permissions の組を分ける", () => {
    expect(parseAcceptedPermissions("contents=read")).toEqual([["contents=read"]]);
    expect(parseAcceptedPermissions("contents=read, metadata=read; actions=write")).toEqual([
      ["contents=read", "metadata=read"],
      ["actions=write"],
    ]);
    // 権限の要らない旨だけの値は案内に使わない
    expect(parseAcceptedPermissions("allows_permissionless_access=true")).toBeUndefined();
    expect(parseAcceptedPermissions(null)).toBeUndefined();
  });

  it("X-Accepted-OAuth-Scopes を分ける", () => {
    expect(parseAcceptedScopes("repo, public_repo")).toEqual(["repo", "public_repo"]);
    expect(parseAcceptedScopes("")).toBeUndefined();
  });

  it("403 のエラーに必要な権限を載せる", async () => {
    const { fetch } = mockFetch(() =>
      json(
        { message: "Resource not accessible by personal access token" },
        { status: 403, headers: { "x-accepted-github-permissions": "contents=read", "x-accepted-oauth-scopes": "repo" } },
      ),
    );
    const http = new GitHubHttp({ token: "t", fetch, sleep: recordingSleep().sleep });
    const err = await http.request("/x").then(
      () => {
        throw new Error("expected rejection");
      },
      (e: unknown) => e as GitHubApiError,
    );
    expect(err.kind).toBe("forbidden");
    expect(err.acceptedPermissions).toEqual([["contents=read"]]);
    expect(err.acceptedScopes).toEqual(["repo"]);
  });
});

describe("permissionHint", () => {
  const error = (kind: GitHubApiError["kind"], extra: Partial<ConstructorParameters<typeof GitHubApiError>[0]> = {}) =>
    new GitHubApiError({ kind, message: "x", ...extra });

  it("GitHub が教えてくれた権限を優先する", () => {
    expect(
      permissionHint(error("forbidden", { acceptedPermissions: [["contents=read"]], acceptedScopes: ["repo"] }), "workflow.dispatch"),
    ).toEqual({ fineGrained: [["contents=read"]], classic: ["repo"], fromGitHub: true });
  });

  it("ヘッダーがなければ操作ごとの要件で補う", () => {
    expect(permissionHint(error("forbidden"), "workflow.dispatch")).toEqual({
      fineGrained: [["actions=write"]],
      classic: ["repo"],
      fromGitHub: false,
    });
    expect(permissionHint(error("not_found"), "workflow.read")?.fineGrained).toEqual([["contents=read"]]);
  });

  it("権限と関係ないエラーでは案内しない", () => {
    expect(permissionHint(error("rate_limited"), "artifacts.list")).toBeNull();
    expect(permissionHint(error("network"), "artifacts.list")).toBeNull();
  });

  it("権限名を画面の表記にする", () => {
    expect(describePermission("contents=read")).toEqual({ name: "Contents", level: "read" });
    expect(describePermission("pull_requests=write")).toEqual({ name: "Pull requests", level: "write" });
  });
});

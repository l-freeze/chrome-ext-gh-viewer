import { describe, expect, it } from "vitest";
import { compareSettings, differsFromMajority, rowDiffers } from "../../src/features/repo-settings/comparison";
import { createRepoSettingsFeature } from "../../src/features/repo-settings/compose";
import { createGitHubRepoSettingsSource } from "../../src/features/repo-settings/gateways/github";
import { known, SETTINGS, UNKNOWN, type RepoSettings, type SettingKey, type SettingValue } from "../../src/features/repo-settings/settings";
import type { Repository } from "../../src/features/workspace/repository";
import { json, testHttp } from "../helpers";

const repo = (name: string, o: Partial<Repository> = {}): Repository => ({
  id: name.length, owner: { login: "acme", id: 1, type: "Organization", avatarUrl: "" }, name, fullName: `acme/${name}`,
  private: true, archived: false, htmlUrl: `https://github.com/acme/${name}`, pushedAt: null, defaultBranch: "main", ...o,
});
const settings = (name: string, values: Partial<Record<SettingKey, SettingValue>>): RepoSettings => ({
  repo: { owner: "acme", name },
  values: { ...(Object.fromEntries(SETTINGS.map((s) => [s.key, UNKNOWN])) as Record<SettingKey, SettingValue>), ...values },
});
const details = (o: Record<string, unknown> = {}) => ({
  id: 1, name: "web", full_name: "acme/web", visibility: "private", default_branch: "main",
  has_issues: true, has_projects: false, has_wiki: false, has_discussions: false,
  allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: false, allow_auto_merge: true,
  delete_branch_on_merge: true, allow_update_branch: true, web_commit_signoff_required: false, ...o,
});

describe("設定の違い", () => {
  const list = [
    settings("web", { squashMerge: known(true), deleteBranchOnMerge: known(true), visibility: known("private") }),
    settings("api", { squashMerge: known(true), deleteBranchOnMerge: known(false), visibility: known("private") }),
    settings("cli", { squashMerge: known(false), deleteBranchOnMerge: known(true), visibility: known("private") }),
    settings("old", { squashMerge: UNKNOWN, deleteBranchOnMerge: known(true), visibility: known("private") }),
  ];
  const c = compareSettings(list);
  const col = (key: SettingKey) => c.columns.find((x) => x.key === key)!;

  it("行はリポジトリの名前順、列は決まった順の設定", () => {
    expect(c.rows.map((r) => r.repo.name)).toEqual(["api", "cli", "old", "web"]);
    expect(c.columns.map((x) => x.key)).toEqual(SETTINGS.map((s) => s.key));
  });

  it("設定ごとに、読めた値でいちばん多いものと違うリポジトリを数える。読めなかったものは数えない", () => {
    expect(col("squashMerge")).toMatchObject({ majority: known(true), uniform: false, differing: 1 });
    expect(col("deleteBranchOnMerge")).toMatchObject({ majority: known(true), uniform: false, differing: 1 });
    expect(col("visibility")).toMatchObject({ uniform: true, differing: 0 });
    expect(col("wiki")).toMatchObject({ majority: null, uniform: true, differing: 0 });
    expect(differsFromMajority(UNKNOWN, col("squashMerge"))).toBe(false);
    expect(differsFromMajority(known(false), col("squashMerge"))).toBe(true);
    expect(c.rows.map((r) => rowDiffers(r, c.columns))).toEqual([true, true, false, false]);
  });
});

describe("GitHub から読む", () => {
  it("リポジトリ・既定のブランチ・ブランチのルールの 3 回で読み、ルールと従来の保護をまとめる", async () => {
    const { http, calls } = testHttp((c) => {
      const p = c.url.pathname;
      if (p === "/repos/acme/web") return json(details());
      if (p === "/repos/acme/web/branches/main")
        return json({ name: "main", protected: true, protection: { enabled: true, required_status_checks: { enforcement_level: "everyone", contexts: ["lint"] } } });
      if (p === "/repos/acme/web/rules/branches/main")
        return json([
          { type: "pull_request", parameters: { required_approving_review_count: 1 } },
          { type: "required_status_checks", parameters: { required_status_checks: [{ context: "test" }, { context: "lint" }] } },
          { type: "non_fast_forward" },
          { type: "deletion" },
        ]);
      return json({ message: "Not Found" }, { status: 404 });
    });
    const f = createRepoSettingsFeature({ source: createGitHubRepoSettingsSource(() => http) });
    const [res] = await f.list([repo("web")]);
    const v = res!.ok ? res!.value!.values : null;
    expect(v).toMatchObject({
      visibility: known("private"), defaultBranch: known("main"), squashMerge: known(true), mergeCommit: known(false),
      protected: known(true), requirePullRequest: known(1), requiredChecks: known("lint, test"),
      blockForcePush: known(true), restrictDeletion: known(true), linearHistory: known(false), signedCommits: known(false),
    });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`).sort()).toEqual([
      "GET /repos/acme/web", "GET /repos/acme/web/branches/main", "GET /repos/acme/web/rules/branches/main",
    ]);
  });

  it("返らない設定は読めないとし、プランで使えない保護は使えないとする。アーカイブ済みと既定のブランチの無いリポジトリは呼び出しを減らす", async () => {
    const upgrade = () => json({ message: "Upgrade to GitHub Pro or make this repository public to enable this feature." }, { status: 403 });
    const { http, calls } = testHttp((c) => {
      const p = c.url.pathname;
      if (p === "/repos/acme/free") return json(details({ allow_squash_merge: undefined, allow_auto_merge: undefined }));
      if (p === "/repos/acme/free/branches/main") return json({ name: "main", protected: false, protection: { enabled: false, required_status_checks: { enforcement_level: "off", contexts: [] } } });
      if (p === "/repos/acme/free/rules/branches/main") return upgrade();
      if (p === "/repos/acme/empty") return json(details({ default_branch: null }));
      return json({ message: "Not Found" }, { status: 404 });
    });
    const f = createRepoSettingsFeature({ source: createGitHubRepoSettingsSource(() => http) });
    const [free, empty, old] = await f.list([repo("free"), repo("empty", { defaultBranch: null }), repo("old", { archived: true })]);
    const v = free!.ok ? free!.value!.values : null;
    expect(v?.squashMerge).toEqual({ kind: "unknown" });
    expect(v?.autoMerge).toEqual({ kind: "unknown" });
    expect(v?.protected).toEqual(known(false));
    expect(v?.requirePullRequest).toEqual({ kind: "unavailable" });
    expect(v?.requiredChecks).toEqual({ kind: "unavailable" });
    expect(empty!.ok && empty!.value!.values.protected).toEqual({ kind: "unknown" });
    expect(old!.ok && old!.value).toBe(null);
    expect(calls.filter((c) => c.url.pathname.startsWith("/repos/acme/empty")).length).toBe(1);
    expect(calls.filter((c) => c.url.pathname.startsWith("/repos/acme/old")).length).toBe(0);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("リポジトリ自体を読めなければ、そのリポジトリだけ失敗にする", async () => {
    const { http } = testHttp(() => json({ message: "Resource not accessible" }, { status: 403 }));
    const f = createRepoSettingsFeature({ source: createGitHubRepoSettingsSource(() => http) });
    const [res] = await f.list([repo("locked")]);
    expect(res!.ok).toBe(false);
  });
});

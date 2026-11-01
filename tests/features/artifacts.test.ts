import { describe, expect, it } from "vitest";
import { downloadFilename, expiryState, isExpired, type Artifact } from "../../src/features/artifacts/artifact";
import { createArtifactsFeature } from "../../src/features/artifacts/compose";
import { createGitHubArtifactSource } from "../../src/features/artifacts/gateways/github";
import { DEFAULT_ARTIFACT_FILTER, filterArtifacts, sortArtifacts, summarizeArtifacts } from "../../src/features/artifacts/listing";
import type { ArtifactSource, Downloader } from "../../src/features/artifacts/ports";
import type { Repository } from "../../src/features/workspace/repository";
import { DAY_MS } from "../../src/lib/time";
import { json, testHttp } from "../helpers";

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const MB = 1024 * 1024;

function artifact(id: number, o: Partial<Artifact> & { ageDays?: number; expiresInDays?: number } = {}): Artifact {
  const { ageDays = 1, expiresInDays = 60, ...rest } = o;
  return {
    id, repo: { owner: "acme", name: "web" }, name: `a-${id}`, sizeInBytes: MB, expired: false,
    createdAt: new Date(NOW - ageDays * DAY_MS).toISOString(), expiresAt: new Date(NOW + expiresInDays * DAY_MS).toISOString(),
    updatedAt: null, digest: null, workflowRun: { id: 1, headBranch: "main", headSha: null }, ...rest,
  };
}
const repo = (name: string, id: number): Repository => ({
  id, owner: { login: "acme", id: 1, type: "Organization", avatarUrl: "" }, name, fullName: `acme/${name}`, private: true, archived: false, htmlUrl: "", pushedAt: null, defaultBranch: "main",
});

describe("期限", () => {
  it("expired フラグか、期限を過ぎていれば期限切れ", () => {
    expect(isExpired(artifact(1, { expired: true }), NOW)).toBe(true);
    expect(isExpired(artifact(1, { expiresInDays: -1 }), NOW)).toBe(true);
    expect(isExpired(artifact(1, { expiresAt: null }), NOW)).toBe(false);
  });

  it("残り日数は暦日で数える（24 時間未満でも翌日なら明日）", () => {
    expect(expiryState(artifact(1, { expiresAt: new Date(2026, 9, 31, 9).toISOString() }), NOW)).toEqual({ kind: "tomorrow" });
    expect(expiryState(artifact(1, { expiresAt: new Date(2026, 9, 30, 23).toISOString() }), NOW)).toEqual({ kind: "today" });
    expect(expiryState(artifact(1, { expiresAt: new Date(2026, 10, 9, 1).toISOString() }), NOW)).toEqual({ kind: "days", days: 10 });
    expect(expiryState(artifact(1, { expiresAt: null }), NOW)).toEqual({ kind: "unknown" });
  });

  it("ファイル名に使えない文字を置き換える", () => {
    expect(downloadFilename(artifact(7, { name: 'report: a/b*"c"' }))).toBe("acme-web-report_ a_b_c_-7.zip");
  });
});

describe("一覧", () => {
  const list = [
    artifact(1, { ageDays: 5, sizeInBytes: 10 * MB }),
    artifact(2, { ageDays: 40, sizeInBytes: 200 * MB, repo: { owner: "acme", name: "api" } }),
    artifact(3, { ageDays: 100, expired: true, repo: { owner: "me", name: "dotfiles" } }),
    artifact(4, { createdAt: null }),
  ];
  const ids = (f: Partial<typeof DEFAULT_ARTIFACT_FILTER>) => filterArtifacts(list, { ...DEFAULT_ARTIFACT_FILTER, ...f }, NOW).map((a) => a.id);

  it("リポジトリ・日数・サイズ・状態で絞り込む", () => {
    expect(ids({})).toEqual([1, 2, 3, 4]);
    expect(ids({ repoQuery: " ACME/a " })).toEqual([2]);
    expect(ids({ olderThanDays: 30 })).toEqual([2, 3]);
    expect(ids({ minSizeMB: 100 })).toEqual([2]);
    expect(ids({ status: "active" })).toEqual([1, 2, 4]);
    expect(ids({ status: "expired" })).toEqual([3]);
  });

  it("値のないものは末尾", () => {
    expect(sortArtifacts(list, { key: "created", dir: "desc" }).map((a) => a.id)).toEqual([1, 2, 3, 4]);
  });

  it("期限切れを保存量から除き、古いものを大きい順に、リポジトリ別に集計する", () => {
    const s = summarizeArtifacts(
      [
        artifact(1, { ageDays: 40, sizeInBytes: 100 * MB }),
        artifact(2, { ageDays: 50, sizeInBytes: 300 * MB, repo: { owner: "acme", name: "api" } }),
        artifact(3, { ageDays: 2, sizeInBytes: 50 * MB, expiresInDays: 3 }),
        artifact(4, { ageDays: 90, sizeInBytes: 999 * MB, expired: true, repo: { owner: "me", name: "x" } }),
      ],
      NOW,
    );
    expect([s.liveBytes / MB, s.liveCount, s.expiredCount, s.reposWithArtifacts]).toEqual([450, 3, 1, 3]);
    expect(s.stale.map((a) => a.id)).toEqual([2, 1]);
    expect(s.expiringSoon.map((a) => a.id)).toEqual([3]);
    expect(s.byRepo.map((r) => [r.key, r.bytes / MB, r.count])).toEqual([["acme/api", 300, 1], ["acme/web", 150, 2]]);
  });
});

describe("操作", () => {
  const started: Array<{ url: string; filename: string }> = [];
  const downloader: Downloader = { start: async (r) => (started.push(r), started.length), onInterrupted: () => () => undefined };

  it("リポジトリごとに集め、失敗したリポジトリはエラーとして返す", async () => {
    const source: ArtifactSource = {
      list: async (r) => (r.name === "locked" ? Promise.reject(new Error("forbidden")) : [artifact(1, { repo: r })]),
      remove: async () => undefined,
      downloadRequest: () => ({ url: "u", headers: [] }),
    };
    const res = await createArtifactsFeature({ source, downloader }).list([repo("a", 1), repo("locked", 2)]);
    expect(res.map((r) => r.ok)).toEqual([true, false]);
  });

  it("ダウンロードは取得先とファイル名を渡す", async () => {
    const source: ArtifactSource = { list: async () => [], remove: async () => undefined, downloadRequest: (a) => ({ url: `zip/${a.id}`, headers: [] }) };
    await createArtifactsFeature({ source, downloader }).download(artifact(9));
    expect(started.at(-1)).toMatchObject({ url: "zip/9", filename: "acme-web-a-9-9.zip" });
  });

  it("GitHub 経由の削除では、すでに消えているもの（404）を成功とみなす", async () => {
    const { http } = testHttp((call) =>
      call.url.pathname.endsWith("/2") ? json({ message: "Not Found" }, { status: 404 }) : call.url.pathname.endsWith("/3") ? json({ message: "Forbidden" }, { status: 403 }) : new Response(null, { status: 204 }),
    );
    const feature = createArtifactsFeature({ source: createGitHubArtifactSource(() => http), downloader });
    expect((await feature.remove([artifact(1), artifact(2), artifact(3)])).map((r) => r.ok)).toEqual([true, true, false]);
  });
});

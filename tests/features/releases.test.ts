import { describe, expect, it } from "vitest";
import { createReleasesFeature } from "../../src/features/releases/compose";
import { createGitHubReleaseSource } from "../../src/features/releases/gateways/github";
import { filterReleases, sortReleases, type Release } from "../../src/features/releases/release";
import type { Repository } from "../../src/features/workspace/repository";
import { json, redirectedTo, testHttp } from "../helpers";

const repo: Repository = {
  id: 1, owner: { login: "acme", id: 1, type: "Organization", avatarUrl: "" }, name: "web", fullName: "acme/web",
  private: true, archived: false, htmlUrl: "https://github.com/acme/web", pushedAt: null, defaultBranch: "master",
};
const release = (id: number, o: Partial<Release> = {}): Release => ({
  id, repo: { owner: "acme", name: "web" }, title: `v${id}`, tag: `v${id}`, draft: false, prerelease: false,
  date: `2026-01-0${id}T00:00:00Z`, htmlUrl: "", author: null, assets: [], ...o,
});
const rawRelease = (id: number, o: Record<string, unknown> = {}) => ({
  id, name: `Release ${id}`, tag_name: `v${id}`, draft: false, prerelease: false, created_at: "2026-01-01T00:00:00Z",
  published_at: "2026-01-02T00:00:00Z", html_url: `https://github.com/acme/web/releases/tag/v${id}`,
  author: { login: "mona", avatar_url: "a" },
  assets: [{ id: id * 10, name: "chrome-extension.zip", size: 95341, download_count: 3, content_type: "application/zip", updated_at: "2026-01-02T00:00:00Z" }],
  ...o,
});

describe("Release の一覧", () => {
  it("種類（正式・プレリリース）と、名前・タグ・添付ファイル名・リポジトリの語で絞り込み、新しい順に並べる", () => {
    const list = [
      release(1),
      release(3, { prerelease: true, title: "master build", tag: "master-build", assets: [{ id: 9, repo: { owner: "acme", name: "web" }, name: "chrome-extension.zip", sizeInBytes: 1, downloadCount: 0, updatedAt: "" }] }),
      release(2, { draft: true }),
    ];
    expect(filterReleases(list, "release", "").map((r) => r.id)).toEqual([1]);
    expect(filterReleases(list, "prerelease", "").map((r) => r.id)).toEqual([3]);
    expect(filterReleases(list, "all", "chrome-extension").map((r) => r.id)).toEqual([3]);
    expect(sortReleases(list).map((r) => r.id)).toEqual([3, 2, 1]);
  });
});

describe("GitHub から読む", () => {
  it("リポジトリごとに 1 回だけ、新しい順に最大 100 件を取る。名前がなければタグ名を、下書きは作成日を使う", async () => {
    const { http, calls } = testHttp(() => json([rawRelease(2), rawRelease(1, { name: "", draft: true, published_at: null })]));
    const f = createReleasesFeature({ source: createGitHubReleaseSource(() => http), downloader: { start: async () => 1, onInterrupted: () => () => undefined } });
    const [res] = await f.list([repo]);
    expect(calls.map((c) => `${c.method} ${c.url.pathname}?${c.url.searchParams}`)).toEqual(["GET /repos/acme/web/releases?per_page=100"]);
    expect(res!.ok && res!.value.map((r) => [r.title, r.draft, r.date, r.assets.map((a) => [a.name, a.sizeInBytes, a.downloadCount])])).toEqual([
      ["Release 2", false, "2026-01-02T00:00:00Z", [["chrome-extension.zip", 95341, 3]]],
      ["v1", true, "2026-01-01T00:00:00Z", [["chrome-extension.zip", 95341, 3]]],
    ]);
  });

  it("添付ファイルは API に octet-stream を求めて署名つきの URL を得て、それだけをダウンロードに渡す", async () => {
    const { http, calls } = testHttp((c) =>
      c.url.pathname.includes("/releases/assets/") ? redirectedTo("https://release-assets.githubusercontent.com/x?sig=y") : json([rawRelease(2)]),
    );
    const started: unknown[] = [];
    const f = createReleasesFeature({
      source: createGitHubReleaseSource(() => http),
      downloader: { start: async (r) => (started.push(r), 42), onInterrupted: () => () => undefined },
    });
    const [res] = await f.list([repo]);
    const asset = res!.ok ? res!.value[0]!.assets[0]! : null;
    expect(await f.download(asset!)).toBe(42);
    expect(started).toEqual([{ url: "https://release-assets.githubusercontent.com/x?sig=y", filename: "chrome-extension.zip" }]);
    const apiCall = calls.at(-1)!;
    expect(apiCall.url.href).toBe("https://api.github.com/repos/acme/web/releases/assets/20");
    expect(Object.fromEntries(apiCall.headers)).toEqual({ accept: "application/octet-stream", authorization: "Bearer ghp_test" });
  });
});

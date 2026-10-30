import { describe, expect, it } from "vitest";
import type { Artifact, Issue } from "../src/api/types";
import {
  DEFAULT_ARTIFACT_FILTER,
  downloadFilename,
  expiryState,
  filterArtifacts,
  isExpired,
  sortArtifacts,
  summarizeArtifacts,
  summarizeSelection,
} from "../src/domain/artifacts";
import { DAY_MS, formatBytes, formatDate, formatPercent, labelTextColor } from "../src/domain/format";
import { filterIssues, groupIssuesByRepo } from "../src/domain/issues";
import { createI18n } from "../src/i18n";

// 2026-10-30 12:00 ローカル時刻
const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const MB = 1024 * 1024;

function artifact(id: number, o: Partial<Artifact> & { ageDays?: number; expiresInDays?: number } = {}): Artifact {
  const { ageDays = 1, expiresInDays = 60, ...rest } = o;
  return {
    id,
    repo: { owner: "acme", name: "web" },
    name: `a-${id}`,
    sizeInBytes: MB,
    expired: false,
    createdAt: new Date(NOW - ageDays * DAY_MS).toISOString(),
    expiresAt: new Date(NOW + expiresInDays * DAY_MS).toISOString(),
    updatedAt: null,
    digest: null,
    workflowRun: { id: 1, headBranch: "main", headSha: null },
    ...rest,
  };
}

describe("期限の判定", () => {
  it("expired フラグか、期限を過ぎていれば期限切れ", () => {
    expect(isExpired(artifact(1, { expired: true }), NOW)).toBe(true);
    expect(isExpired(artifact(1, { expiresInDays: -1 }), NOW)).toBe(true);
    expect(isExpired(artifact(1, { expiresAt: null }), NOW)).toBe(false);
  });

  it("残り日数は暦日で数える（24 時間未満でも翌日なら明日）", () => {
    const tomorrowMorning = new Date(2026, 9, 31, 9, 0).toISOString();
    expect(expiryState(artifact(1, { expiresAt: tomorrowMorning }), NOW)).toEqual({ kind: "tomorrow" });
    const tonight = new Date(2026, 9, 30, 23, 0).toISOString();
    expect(expiryState(artifact(1, { expiresAt: tonight }), NOW)).toEqual({ kind: "today" });
    const later = new Date(2026, 10, 9, 1, 0).toISOString();
    expect(expiryState(artifact(1, { expiresAt: later }), NOW)).toEqual({ kind: "days", days: 10 });
    expect(expiryState(artifact(1, { expiresAt: null }), NOW)).toEqual({ kind: "unknown" });
  });
});

describe("filterArtifacts", () => {
  const list = [
    artifact(1, { ageDays: 5, sizeInBytes: 10 * MB }),
    artifact(2, { ageDays: 40, sizeInBytes: 200 * MB, repo: { owner: "acme", name: "api" } }),
    artifact(3, { ageDays: 100, expired: true, repo: { owner: "me", name: "dotfiles" } }),
    artifact(4, { createdAt: null }),
  ];
  const ids = (f: Partial<typeof DEFAULT_ARTIFACT_FILTER>) =>
    filterArtifacts(list, { ...DEFAULT_ARTIFACT_FILTER, ...f }, NOW).map((a) => a.id);

  it("条件なしなら全部", () => expect(ids({})).toEqual([1, 2, 3, 4]));
  it("リポジトリ名の部分一致（大文字小文字を区別しない）", () => expect(ids({ repoQuery: " ACME/a " })).toEqual([2]));
  it("作成日が不明なものは日数条件から外す", () => expect(ids({ olderThanDays: 30 })).toEqual([2, 3]));
  it("サイズの下限", () => expect(ids({ minSizeMB: 100 })).toEqual([2]));
  it("状態", () => {
    expect(ids({ status: "active" })).toEqual([1, 2, 4]);
    expect(ids({ status: "expired" })).toEqual([3]);
  });
});

describe("sortArtifacts", () => {
  it("値のないものは向きにかかわらず末尾、同じ値は ID 順", () => {
    const list = [
      artifact(1, { sizeInBytes: 5 }),
      artifact(2, { createdAt: null, sizeInBytes: 5 }),
      artifact(3, { ageDays: 10, sizeInBytes: 9 }),
    ];
    expect(sortArtifacts(list, { key: "created", dir: "desc" }).map((a) => a.id)).toEqual([1, 3, 2]);
    expect(sortArtifacts(list, { key: "created", dir: "asc" }).map((a) => a.id)).toEqual([3, 1, 2]);
    expect(sortArtifacts(list, { key: "size", dir: "desc" }).map((a) => a.id)).toEqual([3, 1, 2]);
    expect(sortArtifacts(list, { key: "size", dir: "asc" }).map((a) => a.id)).toEqual([1, 2, 3]);
  });

  it("元の配列を変えない", () => {
    const list = [artifact(2), artifact(1)];
    sortArtifacts(list, { key: "name", dir: "asc" });
    expect(list.map((a) => a.id)).toEqual([2, 1]);
  });
});

describe("summarizeArtifacts", () => {
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
    expect(s.liveBytes).toBe(450 * MB);
    expect(s.liveCount).toBe(3);
    expect(s.expiredCount).toBe(1);
    expect(s.reposWithArtifacts).toBe(3);
    expect(s.stale.map((a) => a.id)).toEqual([2, 1]);
    expect(s.staleBytes).toBe(400 * MB);
    expect(s.expiringSoon.map((a) => a.id)).toEqual([3]);
    expect(s.byRepo.map((r) => [r.key, r.bytes / MB, r.count])).toEqual([
      ["acme/api", 300, 1],
      ["acme/web", 150, 2],
    ]);
  });

  it("選択の合計とリポジトリ数", () => {
    expect(summarizeSelection([artifact(1), artifact(2), artifact(3, { repo: { owner: "b", name: "c" } })])).toEqual({
      count: 3,
      bytes: 3 * MB,
      repoCount: 2,
    });
  });
});

describe("downloadFilename", () => {
  it("ファイル名に使えない文字を置き換える", () => {
    expect(downloadFilename(artifact(7, { name: 'report: a/b*"c"' }))).toBe("acme-web-report_ a_b_c_-7.zip");
  });
});

describe("format", () => {
  const { number } = createI18n("en");
  it("formatBytes は 1024 進で単位を上げる", () => {
    expect(formatBytes(0, number)).toBe("0 B");
    expect(formatBytes(1023, number)).toBe("1,023 B");
    expect(formatBytes(1536, number)).toBe("1.5 KB");
    expect(formatBytes(1018.6 * MB, number)).toBe("1,018.6 MB");
    expect(formatBytes(2.5 * 1024 * MB, number)).toBe("2.5 GB");
  });
  it("formatDate はローカル時刻の YYYY-MM-DD", () => {
    expect(formatDate(new Date(2026, 0, 2, 23, 59).toISOString())).toBe("2026-01-02");
    expect(formatDate(null)).toBeNull();
    expect(formatDate("garbage")).toBeNull();
  });
  it("formatPercent", () => {
    expect(formatPercent(0.614, number)).toBe("61%");
    expect(formatPercent(NaN, number)).toBe("0%");
  });
  it("labelTextColor は明るい背景に黒、暗い背景に白", () => {
    expect(labelTextColor("a2eeef")).toBe("#000000");
    expect(labelTextColor("b60205")).toBe("#ffffff");
    expect(labelTextColor(null)).toBe("#000000");
  });
});

describe("Issue の絞り込みとまとめ", () => {
  const issue = (id: number, repo: string, o: Partial<Issue> = {}): Issue => ({
    id,
    number: id,
    repo: { owner: repo.split("/")[0]!, name: repo.split("/")[1]! },
    title: `Issue ${id}`,
    state: "open",
    stateReason: null,
    htmlUrl: "",
    author: { login: "alice", avatarUrl: "" },
    labels: [],
    assignees: [],
    comments: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: `2026-01-${String(id).padStart(2, "0")}T00:00:00Z`,
    closedAt: null,
    ...o,
  });
  const list = [
    issue(1, "acme/web", { title: "Crash on login", labels: [{ name: "bug", color: null, description: null }] }),
    issue(2, "acme/api", { assignees: [{ login: "bob", avatarUrl: "" }] }),
    issue(3, "acme/web", { title: "Dark mode" }),
  ];

  it("空白で区切った語をすべて含むものを残す", () => {
    expect(filterIssues(list, "bug login").map((i) => i.id)).toEqual([1]);
    expect(filterIssues(list, "BOB").map((i) => i.id)).toEqual([2]);
    expect(filterIssues(list, "acme/web").map((i) => i.id)).toEqual([1, 3]);
    expect(filterIssues(list, "#3").map((i) => i.id)).toEqual([3]);
    expect(filterIssues(list, "  ").map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it("リポジトリごとにまとめ、更新の新しい順に並べる", () => {
    expect(groupIssuesByRepo(list).map((g) => [g.key, g.issues.map((i) => i.id)])).toEqual([
      ["acme/web", [3, 1]],
      ["acme/api", [2]],
    ]);
  });
});

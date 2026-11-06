// Release と添付ファイル、一覧の絞り込み（閲覧とダウンロードのみ）。

import type { RepoRef, UserRef } from "../workspace/repository";

export interface ReleaseAsset {
  id: number;
  repo: RepoRef;
  name: string;
  sizeInBytes: number;
  downloadCount: number;
  updatedAt: string;
}

export interface Release {
  id: number;
  repo: RepoRef;
  /** 名前がなければタグ名を使う */
  title: string;
  tag: string;
  draft: boolean;
  prerelease: boolean;
  /** 公開日（下書きは作成日） */
  date: string;
  htmlUrl: string;
  author: UserRef | null;
  assets: ReleaseAsset[];
}

export type ReleaseKindFilter = "all" | "release" | "prerelease";

/** 種類と、空白で区切った語で絞り込む。語はすべて、名前・タグ・添付ファイル名・リポジトリのどれかに含まれるものを残す */
export function filterReleases(releases: readonly Release[], kind: ReleaseKindFilter, text: string): Release[] {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  return releases.filter((r) => {
    if (kind === "release" && (r.prerelease || r.draft)) return false;
    if (kind === "prerelease" && !r.prerelease) return false;
    const haystack = [r.title, r.tag, ...r.assets.map((a) => a.name), `${r.repo.owner}/${r.repo.name}`].join("\n").toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/** 新しい順（下書きは作成日で並べる） */
export function sortReleases(releases: readonly Release[]): Release[] {
  return [...releases].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

// Release の一覧の状態（閲覧とダウンロードのみ）: 取得、種類と文字での絞り込み、リポジトリごとのまとめ、ダウンロードの通知。

import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js";
import { filterReleases, sortReleases, type Release, type ReleaseAsset, type ReleaseKindFilter } from "../../../features/releases/release";
import type { Repository } from "../../../features/workspace/repository";
import { mergeList } from "../../../lib/reuse";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { createRepoResults } from "../../lists/repo-results";

export interface ReleaseGroup {
  repo: Repository;
  releases: Release[];
}

export type ReleaseNotice =
  | { kind: "downloadStarted"; name: string }
  | { kind: "downloadFailed"; name: string; reason: string }
  | { kind: "error"; error: unknown };

export function createReleasesState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const ops = deps.manager.releases;
  const [kind, setKind] = createSignal<ReleaseKindFilter>("all");
  const [text, setText] = createSignal("");
  const [notice, setNotice] = createSignal<ReleaseNotice | null>(null);

  // タブを開いているときだけ読み込む
  const results = createRepoResults<Release[]>({
    ws,
    fetch: (repos, options) => ops.list(repos, options),
    now: deps.manager.now,
    active,
    merge: mergeList((r) => r.id),
  });

  const releases = createMemo(() => results.values().flatMap((r) => r.value));
  const groups = createMemo((): ReleaseGroup[] =>
    results
      .values()
      .map(({ repo, value }) => ({ repo, releases: sortReleases(filterReleases(value, kind(), text())) }))
      .filter((g) => g.releases.length > 0)
      // 最近 Release を出したリポジトリを先に
      .sort((a, b) => Date.parse(b.releases[0]!.date) - Date.parse(a.releases[0]!.date)),
  );

  // 開始したダウンロードの ID → 添付ファイル。中断の通知を受けたら名前を示すために使う
  const downloading = new Map<number, ReleaseAsset>();
  onCleanup(
    ops.onDownloadInterrupted((id, reason) => {
      const asset = downloading.get(id);
      if (!asset) return;
      downloading.delete(id);
      setNotice({ kind: "downloadFailed", name: asset.name, reason });
    }),
  );

  async function download(asset: ReleaseAsset) {
    try {
      downloading.set(await ops.download(asset), asset);
      setNotice({ kind: "downloadStarted", name: asset.name });
    } catch (error) {
      setNotice({ kind: "error", error });
    }
  }

  return {
    results,
    kind,
    setKind,
    text,
    setText,
    releases,
    groups,
    count: createMemo(() => groups().reduce((n, g) => n + g.releases.length, 0)),
    download,
    notice,
    dismissNotice: () => setNotice(null),
  };
}

export type ReleasesState = ReturnType<typeof createReleasesState>;

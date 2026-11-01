// アーティファクトタブの状態: 取得、絞り込み、選択、削除、ダウンロード。

import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import type { Artifact } from "../../../features/artifacts/artifact";
import { isExpired } from "../../../features/artifacts/artifact";
import {
  DEFAULT_ARTIFACT_FILTER,
  DEFAULT_ARTIFACT_SORT,
  defaultArtifactSortDir,
  filterArtifacts,
  sortArtifacts,
  summarizeArtifacts,
  type ArtifactFilter,
  type ArtifactSort,
  type ArtifactSortKey,
} from "../../../features/artifacts/listing";
import { repoKey } from "../../../features/workspace/repository";
import { mergeList } from "../../../lib/reuse";
import { toggleSort } from "../../../lib/sort";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { createBulkDelete } from "../../lists/bulk-delete";
import { createRepoResults } from "../../lists/repo-results";
import { createSelection } from "../../lists/selection";

export type ArtifactNotice =
  | { kind: "deleted"; count: number }
  | { kind: "deleteFailed"; count: number; errors: unknown[] }
  | { kind: "downloadStarted"; count: number }
  | { kind: "downloadFailed"; name: string; reason: string }
  | { kind: "error"; error: unknown };

export function createArtifactsState(deps: UiDeps, ws: WorkspaceState) {
  const ops = deps.manager.artifacts;
  const [filter, setFilter] = createStore<ArtifactFilter>({ ...DEFAULT_ARTIFACT_FILTER });
  const [sort, setSort] = createSignal<ArtifactSort>(DEFAULT_ARTIFACT_SORT);
  const [notice, setNotice] = createSignal<ArtifactNotice | null>(null);

  const results = createRepoResults<Artifact[]>({
    ws,
    fetch: (repos, options) => ops.list(repos, options),
    now: deps.manager.now,
    onReset: () => selection.clear(),
    // 削除の確認中と削除中は取り直さない（確認した対象が変わらないように）
    paused: (): boolean => bulkDelete.state().phase !== "idle",
    merge: mergeList((a) => a.id),
  });
  const artifacts = createMemo(() => results.values().flatMap((r) => r.value));
  const summary = createMemo(() => summarizeArtifacts(artifacts(), results.now()));
  const visible = createMemo(() => sortArtifacts(filterArtifacts(artifacts(), filter, results.now()), sort()));
  const selection = createSelection(visible);
  const selectionSummary = createMemo(() => ({
    count: selection.selected().length,
    bytes: selection.selected().reduce((s, a) => s + a.sizeInBytes, 0),
    repoCount: new Set(selection.selected().map((a) => repoKey(a.repo))).size,
  }));

  const bulkDelete = createBulkDelete<Artifact>({
    targets: selection.selected,
    remove: (items, options) => ops.remove(items, options),
    onDone({ removed, errors }) {
      const ids = new Set(removed.map((a) => a.id));
      batch(() => {
        results.update((_repo, list) => list.filter((a) => !ids.has(a.id)));
        selection.setMany(removed, false);
        setNotice(errors.length > 0 ? { kind: "deleteFailed", count: errors.length, errors } : { kind: "deleted", count: removed.length });
      });
    },
  });

  // 開始したダウンロードの ID → 対象。中断の通知を受けたら名前を示すために使う
  const downloading = new Map<number, Artifact>();
  onCleanup(
    ops.onDownloadInterrupted((id, reason) => {
      const artifact = downloading.get(id);
      if (!artifact) return;
      downloading.delete(id);
      setNotice({ kind: "downloadFailed", name: artifact.name, reason });
    }),
  );

  async function download(list: readonly Artifact[]) {
    const targets = list.filter((a) => !isExpired(a, results.now()));
    try {
      for (const a of targets) downloading.set(await ops.download(a), a);
      setNotice({ kind: "downloadStarted", count: targets.length });
    } catch (error) {
      setNotice({ kind: "error", error });
    }
  }

  return {
    results,
    artifacts,
    visible,
    summary,
    filter,
    setFilter: <K extends keyof ArtifactFilter>(key: K, value: ArtifactFilter[K]) => setFilter(key, value),
    sort,
    toggleSort: (key: ArtifactSortKey) => setSort(toggleSort(sort(), key, defaultArtifactSortDir)),
    selection,
    selectionSummary,
    /** 古い有効なアーティファクトをまとめて選ぶ（絞り込みは解除する） */
    selectStale() {
      batch(() => {
        setFilter({ ...DEFAULT_ARTIFACT_FILTER });
        selection.only(summary().stale);
      });
    },
    bulkDelete,
    download,
    notice,
    dismissNotice: () => setNotice(null),
  };
}

export type ArtifactsState = ReturnType<typeof createArtifactsState>;

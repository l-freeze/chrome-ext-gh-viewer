// キャッシュタブの状態: 取得、絞り込み、選択、削除。

import { batch, createMemo, createSignal, type Accessor } from "solid-js";
import { createStore } from "solid-js/store";
import type { ActionsCache } from "../../../features/caches/cache";
import {
  DEFAULT_CACHE_FILTER,
  DEFAULT_CACHE_SORT,
  defaultCacheSortDir,
  filterCaches,
  sortCaches,
  summarizeCaches,
  type CacheFilter,
  type CacheSort,
  type CacheSortKey,
} from "../../../features/caches/listing";
import { repoKey } from "../../../features/workspace/repository";
import { toggleSort } from "../../../lib/sort";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { createBulkDelete } from "../../lists/bulk-delete";
import { createRepoResults } from "../../lists/repo-results";
import { createSelection } from "../../lists/selection";

export type CacheNotice = { kind: "deleted"; count: number; bytes: number } | { kind: "deleteFailed"; count: number; errors: unknown[] };

export function createCachesState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const ops = deps.manager.caches;
  const [filter, setFilter] = createStore<CacheFilter>({ ...DEFAULT_CACHE_FILTER });
  const [sort, setSort] = createSignal<CacheSort>(DEFAULT_CACHE_SORT);
  const [notice, setNotice] = createSignal<CacheNotice | null>(null);

  // タブを開いているときだけ読み込む
  const results = createRepoResults<ActionsCache[]>({
    ws,
    fetch: (repos, options) => ops.list(repos, options),
    now: deps.manager.now,
    active,
    onReset: () => selection.clear(),
  });
  const caches = createMemo(() => results.values().flatMap((r) => r.value));
  const summary = createMemo(() => summarizeCaches(caches(), results.now()));
  const visible = createMemo(() => sortCaches(filterCaches(caches(), filter, results.now()), sort()));
  const selection = createSelection(visible);
  const selectionSummary = createMemo(() => ({
    count: selection.selected().length,
    bytes: selection.selected().reduce((s, c) => s + c.sizeInBytes, 0),
    repoCount: new Set(selection.selected().map((c) => repoKey(c.repo))).size,
  }));

  const bulkDelete = createBulkDelete<ActionsCache>({
    targets: selection.selected,
    remove: (items, options) => ops.remove(items, options),
    onDone({ removed, errors }) {
      const ids = new Set(removed.map((c) => c.id));
      batch(() => {
        results.update((_repo, list) => list.filter((c) => !ids.has(c.id)));
        selection.setMany(removed, false);
        setNotice(
          errors.length > 0
            ? { kind: "deleteFailed", count: errors.length, errors }
            : { kind: "deleted", count: removed.length, bytes: removed.reduce((s, c) => s + c.sizeInBytes, 0) },
        );
      });
    },
  });

  return {
    results,
    caches,
    visible,
    summary,
    filter,
    setFilter: <K extends keyof CacheFilter>(key: K, value: CacheFilter[K]) => setFilter(key, value),
    sort,
    toggleSort: (key: CacheSortKey) => setSort(toggleSort(sort(), key, defaultCacheSortDir)),
    selection,
    selectionSummary,
    /** 指定したキャッシュだけを選ぶ（絞り込みは解除する） */
    selectOnly(list: readonly ActionsCache[]) {
      batch(() => {
        setFilter({ ...DEFAULT_CACHE_FILTER });
        selection.only(list);
      });
    },
    bulkDelete,
    notice,
    dismissNotice: () => setNotice(null),
  };
}

export type CachesState = ReturnType<typeof createCachesState>;

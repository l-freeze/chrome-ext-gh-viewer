// キャッシュタブの状態: 取得、絞り込み、選択、削除。

import { batch, createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { collectForRepos, deleteEach, type RepoItemsResult } from "../../api/aggregate";
import { GitHubApiError } from "../../api/errors";
import type { ActionsCache, Repository } from "../../api/types";
import { repoKey } from "../../domain/artifacts";
import {
  DEFAULT_CACHE_FILTER,
  DEFAULT_CACHE_SORT,
  filterCaches,
  sortCaches,
  summarizeCaches,
  type CacheFilter,
  type CacheSort,
  type CacheSortKey,
} from "../../domain/caches";
import { toRepoRef } from "../../services/workspace";
import type { DeleteState } from "./artifacts";
import type { AppDeps } from "./context";
import type { WorkspaceState } from "./workspace";

export type CacheNotice =
  | { kind: "deleted"; count: number; bytes: number }
  | { kind: "deleteFailed"; count: number; errors: GitHubApiError[] };

type Result = RepoItemsResult<ActionsCache>;

export function createCachesState(deps: AppDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const [results, setResults] = createSignal<ReadonlyMap<string, Result>>(new Map());
  const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
  const [now, setNow] = createSignal(deps.now());
  const [filter, setFilter] = createStore<CacheFilter>({ ...DEFAULT_CACHE_FILTER });
  const [sort, setSort] = createSignal<CacheSort>(DEFAULT_CACHE_SORT);
  const [selected, setSelected] = createStore<Record<number, boolean>>({});
  const [deleteState, setDeleteState] = createSignal<DeleteState>({ phase: "idle" });
  const [notice, setNotice] = createSignal<CacheNotice | null>(null);
  let abort: AbortController | null = null;

  const keyOf = (r: Repository) => r.fullName.toLowerCase();

  async function load(force: boolean) {
    const router = ws.router();
    if (!router) return;
    const cache = force ? new Map<string, Result>() : new Map(results());
    if (force) setResults(cache);
    const missing = ws
      .selectedRepos()
      .map((r) => r.repo)
      .filter((r) => !cache.has(keyOf(r)));
    if (missing.length === 0) return;

    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    setNow(deps.now());
    setProgress({ done: 0, total: missing.length });
    try {
      await collectForRepos(
        missing,
        async (repo, signal) => ({
          items: await router.forRepo(toRepoRef(repo)).listRepoCaches(toRepoRef(repo), signal ? { signal } : {}),
        }),
        {
          concurrency: 6,
          signal: controller.signal,
          onProgress: (p, result) => {
            if (controller.signal.aborted) return;
            batch(() => {
              setResults((prev) => new Map(prev).set(keyOf(result.repo), result));
              setProgress(p);
            });
          },
        },
      );
    } catch (e) {
      if (!(e instanceof GitHubApiError && e.kind === "aborted")) throw e;
    } finally {
      if (abort === controller) {
        abort = null;
        setProgress(null);
      }
    }
  }

  // タブを開いているときだけ読み込む。作業範囲を取り直したときは先にキャッシュと選択を捨てる
  let lastWorkspace: unknown;
  createEffect(
    on([ws.workspace, active, ws.router, ws.selectedRepos], ([workspace, isActive]) => {
      if (workspace !== lastWorkspace) {
        lastWorkspace = workspace;
        abort?.abort();
        setResults(new Map());
        setSelected(reconcile({}));
      }
      if (isActive) void load(false);
    }),
  );

  const selectedResults = createMemo(() =>
    ws
      .selectedRepos()
      .map((r) => results().get(keyOf(r.repo)))
      .filter((r): r is Result => r !== undefined),
  );
  const caches = createMemo(() => selectedResults().flatMap((r) => (r.ok ? r.items : [])));
  const failures = createMemo(() => selectedResults().filter((r): r is Extract<Result, { ok: false }> => !r.ok));
  const summary = createMemo(() => summarizeCaches(caches(), now()));
  const visible = createMemo(() => sortCaches(filterCaches(caches(), filter, now()), sort()));
  /** 絞り込みで見えなくなったものは操作の対象にしない */
  const selection = createMemo(() => visible().filter((c) => selected[c.id]));
  const selectionSummary = createMemo(() => ({
    count: selection().length,
    bytes: selection().reduce((s, c) => s + c.sizeInBytes, 0),
    repoCount: new Set(selection().map((c) => repoKey(c.repo))).size,
  }));

  const setMany = (list: readonly ActionsCache[], value: boolean) =>
    setSelected(reconcile({ ...selected, ...Object.fromEntries(list.map((c) => [c.id, value])) } as Record<number, boolean>));

  async function deleteSelection() {
    const router = ws.router();
    const targets = selection();
    if (!router || targets.length === 0) return;
    setDeleteState({ phase: "deleting", done: 0, total: targets.length });
    const res = await deleteEach(targets, (c, signal) => router.forRepo(c.repo).deleteCache(c, signal ? { signal } : {}), {
      onProgress: (p) => setDeleteState({ phase: "deleting", ...p }),
    });
    const deleted = new Set(res.filter((r) => r.ok).map((r) => r.item.id));
    const errors = res.flatMap((r) => (r.ok ? [] : [r.error]));
    batch(() => {
      setResults((prev) => {
        const next = new Map(prev);
        for (const [key, r] of next) {
          if (r.ok && r.items.some((c) => deleted.has(c.id))) next.set(key, { ...r, items: r.items.filter((c) => !deleted.has(c.id)) });
        }
        return next;
      });
      setMany(targets.filter((c) => deleted.has(c.id)), false);
      setDeleteState({ phase: "idle" });
      setNotice(
        errors.length > 0
          ? { kind: "deleteFailed", count: errors.length, errors }
          : { kind: "deleted", count: deleted.size, bytes: targets.filter((c) => deleted.has(c.id)).reduce((s, c) => s + c.sizeInBytes, 0) },
      );
    });
  }

  return {
    progress,
    now,
    caches,
    visible,
    failures,
    summary,
    filter,
    setFilter: <K extends keyof CacheFilter>(key: K, value: CacheFilter[K]) => setFilter(key, value),
    sort,
    toggleSort(key: CacheSortKey) {
      const cur = sort();
      setSort(
        cur.key === key
          ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
          : { key, dir: key === "key" || key === "repo" || key === "ref" ? "asc" : "desc" },
      );
    },
    isSelected: (id: number) => selected[id] === true,
    toggle: (id: number) => setSelected(id, (v) => !v),
    setMany,
    clearSelection: () => setSelected(reconcile({})),
    /** 指定したキャッシュだけを選ぶ（絞り込みは解除する） */
    selectOnly(list: readonly ActionsCache[]) {
      batch(() => {
        setFilter({ ...DEFAULT_CACHE_FILTER });
        setSelected(reconcile(Object.fromEntries(list.map((c) => [c.id, true])) as Record<number, boolean>));
      });
    },
    selection,
    selectionSummary,
    deleteState,
    askDelete: () => setDeleteState({ phase: "confirm" }),
    cancelDelete: () => setDeleteState({ phase: "idle" }),
    deleteSelection,
    notice,
    dismissNotice: () => setNotice(null),
    refresh: () => void load(true),
  };
}

export type CachesState = ReturnType<typeof createCachesState>;

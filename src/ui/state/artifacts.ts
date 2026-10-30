// アーティファクト一覧の状態: 取得、絞り込み、選択、削除、ダウンロード。

import { batch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { deleteArtifacts, listArtifactsForRepos, type RepoArtifactsResult } from "../../api/aggregate";
import { GitHubApiError } from "../../api/errors";
import type { Artifact } from "../../api/types";
import {
  DEFAULT_ARTIFACT_FILTER,
  DEFAULT_ARTIFACT_SORT,
  downloadFilename,
  filterArtifacts,
  isExpired,
  repoKey,
  sortArtifacts,
  summarizeArtifacts,
  summarizeSelection,
  type ArtifactFilter,
  type ArtifactSort,
  type ArtifactSortKey,
} from "../../domain/artifacts";
import { toRepoRef } from "../../services/workspace";
import type { AppDeps } from "./context";
import type { WorkspaceState } from "./workspace";

export type Notice =
  | { kind: "deleted"; count: number }
  | { kind: "deleteFailed"; count: number; errors: GitHubApiError[] }
  | { kind: "downloadStarted"; count: number }
  | { kind: "downloadFailed"; name: string; reason: string }
  | { kind: "error"; error: GitHubApiError };

export type DeleteState = { phase: "idle" } | { phase: "confirm" } | { phase: "deleting"; done: number; total: number };

export function createArtifactsState(deps: AppDeps, ws: WorkspaceState) {
  // リポジトリ（owner/name 小文字）ごとの取得結果。所有者の選択を切り替えても取り直さないようにキャッシュする
  const [results, setResults] = createSignal<ReadonlyMap<string, RepoArtifactsResult>>(new Map());
  const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
  const [now, setNow] = createSignal(deps.now());
  const [filter, setFilter] = createStore<ArtifactFilter>({ ...DEFAULT_ARTIFACT_FILTER });
  const [sort, setSort] = createSignal<ArtifactSort>(DEFAULT_ARTIFACT_SORT);
  const [selected, setSelected] = createStore<Record<number, boolean>>({});
  const [deleteState, setDeleteState] = createSignal<DeleteState>({ phase: "idle" });
  const [notice, setNotice] = createSignal<Notice | null>(null);
  let abort: AbortController | null = null;
  // 開始したダウンロードの ID → 対象。中断の通知を受けたら名前を示すために使う
  const downloading = new Map<number, Artifact>();
  onCleanup(
    deps.downloader.onInterrupted((id, reason) => {
      const artifact = downloading.get(id);
      if (!artifact) return;
      downloading.delete(id);
      setNotice({ kind: "downloadFailed", name: artifact.name, reason });
    }),
  );

  const keyOf = (r: { owner: { login: string }; name: string }) => `${r.owner.login}/${r.name}`.toLowerCase();

  async function load(force = false) {
    const router = ws.router();
    if (!router) return;
    const repos = ws.selectedRepos().map((r) => r.repo);
    const cache = force ? new Map<string, RepoArtifactsResult>() : new Map(results());
    if (force) setResults(cache);
    const missing = repos.filter((r) => !cache.has(keyOf(r)));
    if (missing.length === 0) return;

    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    setNow(deps.now());
    setProgress({ done: 0, total: missing.length });
    try {
      await listArtifactsForRepos((repo) => router.forRepo(toRepoRef(repo)), missing, {
        concurrency: 6,
        signal: controller.signal,
        onProgress: (p, result) => {
          if (controller.signal.aborted) return;
          batch(() => {
            setResults((prev) => new Map(prev).set(keyOf(result.repo), result));
            setProgress(p);
          });
        },
      });
    } catch (e) {
      if (!(e instanceof GitHubApiError && e.kind === "aborted")) throw e;
    } finally {
      if (abort === controller) {
        abort = null;
        setProgress(null);
      }
    }
  }

  // 作業範囲や所有者の選択が変わったら、まだ取得していないリポジトリを読み込む。
  // 作業範囲そのものを取り直したとき（認証情報の変更など）は、先にキャッシュと選択を捨てる
  let lastWorkspace: unknown;
  createEffect(
    on([ws.workspace, ws.router, ws.selectedRepos], ([workspace]) => {
      if (workspace !== lastWorkspace) {
        lastWorkspace = workspace;
        abort?.abort();
        setResults(new Map());
        setSelected(reconcile({}));
      }
      void load();
    }),
  );

  const selectedResults = createMemo(() =>
    ws
      .selectedRepos()
      .map((r) => results().get(keyOf(r.repo)))
      .filter((r): r is RepoArtifactsResult => r !== undefined),
  );
  const artifacts = createMemo(() => selectedResults().flatMap((r) => (r.ok ? r.artifacts : [])));
  const failures = createMemo(() =>
    selectedResults().filter((r): r is Extract<RepoArtifactsResult, { ok: false }> => !r.ok),
  );
  const summary = createMemo(() => summarizeArtifacts(artifacts(), now()));
  const visible = createMemo(() => sortArtifacts(filterArtifacts(artifacts(), filter, now()), sort()));
  /** 絞り込みで見えなくなったものは操作の対象にしない */
  const selection = createMemo(() => visible().filter((a) => selected[a.id]));
  const selectionSummary = createMemo(() => summarizeSelection(selection()));

  const setMany = (list: readonly Artifact[], value: boolean) =>
    setSelected(
      reconcile({ ...selected, ...Object.fromEntries(list.map((a) => [a.id, value])) } as Record<number, boolean>),
    );

  async function deleteSelection() {
    const router = ws.router();
    const targets = selection();
    if (!router || targets.length === 0) return;
    setDeleteState({ phase: "deleting", done: 0, total: targets.length });
    const res = await deleteArtifacts((a) => router.forRepo(a.repo), targets, {
      onProgress: (p) => setDeleteState({ phase: "deleting", ...p }),
    });
    const deleted = new Set(res.filter((r) => r.ok).map((r) => r.artifact.id));
    const errors = res.flatMap((r) => (r.ok ? [] : [r.error]));
    batch(() => {
      setResults((prev) => {
        const next = new Map(prev);
        for (const [key, r] of next) {
          if (r.ok && r.artifacts.some((a) => deleted.has(a.id))) {
            next.set(key, { ...r, artifacts: r.artifacts.filter((a) => !deleted.has(a.id)) });
          }
        }
        return next;
      });
      setMany(targets.filter((a) => deleted.has(a.id)), false);
      setDeleteState({ phase: "idle" });
      setNotice(
        errors.length > 0
          ? { kind: "deleteFailed", count: errors.length, errors }
          : { kind: "deleted", count: deleted.size },
      );
    });
  }

  async function download(list: readonly Artifact[]) {
    const router = ws.router();
    if (!router) return;
    const targets = list.filter((a) => !isExpired(a, now()));
    try {
      for (const a of targets) {
        const request = router.forRepo(a.repo).artifactDownloadRequest(a);
        const id = await deps.downloader.download({ ...request, filename: downloadFilename(a) });
        downloading.set(id, a);
      }
      setNotice({ kind: "downloadStarted", count: targets.length });
    } catch (e) {
      setNotice({ kind: "error", error: new GitHubApiError({ kind: "unexpected", message: String(e), cause: e }) });
    }
  }

  return {
    progress,
    now,
    artifacts,
    visible,
    failures,
    summary,
    filter,
    setFilter: <K extends keyof ArtifactFilter>(key: K, value: ArtifactFilter[K]) => setFilter(key, value),
    resetFilter: () => setFilter({ ...DEFAULT_ARTIFACT_FILTER }),
    sort,
    toggleSort(key: ArtifactSortKey) {
      const cur = sort();
      setSort(
        cur.key === key
          ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
          : { key, dir: key === "name" || key === "repo" || key === "branch" ? "asc" : "desc" },
      );
    },
    isSelected: (id: number) => selected[id] === true,
    toggle: (id: number) => setSelected(id, (v) => !v),
    setMany,
    clearSelection: () => setSelected(reconcile({})),
    /** 古い有効なアーティファクトをまとめて選ぶ（絞り込みは解除する） */
    selectStale() {
      batch(() => {
        setFilter({ ...DEFAULT_ARTIFACT_FILTER });
        setSelected(reconcile(Object.fromEntries(summary().stale.map((a) => [a.id, true])) as Record<number, boolean>));
      });
    },
    selection,
    selectionSummary,
    deleteState,
    askDelete: () => setDeleteState({ phase: "confirm" }),
    cancelDelete: () => setDeleteState({ phase: "idle" }),
    deleteSelection,
    download,
    notice,
    dismissNotice: () => setNotice(null),
    refresh: () => void load(true),
    repoKey,
  };
}

export type ArtifactsState = ReturnType<typeof createArtifactsState>;

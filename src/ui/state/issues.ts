// Issue 一覧の状態。表示（検索・絞り込み）だけを扱う。
// Issue への操作を足すときは、API 層に呼び出しを、ここに結果を一覧へ反映する処理を追加する。

import { batch, createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { searchIssuesForOwners, type IssueStateFilter, type OwnerIssuesResult } from "../../api/aggregate";
import { GitHubApiError } from "../../api/errors";
import { filterIssues, groupIssuesByRepo } from "../../domain/issues";
import type { AppDeps } from "./context";
import type { WorkspaceState } from "./workspace";

export function createIssuesState(_deps: AppDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const [stateFilter, setStateFilter] = createSignal<IssueStateFilter>("open");
  const [text, setText] = createSignal("");
  // キーは「状態:所有者（小文字）」
  const [results, setResults] = createSignal<ReadonlyMap<string, OwnerIssuesResult>>(new Map());
  const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
  let abort: AbortController | null = null;

  const keyOf = (state: IssueStateFilter, login: string) => `${state}:${login.toLowerCase()}`;

  async function load(force = false) {
    const router = ws.router();
    if (!router) return;
    const state = stateFilter();
    const cache = force ? new Map<string, OwnerIssuesResult>() : new Map(results());
    if (force) setResults(cache);
    const missing = ws
      .selectedOwners()
      .map((o) => o.owner)
      .filter((o) => !cache.has(keyOf(state, o.login)));
    if (missing.length === 0) return;

    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    let done = 0;
    setProgress({ done, total: missing.length });
    try {
      await searchIssuesForOwners((owner) => router.forOwner(owner), missing, { state }, {
        signal: controller.signal,
        onOwnerDone: (result) => {
          if (controller.signal.aborted) return;
          batch(() => {
            setResults((prev) => new Map(prev).set(keyOf(state, result.owner.login), result));
            setProgress({ done: ++done, total: missing.length });
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

  // Issue タブを開いているときだけ検索する（Search API のレート制限が厳しいため）。
  // 作業範囲を取り直したときは先にキャッシュを捨てる
  let lastWorkspace: unknown;
  createEffect(
    on([ws.workspace, active, ws.router, ws.selectedOwners, stateFilter], ([workspace, isActive]) => {
      if (workspace !== lastWorkspace) {
        lastWorkspace = workspace;
        abort?.abort();
        setResults(new Map());
      }
      if (isActive) void load();
    }),
  );

  const ownerResults = createMemo(() =>
    ws
      .selectedOwners()
      .map((o) => results().get(keyOf(stateFilter(), o.owner.login)))
      .filter((r): r is OwnerIssuesResult => r !== undefined),
  );
  const issues = createMemo(() => ownerResults().flatMap((r) => r.issues));
  const filtered = createMemo(() => filterIssues(issues(), text()));
  const groups = createMemo(() => groupIssuesByRepo(filtered()));

  return {
    stateFilter,
    setStateFilter,
    text,
    setText,
    progress,
    issues,
    filtered,
    groups,
    failures: createMemo(() => ownerResults().filter((r) => r.error !== null)),
    truncatedOwners: createMemo(() => ownerResults().filter((r) => r.truncated).map((r) => r.owner.login)),
    refresh: () => void load(true),
  };
}

export type IssuesState = ReturnType<typeof createIssuesState>;

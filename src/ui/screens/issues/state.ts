// Issue 一覧の状態。表示（検索・絞り込み）だけを扱う。
// Issue への操作を足すときは、features/issues に操作を、ここに結果を一覧へ反映する処理を追加する。

import { batch, createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { filterIssues, groupIssuesByRepo } from "../../../features/issues/issue";
import type { IssueStateFilter, OwnerIssues as OwnerIssuesResult } from "../../../features/issues/ports";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { isAborted } from "../../errors";
import { sameValue } from "../../../lib/reuse";

export function createIssuesState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const ops = deps.manager.issues;
  const [stateFilter, setStateFilter] = createSignal<IssueStateFilter>("open");
  const [text, setText] = createSignal("");
  // キーは「状態:所有者（小文字）」
  const [results, setResults] = createSignal<ReadonlyMap<string, OwnerIssuesResult>>(new Map());
  const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
  let abort: AbortController | null = null;

  const keyOf = (state: IssueStateFilter, login: string) => `${state}:${login.toLowerCase()}`;

  async function load(force = false) {
    if (!ws.workspace()) return;
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
      await ops.search(missing, state, {
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
      if (!isAborted(e)) throw e;
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
    on([ws.workspace, active, ws.selectedOwners, stateFilter], ([workspace, isActive]) => {
      if (workspace !== lastWorkspace) {
        lastWorkspace = workspace;
        abort?.abort();
        setResults(new Map());
      }
      if (isActive) void load();
    }),
  );

  /**
   * 自動更新: 検索済みの所有者を検索し直し、変わったところだけ差し替える。
   * 表示は消さない。読み込み中なら何もしない。一時的に失敗した所有者は前の結果を残す
   */
  async function poll() {
    if (abort || !ws.workspace()) return;
    const state = stateFilter();
    const owners = ws
      .selectedOwners()
      .map((o) => o.owner)
      .filter((o) => results().has(keyOf(state, o.login)));
    if (owners.length === 0) return;
    const controller = new AbortController();
    abort = controller;
    try {
      await ops.search(owners, state, {
        signal: controller.signal,
        onOwnerDone: (result) => {
          if (controller.signal.aborted) return;
          const key = keyOf(state, result.owner.login);
          const prev = results().get(key);
          if (result.error !== null && prev && prev.error === null) return;
          if (!sameValue(prev, result)) setResults((m) => new Map(m).set(key, result));
        },
      });
    } catch (e) {
      if (!isAborted(e)) throw e;
    } finally {
      if (abort === controller) abort = null;
    }
  }

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
    poll,
  };
}

export type IssuesState = ReturnType<typeof createIssuesState>;

// 実行履歴の一括削除の流れ: 条件を決める → 検索（件数の確認） → リポジトリを選ぶ → 確認 → 削除。
// 実行履歴は量が多くなりがちなので、一覧を先に全部読み込まず、条件で検索してから消す。

import { batch, createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { DEFAULT_RUN_CLEANUP, matchesWorkflow, summarizeRuns, type RunCleanupCriteria, type RunGroupSummary } from "../../../features/actions/cleanup";
import type { RunSearchResult } from "../../../features/actions/ports";
import type { WorkflowRun } from "../../../features/actions/workflow";
import type { Repository } from "../../../features/workspace/repository";
import type { Settled } from "../../../lib/concurrency";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { isAborted } from "../../errors";

type Result = Settled<Repository, RunSearchResult>;

export type RunCleanupPhase =
  | { phase: "idle" }
  | { phase: "searching"; done: number; total: number }
  | { phase: "results" }
  | { phase: "confirm" }
  | { phase: "deleting"; done: number; total: number };

export type RunCleanupNotice =
  | { kind: "deleted"; count: number }
  | { kind: "stopped"; count: number }
  | { kind: "deleteFailed"; deleted: number; failed: number; errors: unknown[] };

export interface RunGroup {
  repo: Repository;
  key: string;
  runs: WorkflowRun[];
  summary: RunGroupSummary;
  /** 1,000 件を超えていて、残りは今回の対象に入っていない */
  truncated: boolean;
}

export function createRunCleanupState(deps: UiDeps, ws: WorkspaceState) {
  const ops = deps.manager.actions;
  const [criteria, setCriteria] = createStore<RunCleanupCriteria>({ ...DEFAULT_RUN_CLEANUP });
  const [phase, setPhase] = createSignal<RunCleanupPhase>({ phase: "idle" });
  const [results, setResults] = createSignal<Result[]>([]);
  /** 検索した時点の条件。条件を変えたら結果は古いとみなす */
  const [searchedWith, setSearchedWith] = createSignal<string | null>(null);
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = createSignal<RunCleanupNotice | null>(null);
  let abort: AbortController | null = null;

  const criteriaKey = () => JSON.stringify({ ...criteria, repos: ws.selectedRepos().map((r) => r.repo.id) });
  const stale = createMemo(() => searchedWith() !== null && searchedWith() !== criteriaKey());

  async function search() {
    if (!ws.workspace()) return;
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    const repos = ws.selectedRepos().map((r) => r.repo);
    const key = criteriaKey();
    batch(() => {
      setNotice(null);
      setExcluded(new Set<string>());
      setPhase({ phase: "searching", done: 0, total: repos.length });
    });
    try {
      const res = await ops.searchRuns(repos, { ...criteria }, {
        signal: controller.signal,
        onProgress: (p) => {
          if (!controller.signal.aborted) setPhase({ phase: "searching", ...p });
        },
      });
      batch(() => {
        setResults(res);
        setSearchedWith(key);
        setPhase({ phase: "results" });
      });
    } catch (e) {
      if (isAborted(e)) {
        if (abort === controller) setPhase({ phase: results().length > 0 ? "results" : "idle" });
        return;
      }
      throw e;
    } finally {
      if (abort === controller) abort = null;
    }
  }

  const groups = createMemo((): RunGroup[] =>
    results()
      .flatMap((r) => (r.ok ? [r] : []))
      .map((r) => {
        const runs = r.value.runs.filter((run) => matchesWorkflow(run, criteria.workflowQuery));
        return { repo: r.item, key: r.item.fullName, runs, summary: summarizeRuns(runs), truncated: r.value.truncated };
      })
      .filter((g) => g.runs.length > 0)
      .sort((a, b) => b.runs.length - a.runs.length || a.key.localeCompare(b.key)),
  );
  const targets = createMemo(() => groups().filter((g) => !excluded().has(g.key)).flatMap((g) => g.runs));

  async function deleteTargets() {
    const list = targets();
    if (list.length === 0 || stale()) return;
    const controller = new AbortController();
    abort = controller;
    setPhase({ phase: "deleting", done: 0, total: list.length });
    const deleted = new Set<number>();
    const errors: unknown[] = [];
    let stopped = false;
    try {
      await ops.removeRuns(list, {
        signal: controller.signal,
        onProgress: (p, r) => {
          if (r.ok) deleted.add(r.item.id);
          else errors.push(r.error);
          setPhase({ phase: "deleting", ...p });
        },
      });
    } catch (e) {
      if (!isAborted(e)) throw e;
      stopped = true;
    } finally {
      if (abort === controller) abort = null;
    }
    batch(() => {
      // 消したものは結果から外す（条件はそのままなので、検索し直さなくても残りを続けて消せる）
      setResults((prev) => prev.map((r) => (r.ok ? { ...r, value: { ...r.value, runs: r.value.runs.filter((run) => !deleted.has(run.id)) } } : r)));
      setPhase({ phase: "results" });
      setNotice(
        errors.length > 0
          ? { kind: "deleteFailed", deleted: deleted.size, failed: errors.length, errors }
          : stopped
            ? { kind: "stopped", count: deleted.size }
            : { kind: "deleted", count: deleted.size },
      );
    });
  }

  return {
    criteria,
    setCriteria: <K extends keyof RunCleanupCriteria>(key: K, value: RunCleanupCriteria[K]) => setCriteria(key, value),
    phase,
    stale,
    searched: () => searchedWith() !== null,
    groups,
    failures: createMemo(() => results().flatMap((r) => (r.ok ? [] : [{ repo: r.item, error: r.error }]))),
    targets,
    targetRepoCount: createMemo(() => groups().filter((g) => !excluded().has(g.key)).length),
    isIncluded: (key: string) => !excluded().has(key),
    toggleRepo(key: string) {
      const next = new Set(excluded());
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setExcluded(next);
    },
    setAll(include: boolean) {
      setExcluded(include ? new Set<string>() : new Set(groups().map((g) => g.key)));
    },
    search,
    askDelete: () => phase().phase === "results" && targets().length > 0 && !stale() && setPhase({ phase: "confirm" }),
    cancelDelete: () => setPhase({ phase: "results" }),
    deleteTargets,
    /** 検索や削除を途中で止める。削除済みのものは戻らない */
    stop: () => abort?.abort(),
    notice,
    dismissNotice: () => setNotice(null),
  };
}

export type RunCleanupState = ReturnType<typeof createRunCleanupState>;

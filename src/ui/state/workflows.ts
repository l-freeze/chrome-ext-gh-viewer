// Actions タブの状態: リポジトリごとのワークフロー一覧と最新の実行。

import { batch, createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { listWorkflowsForRepos, type RepoWorkflowsResult, type WorkflowWithRun } from "../../api/aggregate";
import { GitHubApiError } from "../../api/errors";
import type { Repository } from "../../api/types";
import { toRepoRef } from "../../services/workspace";
import type { AppDeps } from "./context";
import type { WorkspaceState } from "./workspace";

export interface WorkflowGroup {
  repo: Repository;
  key: string;
  workflows: WorkflowWithRun[];
}

export function createWorkflowsState(_deps: AppDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const [results, setResults] = createSignal<ReadonlyMap<string, RepoWorkflowsResult>>(new Map());
  const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
  const [text, setText] = createSignal("");
  const [hideDisabled, setHideDisabled] = createSignal(true);
  let abort: AbortController | null = null;

  const keyOf = (r: Repository) => r.fullName.toLowerCase();

  async function load(repos: readonly Repository[], force: boolean) {
    const router = ws.router();
    if (!router) return;
    const cache = force ? new Map<string, RepoWorkflowsResult>() : new Map(results());
    if (force) setResults(cache);
    const missing = repos.filter((r) => !cache.has(keyOf(r)));
    if (missing.length === 0) return;

    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    setProgress({ done: 0, total: missing.length });
    try {
      await listWorkflowsForRepos((repo) => router.forRepo(toRepoRef(repo)), missing, {
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

  // タブを開いているときだけ読み込む。作業範囲を取り直したときは先にキャッシュを捨てる
  let lastWorkspace: unknown;
  createEffect(
    on([ws.workspace, active, ws.router, ws.selectedRepos], ([workspace, isActive]) => {
      if (workspace !== lastWorkspace) {
        lastWorkspace = workspace;
        abort?.abort();
        setResults(new Map());
      }
      if (isActive) void load(ws.selectedRepos().map((r) => r.repo), false);
    }),
  );

  const selectedResults = createMemo(() =>
    ws
      .selectedRepos()
      .map((r) => results().get(keyOf(r.repo)))
      .filter((r): r is RepoWorkflowsResult => r !== undefined),
  );

  const groups = createMemo((): WorkflowGroup[] => {
    const terms = text().toLowerCase().split(/\s+/).filter(Boolean);
    return selectedResults()
      .flatMap((r) => (r.ok ? [r] : []))
      .map((r) => ({
        repo: r.repo,
        key: r.repo.fullName,
        workflows: r.workflows.filter(({ workflow }) => {
          if (hideDisabled() && workflow.state !== "active") return false;
          const haystack = `${r.repo.fullName}\n${workflow.name}\n${workflow.path}`.toLowerCase();
          return terms.every((t) => haystack.includes(t));
        }),
      }))
      .filter((g) => g.workflows.length > 0);
  });

  return {
    progress,
    text,
    setText,
    hideDisabled,
    setHideDisabled,
    groups,
    count: createMemo(() => groups().reduce((n, g) => n + g.workflows.length, 0)),
    total: createMemo(() => selectedResults().reduce((n, r) => n + (r.ok ? r.workflows.length : 0), 0)),
    failures: createMemo(() =>
      selectedResults().filter((r): r is Extract<RepoWorkflowsResult, { ok: false }> => !r.ok),
    ),
    refresh: () => void load(ws.selectedRepos().map((r) => r.repo), true),
    /** 1 つのリポジトリだけ取り直す（実行後に最新の実行を反映するため） */
    refreshRepo(repo: Repository) {
      setResults((prev) => {
        const next = new Map(prev);
        next.delete(keyOf(repo));
        return next;
      });
      void load([repo], false);
    },
  };
}

export type WorkflowsState = ReturnType<typeof createWorkflowsState>;

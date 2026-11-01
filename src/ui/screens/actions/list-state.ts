// Actions タブ（ワークフロー一覧）の状態: リポジトリごとのワークフローと最新の実行。
// 自動更新がオンなら、実行中・待機中のものがある間だけ、間隔をあけて最新の実行を取り直す。

import { createMemo, createSignal, type Accessor } from "solid-js";
import type { WorkflowWithRun } from "../../../features/actions/workflow";
import type { Repository } from "../../../features/workspace/repository";
import { mapWithConcurrency } from "../../../lib/concurrency";
import { mergeList } from "../../../lib/reuse";
import { createPolling } from "../../app/auto-refresh";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { createRepoResults } from "../../lists/repo-results";

/** 実行中・待機中の実行があるとき、状態を取り直す間隔 */
export const RUNNING_POLL_INTERVAL_MS = 60_000;

export interface WorkflowGroup {
  repo: Repository;
  key: string;
  workflows: WorkflowWithRun[];
}

export function createWorkflowListState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>, autoRefresh: Accessor<boolean>) {
  const ops = deps.manager.actions;
  const [text, setText] = createSignal("");
  const [hideDisabled, setHideDisabled] = createSignal(true);

  // タブを開いているときだけ読み込む
  const results = createRepoResults<WorkflowWithRun[]>({
    ws,
    fetch: (repos, options) => ops.list(repos, options),
    now: deps.manager.now,
    active,
    merge: mergeList((w) => w.workflow.id),
  });

  const groups = createMemo((): WorkflowGroup[] => {
    const terms = text().toLowerCase().split(/\s+/).filter(Boolean);
    return results
      .values()
      .map(({ repo, value }) => ({
        repo,
        key: repo.fullName,
        workflows: value.filter(({ workflow }) => {
          if (hideDisabled() && workflow.state !== "active") return false;
          const haystack = `${repo.fullName}\n${workflow.name}\n${workflow.path}`.toLowerCase();
          return terms.every((t) => haystack.includes(t));
        }),
      }))
      .filter((g) => g.workflows.length > 0);
  });

  /** 最新の実行がまだ終わっていないワークフローを持つリポジトリ */
  const reposWithRunning = createMemo(() =>
    results
      .values()
      .filter(({ value }) => value.some((w) => w.lastRun !== null && w.lastRun.status !== "completed"))
      .map(({ repo }) => repo),
  );

  /** 実行履歴だけを取り直し、各ワークフローの最新の実行を差し替える */
  async function pollRuns(repos: readonly Repository[]) {
    const updates = new Map<number, Awaited<ReturnType<typeof ops.latestRuns>>>();
    await mapWithConcurrency(repos, 4, async (repo) => {
      try {
        updates.set(repo.id, await ops.latestRuns(repo));
      } catch {
        // 一時的な失敗は次の回に任せる（一覧の表示はそのまま）
      }
    });
    results.update((repo, list) => {
      const latest = updates.get(repo.id);
      return latest ? list.map((w) => ({ ...w, lastRun: latest.get(w.workflow.id) ?? w.lastRun })) : list;
    });
  }

  // ブラウザのタブが裏にあるときは問い合わせない
  createPolling({
    when: () => autoRefresh() && active() && reposWithRunning().length > 0,
    intervalMs: RUNNING_POLL_INTERVAL_MS,
    run: () => pollRuns(reposWithRunning()),
  });

  return {
    results,
    text,
    setText,
    hideDisabled,
    setHideDisabled,
    groups,
    count: createMemo(() => groups().reduce((n, g) => n + g.workflows.length, 0)),
    total: createMemo(() => results.values().reduce((n, r) => n + r.value.length, 0)),
    /** 1 つのリポジトリだけ取り直す（実行後に最新の実行を反映するため） */
    reload: (repo: Repository) => results.reload([repo]),
  };
}

export type WorkflowListState = ReturnType<typeof createWorkflowListState>;

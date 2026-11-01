// ワークフローと実行。実行の状態の分類と、手動実行の候補にできるかの判定。

import type { RepoRef, UserRef } from "../workspace/repository";

export interface Workflow {
  id: number;
  repo: RepoRef;
  name: string;
  /** .github/workflows/ci.yml など。GitHub が内部で動かすものは dynamic/... になる */
  path: string;
  /** active / disabled_manually / disabled_inactivity など */
  state: string;
  htmlUrl: string;
}

export interface WorkflowRun {
  id: number;
  workflowId: number;
  repo: RepoRef;
  /** ワークフロー名 */
  name: string | null;
  /** 実行の表示名（コミットメッセージや PR のタイトル） */
  displayTitle: string | null;
  runNumber: number;
  /** queued / in_progress / completed など */
  status: string | null;
  /** success / failure / cancelled など。完了前は null */
  conclusion: string | null;
  event: string;
  headBranch: string | null;
  actor: UserRef | null;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface WorkflowWithRun {
  workflow: Workflow;
  /** 最近の実行履歴（1 ページ分）の中での最新の実行。なければ null */
  lastRun: WorkflowRun | null;
}

/** 新しい順に並んだ実行履歴から、ワークフローごとの最新の実行を取り出す */
export function latestRunByWorkflow(runs: readonly WorkflowRun[]): Map<number, WorkflowRun> {
  const latest = new Map<number, WorkflowRun>();
  for (const run of runs) {
    const cur = latest.get(run.workflowId);
    if (!cur || Date.parse(run.createdAt) > Date.parse(cur.createdAt)) latest.set(run.workflowId, run);
  }
  return latest;
}

/** GitHub が内部で動かすワークフロー（Dependabot、CodeQL の既定設定など）。手動実行できない */
export function isDynamicWorkflow(w: Pick<Workflow, "path">): boolean {
  return w.path.startsWith("dynamic/");
}

/** 手動実行の候補にできるか（有効で、YAML ファイルのあるワークフロー） */
export function canTryDispatch(w: Pick<Workflow, "path" | "state">): boolean {
  return w.state === "active" && !isDynamicWorkflow(w);
}

export type RunBadge = "success" | "failure" | "cancelled" | "running" | "queued" | "skipped" | "other" | "none";

/** 実行の状態を表示用の分類にする */
export function runBadge(run: Pick<WorkflowRun, "status" | "conclusion"> | null): RunBadge {
  if (!run) return "none";
  if (run.status === "queued" || run.status === "waiting" || run.status === "pending" || run.status === "requested") return "queued";
  if (run.status !== "completed") return "running";
  switch (run.conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
    case "startup_failure":
      return "failure";
    case "cancelled":
      return "cancelled";
    case "skipped":
    case "neutral":
      return "skipped";
    default:
      return "other";
  }
}

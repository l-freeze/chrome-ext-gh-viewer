// 実行履歴の整理: 検索条件の組み立てと、見つかった実行のまとめ。

import { DAY_MS, utcDate } from "../../lib/time";
import type { WorkflowRun } from "./workflow";

export type RunConclusionFilter = "all" | "success" | "failure" | "cancelled" | "skipped";

export interface RunCleanupCriteria {
  /** 作成からこの日数より前の実行だけを対象にする */
  olderThanDays: number;
  conclusion: RunConclusionFilter;
  /** ワークフロー名の部分一致（空ならすべて） */
  workflowQuery: string;
}

export const DEFAULT_RUN_CLEANUP: RunCleanupCriteria = { olderThanDays: 30, conclusion: "all", workflowQuery: "" };

/** 一度に検索する実行履歴の上限（GitHub は条件付きの検索で 1,000 件までしか返さない） */
export const MAX_RUNS_PER_REPO = 1000;

/**
 * API の検索条件。完了していない実行は消さないよう、status は常に完了系にする。
 * created は「この日より前」（UTC の日付）
 */
export function runSearchFilter(c: RunCleanupCriteria, nowMs: number): { created: string; status: string } {
  const days = Math.max(0, Math.floor(c.olderThanDays));
  const before = utcDate(nowMs - days * DAY_MS);
  return { created: `<${before}`, status: c.conclusion === "all" ? "completed" : c.conclusion };
}

export function matchesWorkflow(run: Pick<WorkflowRun, "name">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || (run.name ?? "").toLowerCase().includes(q);
}

export interface RunGroupSummary {
  count: number;
  /** ワークフロー名ごとの件数（多い順） */
  byWorkflow: Array<{ name: string; count: number }>;
  oldest: string | null;
  newest: string | null;
}

export function summarizeRuns(runs: readonly WorkflowRun[]): RunGroupSummary {
  const counts = new Map<string, number>();
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const r of runs) {
    const name = r.name ?? "—";
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (oldest === null || Date.parse(r.createdAt) < Date.parse(oldest)) oldest = r.createdAt;
    if (newest === null || Date.parse(r.createdAt) > Date.parse(newest)) newest = r.createdAt;
  }
  return {
    count: runs.length,
    byWorkflow: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    oldest,
    newest,
  };
}

import { settleEach } from "../../../lib/concurrency";
import { toRepoRef, type Repository } from "../../workspace/repository";
import type { ActionsOperations, ActionsSource } from "../ports";
import { latestRunByWorkflow, runsByWorkflow, type WorkflowRun } from "../workflow";

/** ワークフローの一覧を取り、ワークフローがあれば最近の実行（1 ページ分）と、その中の最新のものを付ける */
export function createListWorkflows(source: ActionsSource): ActionsOperations["list"] {
  return (repos, options = {}) =>
    settleEach(
      repos,
      async (repo, signal) => {
        const ref = toRepoRef(repo);
        const workflows = await source.listWorkflows(ref, signal);
        const runs: WorkflowRun[] = workflows.length > 0 ? await source.listRecentRuns(ref, signal) : [];
        const latest = latestRunByWorkflow(runs);
        const byWorkflow = runsByWorkflow(runs);
        return workflows.map((workflow) => ({ workflow, lastRun: latest.get(workflow.id) ?? null, recentRuns: byWorkflow.get(workflow.id) ?? [] }));
      },
      { concurrency: 6, ...options },
    );
}

export function createLatestRuns(source: ActionsSource): (repo: Repository) => Promise<Map<number, WorkflowRun>> {
  return async (repo) => latestRunByWorkflow(await source.listRecentRuns(toRepoRef(repo)));
}

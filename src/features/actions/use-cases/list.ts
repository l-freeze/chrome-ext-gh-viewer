import { settleEach } from "../../../lib/concurrency";
import { toRepoRef, type Repository } from "../../workspace/repository";
import type { ActionsOperations, ActionsSource } from "../ports";
import { latestRunByWorkflow, type WorkflowRun } from "../workflow";

/** ワークフローの一覧を取り、ワークフローがあれば最近の実行から最新のものを付ける */
export function createListWorkflows(source: ActionsSource): ActionsOperations["list"] {
  return (repos, options = {}) =>
    settleEach(
      repos,
      async (repo, signal) => {
        const ref = toRepoRef(repo);
        const workflows = await source.listWorkflows(ref, signal);
        const latest = workflows.length > 0 ? latestRunByWorkflow(await source.listRecentRuns(ref, signal)) : new Map<number, WorkflowRun>();
        return workflows.map((workflow) => ({ workflow, lastRun: latest.get(workflow.id) ?? null }));
      },
      { concurrency: 6, ...options },
    );
}

export function createLatestRuns(source: ActionsSource): (repo: Repository) => Promise<Map<number, WorkflowRun>> {
  return async (repo) => latestRunByWorkflow(await source.listRecentRuns(toRepoRef(repo)));
}

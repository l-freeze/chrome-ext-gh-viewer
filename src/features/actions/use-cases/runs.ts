import { settleEach } from "../../../lib/concurrency";
import { toRepoRef } from "../../workspace/repository";
import { MAX_RUNS_PER_REPO, runSearchFilter } from "../cleanup";
import type { ActionsOperations, ActionsSource } from "../ports";

/** 条件（作成日・結果）に合う完了した実行を、リポジトリごとに探す */
export function createSearchRuns(source: ActionsSource, now: () => number): ActionsOperations["searchRuns"] {
  return (repos, criteria, options = {}) => {
    const filter = runSearchFilter(criteria, now());
    return settleEach(repos, (repo, signal) => source.searchRuns(toRepoRef(repo), filter, MAX_RUNS_PER_REPO, signal), {
      concurrency: 4,
      ...options,
    });
  };
}

export function createRemoveRuns(source: ActionsSource): ActionsOperations["removeRuns"] {
  return (runs, options = {}) => settleEach(runs, (run, signal) => source.removeRun(run, signal), { concurrency: 2, ...options });
}

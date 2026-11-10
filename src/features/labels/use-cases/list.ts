import { settleEach } from "../../../lib/concurrency";
import { toRepoRef } from "../../workspace/repository";
import type { LabelOperations, LabelSource } from "../ports";

export function createListLabels(source: LabelSource): LabelOperations["list"] {
  return (repos, options = {}) =>
    settleEach(repos, async (repo, signal) => (repo.archived ? [] : source.list(toRepoRef(repo), signal)), { concurrency: 6, ...options });
}

import { settleEach } from "../../../lib/concurrency";
import { toRepoRef } from "../../workspace/repository";
import type { ReleaseOperations, ReleaseSource } from "../ports";

export function createListReleases(source: ReleaseSource): ReleaseOperations["list"] {
  return (repos, options = {}) => settleEach(repos, (repo, signal) => source.list(toRepoRef(repo), signal), { concurrency: 6, ...options });
}

import { settleEach } from "../../../lib/concurrency";
import { toRepoRef } from "../../workspace/repository";
import type { CacheOperations, CacheSource } from "../ports";

export function createListCaches(source: CacheSource): CacheOperations["list"] {
  return (repos, options = {}) => settleEach(repos, (repo, signal) => source.list(toRepoRef(repo), signal), { concurrency: 6, ...options });
}

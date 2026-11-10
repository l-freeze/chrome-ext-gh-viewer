import { settleEach } from "../../../lib/concurrency";
import type { RepoSettingsOperations, RepoSettingsSource } from "../ports";

export function createListRepoSettings(source: RepoSettingsSource): RepoSettingsOperations["list"] {
  return (repos, options = {}) =>
    settleEach(repos, async (repo, signal) => (repo.archived ? null : source.get(repo, signal)), { concurrency: 4, ...options });
}

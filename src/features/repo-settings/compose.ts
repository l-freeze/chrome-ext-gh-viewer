import type { RepoSettingsOperations, RepoSettingsSource } from "./ports";
import { createChangeDefaultBranch, createChangeVisibility } from "./use-cases/change";
import { createListRepoSettings } from "./use-cases/list";

export function createRepoSettingsFeature(dependencies: { source: RepoSettingsSource }): RepoSettingsOperations {
  const { source } = dependencies;
  return {
    list: createListRepoSettings(source),
    listBranches: (repo, signal) => source.listBranches(repo, signal),
    setVisibility: createChangeVisibility(source),
    setDefaultBranch: createChangeDefaultBranch(source),
  };
}

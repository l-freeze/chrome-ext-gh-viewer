import type { RepoSettingsOperations, RepoSettingsSource } from "./ports";
import { createListRepoSettings } from "./use-cases/list";

export function createRepoSettingsFeature(dependencies: { source: RepoSettingsSource }): RepoSettingsOperations {
  return { list: createListRepoSettings(dependencies.source) };
}

import type { DisplayPreferencesRepository, PreferenceOperations } from "./ports";

export function createPreferencesFeature(dependencies: { repository: DisplayPreferencesRepository }): PreferenceOperations {
  const { repository } = dependencies;
  return { load: () => repository.load(), save: (p) => repository.save(p) };
}

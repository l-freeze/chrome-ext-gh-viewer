import type { OwnerSelectionRepository, RepositorySource, WorkspaceOperations } from "./ports";
import { createDiscover } from "./use-cases/discover";
import { createToggleOwner } from "./use-cases/select";

export function createWorkspaceFeature(dependencies: {
  source: RepositorySource;
  selection: OwnerSelectionRepository;
}): WorkspaceOperations {
  return {
    discover: createDiscover(dependencies.source),
    loadHiddenOwners: () => dependencies.selection.load(),
    toggleOwner: createToggleOwner(dependencies.selection),
  };
}

import type { BoardPreferencesRepository, ProjectOperations, ProjectSource } from "./ports";
import { createListProjects } from "./use-cases/list-projects";
import { createLoadBoard } from "./use-cases/load-board";
import { createMoveItem } from "./use-cases/move-item";
import { createMoveToProject } from "./use-cases/move-to-project";

export function createProjectsFeature(dependencies: {
  source: ProjectSource;
  preferences: BoardPreferencesRepository;
}): ProjectOperations {
  const { source, preferences } = dependencies;
  return {
    listProjects: createListProjects(source),
    loadBoard: createLoadBoard(source),
    moveItem: createMoveItem(source),
    moveToProject: createMoveToProject(source),
    loadPreferences: () => preferences.load(),
    savePreferences: (p) => preferences.save(p),
  };
}

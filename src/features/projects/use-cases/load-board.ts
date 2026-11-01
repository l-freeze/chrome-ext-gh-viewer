import { pickStatusField } from "../project";
import type { ProjectOperations, ProjectSource } from "../ports";

export function createLoadBoard(source: ProjectSource): ProjectOperations["loadBoard"] {
  return async (project, signal) => {
    const field = pickStatusField(await source.listSelectFields(project, signal));
    const items = await source.listItems(project, field?.id ?? null, signal);
    return { project, field, items };
  };
}

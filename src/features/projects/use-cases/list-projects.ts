import { openProjects } from "../project";
import type { OwnerProjects, ProjectOperations, ProjectSource } from "../ports";

/** 所有者ごとに順に取得する（所有者の数は多くないため） */
export function createListProjects(source: ProjectSource): ProjectOperations["listProjects"] {
  return async (owners, options = {}) => {
    const results: OwnerProjects[] = [];
    for (const owner of owners) {
      let result: OwnerProjects;
      try {
        result = { owner, projects: openProjects(await source.listProjects(owner, options.signal)), error: null };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        result = { owner, projects: [], error };
      }
      results.push(result);
      options.onOwnerDone?.(result);
    }
    return results;
  };
}

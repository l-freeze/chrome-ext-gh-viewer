import type { IssueOperations, IssueSource, OwnerIssues } from "../ports";

export function createSearchIssues(source: IssueSource): IssueOperations["search"] {
  return async (owners, state, options = {}) => {
    const results: OwnerIssues[] = [];
    for (const owner of owners) {
      let result: OwnerIssues;
      try {
        result = { owner, ...(await source.searchOwner(owner, state, options.signal)), error: null };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        result = { owner, issues: [], truncated: false, error };
      }
      results.push(result);
      options.onOwnerDone?.(result);
    }
    return results;
  };
}

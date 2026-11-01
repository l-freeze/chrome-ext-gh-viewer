import type { IssueOperations, IssueSource } from "./ports";
import { createSearchIssues } from "./use-cases/search";

export function createIssuesFeature(dependencies: { source: IssueSource }): IssueOperations {
  return { search: createSearchIssues(dependencies.source) };
}

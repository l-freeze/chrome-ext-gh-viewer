import { createDispatchController } from "./controllers/dispatch";
import type { ActionsOperations, ActionsSource } from "./ports";
import { createDispatchWorkflow } from "./use-cases/dispatch";
import { createLatestRuns, createListWorkflows } from "./use-cases/list";
import { createPrepareDispatch, createReadDispatchSpec } from "./use-cases/prepare";
import { createRemoveRuns, createSearchRuns } from "./use-cases/runs";

export function createActionsFeature(dependencies: { source: ActionsSource; now: () => number }): ActionsOperations {
  const { source, now } = dependencies;
  return {
    list: createListWorkflows(source),
    latestRuns: createLatestRuns(source),
    prepareDispatch: createPrepareDispatch(source),
    readDispatchSpec: createReadDispatchSpec(source),
    dispatch: createDispatchController(createDispatchWorkflow(source)),
    searchRuns: createSearchRuns(source, now),
    removeRuns: createRemoveRuns(source),
  };
}

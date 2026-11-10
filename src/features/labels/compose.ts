import type { LabelOperations, LabelSource } from "./ports";
import { createApplyLabelChanges } from "./use-cases/apply";
import { createListLabels } from "./use-cases/list";
import { createRemoveLabels } from "./use-cases/remove";

export function createLabelsFeature(dependencies: { source: LabelSource }): LabelOperations {
  return {
    list: createListLabels(dependencies.source),
    apply: createApplyLabelChanges(dependencies.source),
    remove: createRemoveLabels(dependencies.source),
  };
}

import type { LabelOperations, LabelSource } from "./ports";
import { createApplyLabelChanges } from "./use-cases/apply";
import { createListLabels } from "./use-cases/list";

export function createLabelsFeature(dependencies: { source: LabelSource }): LabelOperations {
  return { list: createListLabels(dependencies.source), apply: createApplyLabelChanges(dependencies.source) };
}

import { settleEach } from "../../../lib/concurrency";
import type { LabelOperations, LabelSource } from "../ports";

export function createRemoveLabels(source: LabelSource): LabelOperations["remove"] {
  return (labels, options = {}) => settleEach(labels, (label, signal) => source.remove(label.repo, label.name, signal), { ...options, concurrency: 1 });
}

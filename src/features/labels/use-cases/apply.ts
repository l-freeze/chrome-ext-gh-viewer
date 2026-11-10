import { settleEach } from "../../../lib/concurrency";
import type { LabelOperations, LabelSource } from "../ports";

export function createApplyLabelChanges(source: LabelSource): LabelOperations["apply"] {
  return (changes, options = {}) =>
    settleEach(
      changes,
      (change, signal) =>
        change.kind === "create"
          ? source.create(change.repo, change.next, signal)
          : source.update(change.repo, change.current.name, change.next, signal),
      { ...options, concurrency: 1 },
    );
}

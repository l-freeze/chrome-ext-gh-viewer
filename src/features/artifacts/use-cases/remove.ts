import { settleEach } from "../../../lib/concurrency";
import type { ArtifactOperations, ArtifactSource } from "../ports";

export function createRemoveArtifacts(source: ArtifactSource): ArtifactOperations["remove"] {
  return (items, options = {}) => settleEach(items, (item, signal) => source.remove(item, signal), { concurrency: 2, ...options });
}

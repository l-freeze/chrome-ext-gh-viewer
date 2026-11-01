import { settleEach } from "../../../lib/concurrency";
import type { CacheOperations, CacheSource } from "../ports";

export function createRemoveCaches(source: CacheSource): CacheOperations["remove"] {
  return (items, options = {}) => settleEach(items, (item, signal) => source.remove(item, signal), { concurrency: 2, ...options });
}

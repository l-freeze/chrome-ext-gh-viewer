import type { CacheOperations, CacheSource } from "./ports";
import { createListCaches } from "./use-cases/list";
import { createRemoveCaches } from "./use-cases/remove";

export function createCachesFeature(dependencies: { source: CacheSource }): CacheOperations {
  return { list: createListCaches(dependencies.source), remove: createRemoveCaches(dependencies.source) };
}

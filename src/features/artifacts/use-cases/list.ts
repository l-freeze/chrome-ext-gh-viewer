import { settleEach } from "../../../lib/concurrency";
import { toRepoRef } from "../../workspace/repository";
import type { ArtifactOperations, ArtifactSource } from "../ports";

export function createListArtifacts(source: ArtifactSource): ArtifactOperations["list"] {
  return (repos, options = {}) => settleEach(repos, (repo, signal) => source.list(toRepoRef(repo), signal), { concurrency: 6, ...options });
}

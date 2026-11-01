import type { ArtifactOperations, ArtifactSource, Downloader } from "./ports";
import { createDownloadArtifact } from "./use-cases/download";
import { createListArtifacts } from "./use-cases/list";
import { createRemoveArtifacts } from "./use-cases/remove";

export function createArtifactsFeature(dependencies: { source: ArtifactSource; downloader: Downloader }): ArtifactOperations {
  return {
    list: createListArtifacts(dependencies.source),
    remove: createRemoveArtifacts(dependencies.source),
    download: createDownloadArtifact(dependencies.source, dependencies.downloader),
    onDownloadInterrupted: (listener) => dependencies.downloader.onInterrupted(listener),
  };
}

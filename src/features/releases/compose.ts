import type { Downloader, ReleaseOperations, ReleaseSource } from "./ports";
import { createDownloadAsset } from "./use-cases/download";
import { createListReleases } from "./use-cases/list";

export function createReleasesFeature(dependencies: { source: ReleaseSource; downloader: Downloader }): ReleaseOperations {
  const { source, downloader } = dependencies;
  return {
    list: createListReleases(source),
    download: createDownloadAsset(source, downloader),
    onDownloadInterrupted: (listener) => downloader.onInterrupted(listener),
  };
}

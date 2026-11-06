import { downloadFilename } from "../artifact";
import type { ArtifactOperations, ArtifactSource, Downloader } from "../ports";

export function createDownloadArtifact(source: ArtifactSource, downloader: Downloader): ArtifactOperations["download"] {
  return async (item) => downloader.start({ url: await source.downloadUrl(item), filename: downloadFilename(item) });
}

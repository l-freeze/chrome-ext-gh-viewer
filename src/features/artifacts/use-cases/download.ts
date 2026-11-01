import { downloadFilename } from "../artifact";
import type { ArtifactOperations, ArtifactSource, Downloader } from "../ports";

export function createDownloadArtifact(source: ArtifactSource, downloader: Downloader): ArtifactOperations["download"] {
  return (item) => downloader.start({ ...source.downloadRequest(item), filename: downloadFilename(item) });
}

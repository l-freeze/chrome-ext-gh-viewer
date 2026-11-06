import type { Downloader, ReleaseOperations, ReleaseSource } from "../ports";

/** 添付ファイルの名前のまま保存する（同じ名前があれば Chrome が番号を付ける） */
export function createDownloadAsset(source: ReleaseSource, downloader: Downloader): ReleaseOperations["download"] {
  return (asset) => downloader.start({ ...source.downloadRequest(asset), filename: asset.name });
}

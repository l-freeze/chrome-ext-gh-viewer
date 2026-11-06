import type { Downloader, ReleaseOperations, ReleaseSource } from "../ports";

/** 添付ファイルの名前のまま保存する（同じ名前があれば Chrome が番号を付ける） */
export function createDownloadAsset(source: ReleaseSource, downloader: Downloader): ReleaseOperations["download"] {
  return async (asset) => downloader.start({ url: await source.downloadUrl(asset), filename: asset.name });
}

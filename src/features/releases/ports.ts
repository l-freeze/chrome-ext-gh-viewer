import type { Settled, SettleOptions } from "../../lib/concurrency";
import type { RepoRef, Repository } from "../workspace/repository";
import type { Release, ReleaseAsset } from "./release";

/** 画面から呼ぶ操作（閲覧とダウンロードのみ） */
export interface ReleaseOperations {
  /** リポジトリごとに新しい順の Release（最大 100 件）を集める */
  list(repos: readonly Repository[], options?: SettleOptions<Repository, Release[]>): Promise<Settled<Repository, Release[]>[]>;
  /** 添付ファイルのダウンロードを開始し、ダウンロード ID を返す */
  download(asset: ReleaseAsset): Promise<number>;
  onDownloadInterrupted(listener: (id: number, reason: string) => void): () => void;
}

export interface ReleaseSource {
  list(repo: RepoRef, signal?: AbortSignal): Promise<Release[]>;
  /** 認証なしで取れる、ダウンロード用の URL */
  downloadUrl(asset: ReleaseAsset): Promise<string>;
}

export interface Downloader {
  start(request: { url: string; filename: string }): Promise<number>;
  onInterrupted(listener: (id: number, reason: string) => void): () => void;
}

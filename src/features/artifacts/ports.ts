import type { Settled, SettleOptions } from "../../lib/concurrency";
import type { RepoRef, Repository } from "../workspace/repository";
import type { Artifact } from "./artifact";

/** 画面から呼ぶ操作 */
export interface ArtifactOperations {
  /** リポジトリごとにアーティファクトを集める。失敗したリポジトリはエラーとして返す */
  list(repos: readonly Repository[], options?: SettleOptions<Repository, Artifact[]>): Promise<Settled<Repository, Artifact[]>[]>;
  /** 1 件ずつ削除する。すでに消えているものは成功とみなす */
  remove(items: readonly Artifact[], options?: SettleOptions<Artifact, void>): Promise<Settled<Artifact, void>[]>;
  /** ダウンロードを開始し、ダウンロード ID を返す */
  download(item: Artifact): Promise<number>;
  onDownloadInterrupted(listener: (id: number, reason: string) => void): () => void;
}

export interface ArtifactSource {
  list(repo: RepoRef, signal?: AbortSignal): Promise<Artifact[]>;
  remove(item: Artifact, signal?: AbortSignal): Promise<void>;
  downloadRequest(item: Artifact): { url: string; headers: Array<{ name: string; value: string }> };
}

export interface Downloader {
  start(request: { url: string; headers: Array<{ name: string; value: string }>; filename: string }): Promise<number>;
  onInterrupted(listener: (id: number, reason: string) => void): () => void;
}

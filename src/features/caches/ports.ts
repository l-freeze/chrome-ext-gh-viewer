import type { Settled, SettleOptions } from "../../lib/concurrency";
import type { RepoRef, Repository } from "../workspace/repository";
import type { ActionsCache } from "./cache";

/** 画面から呼ぶ操作 */
export interface CacheOperations {
  list(repos: readonly Repository[], options?: SettleOptions<Repository, ActionsCache[]>): Promise<Settled<Repository, ActionsCache[]>[]>;
  /** 1 件ずつ削除する。すでに消えているものは成功とみなす */
  remove(items: readonly ActionsCache[], options?: SettleOptions<ActionsCache, void>): Promise<Settled<ActionsCache, void>[]>;
}

export interface CacheSource {
  list(repo: RepoRef, signal?: AbortSignal): Promise<ActionsCache[]>;
  remove(item: ActionsCache, signal?: AbortSignal): Promise<void>;
}

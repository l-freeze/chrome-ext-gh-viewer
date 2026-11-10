import type { Settled, SettleOptions } from "../../lib/concurrency";
import type { Repository } from "../workspace/repository";
import type { RepoSettings } from "./settings";

/** 画面から呼ぶ操作（閲覧のみ） */
export interface RepoSettingsOperations {
  /** リポジトリごとの設定。アーカイブ済みのリポジトリは呼ばずに対象外（null）とする */
  list(repos: readonly Repository[], options?: SettleOptions<Repository, RepoSettings | null>): Promise<Settled<Repository, RepoSettings | null>[]>;
}

export interface RepoSettingsSource {
  /** 既定のブランチは、リポジトリから読んだもの（無ければ一覧の値）を使う */
  get(repo: Repository, signal?: AbortSignal): Promise<RepoSettings>;
}

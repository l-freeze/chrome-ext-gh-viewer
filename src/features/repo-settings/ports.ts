import type { Settled, SettleOptions } from "../../lib/concurrency";
import type { Repository } from "../workspace/repository";
import type { RepoSettings } from "./settings";

export type Visibility = "public" | "private";

/** 画面から呼ぶ操作 */
export interface RepoSettingsOperations {
  /** リポジトリごとの設定。アーカイブ済みのリポジトリは呼ばずに対象外（null）とする */
  list(repos: readonly Repository[], options?: SettleOptions<Repository, RepoSettings | null>): Promise<Settled<Repository, RepoSettings | null>[]>;
  /** 既定のブランチを選ぶためのブランチの一覧 */
  listBranches(repo: Repository, signal?: AbortSignal): Promise<string[]>;
  /** 公開範囲を変える。画面の 2 段階の確認を経てから呼ぶ。変えたあとの設定を返す */
  setVisibility(repo: Repository, visibility: Visibility): Promise<RepoSettings>;
  /** 既定のブランチを変える（既存のブランチだけ）。画面の確認を経てから呼ぶ。変えたあとの設定を返す */
  setDefaultBranch(repo: Repository, branch: string): Promise<RepoSettings>;
}

export interface RepoSettingsSource {
  /** 既定のブランチは、リポジトリから読んだもの（無ければ一覧の値）を使う */
  get(repo: Repository, signal?: AbortSignal): Promise<RepoSettings>;
  listBranches(repo: Repository, signal?: AbortSignal): Promise<string[]>;
  update(repo: Repository, update: { visibility?: Visibility; defaultBranch?: string }): Promise<void>;
}

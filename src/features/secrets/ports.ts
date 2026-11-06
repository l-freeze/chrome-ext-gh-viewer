import type { Settled, SettleOptions } from "../../lib/concurrency";
import type { RepoRef, Repository } from "../workspace/repository";
import type { ConfigItem } from "./item";

/** 画面から呼ぶ操作（閲覧のみ） */
export interface SecretOperations {
  /** リポジトリごとに、リポジトリ単位と Environment 単位の Secrets と Variables を集める */
  list(repos: readonly Repository[], options?: SettleOptions<Repository, ConfigItem[]>): Promise<Settled<Repository, ConfigItem[]>[]>;
}

export interface SecretSource {
  listRepoSecrets(repo: RepoRef, signal?: AbortSignal): Promise<ConfigItem[]>;
  listRepoVariables(repo: RepoRef, signal?: AbortSignal): Promise<ConfigItem[]>;
  /** Environment の名前。Environment を使えないリポジトリでは空 */
  listEnvironments(repo: RepoRef, signal?: AbortSignal): Promise<string[]>;
  listEnvironmentSecrets(repo: RepoRef, environment: string, signal?: AbortSignal): Promise<ConfigItem[]>;
  listEnvironmentVariables(repo: RepoRef, environment: string, signal?: AbortSignal): Promise<ConfigItem[]>;
}

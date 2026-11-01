import type { Identity, Owner, Repository, Workspace } from "./repository";

/** 画面から呼ぶ操作 */
export interface WorkspaceOperations {
  discover(identities: readonly Identity[], options?: { signal?: AbortSignal }): Promise<Workspace>;
  loadHiddenOwners(): Promise<string[]>;
  /** 所有者の表示を切り替え、選択を外した所有者の一覧を保存して返す */
  toggleOwner(hidden: readonly string[], login: string): Promise<string[]>;
}

export interface RepositorySource {
  listRepositories(identity: Identity, signal?: AbortSignal): Promise<Repository[]>;
  listOrganizations(identity: Identity, signal?: AbortSignal): Promise<Owner[]>;
}

/** 選択を外した所有者（小文字の login）の保存先 */
export interface OwnerSelectionRepository {
  load(): Promise<string[]>;
  save(hidden: string[]): Promise<void>;
}

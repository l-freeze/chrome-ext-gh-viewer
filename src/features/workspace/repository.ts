// 所有者とリポジトリ。ほかの機能も使う共通の語彙で、機能をまたいで読んでよいのはここだけ。

export type OwnerType = "User" | "Organization";

export interface Owner {
  login: string;
  id: number;
  type: OwnerType;
  avatarUrl: string;
}

export interface UserRef {
  login: string;
  avatarUrl: string;
}

export interface RepoRef {
  owner: string;
  name: string;
}

export interface Repository {
  id: number;
  owner: Owner;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  htmlUrl: string;
  pushedAt: string | null;
  /** 既定のブランチ。不明なら null */
  defaultBranch: string | null;
}

export function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

export function toRepoRef(repo: Repository): RepoRef {
  return { owner: repo.owner.login, name: repo.name };
}

export interface RepoUsage {
  repo: RepoRef;
  key: string;
  bytes: number;
  count: number;
}

/** リポジトリごとの合計（大きい順） */
export function usageByRepo<T>(items: readonly T[], repoOf: (item: T) => RepoRef, bytesOf: (item: T) => number): RepoUsage[] {
  const usage = new Map<string, RepoUsage>();
  for (const item of items) {
    const repo = repoOf(item);
    const key = repoKey(repo);
    const u = usage.get(key) ?? { repo, key, bytes: 0, count: 0 };
    u.bytes += bytesOf(item);
    u.count++;
    usage.set(key, u);
  }
  return [...usage.values()].sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));
}

/** 所有者とリポジトリを調べるのに使う認証情報（トークンそのものは持たない） */
export interface Identity {
  id: string;
  login: string;
  avatarUrl: string;
  /** 全所有者に使える（OAuth / Classic PAT）。Fine-grained PAT は所有者が限られる */
  broad: boolean;
}

export interface OwnerEntry {
  owner: Owner;
  /** この所有者の検索などに使う認証情報 */
  identityId: string;
  repoCount: number;
  /** 認証したユーザー本人のアカウントか */
  isViewer: boolean;
}

export interface RepoEntry {
  repo: Repository;
  identityId: string;
}

export interface Workspace {
  owners: OwnerEntry[];
  repos: RepoEntry[];
  /** 調べられなかった認証情報 */
  failures: Array<{ identity: Identity; error: unknown }>;
}

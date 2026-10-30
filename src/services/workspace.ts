// 認証情報ごとにアクセスできる所有者とリポジトリを調べ、1 つの作業範囲にまとめる。
// どのリポジトリ・所有者をどのトークンで呼ぶかもここで決める。

import { mapWithConcurrency } from "../api/aggregate";
import type { GitHubClient } from "../api/client";
import { GitHubApiError } from "../api/errors";
import type { Owner, RepoRef, Repository } from "../api/types";
import { repoKey } from "../domain/artifacts";
import type { Credential } from "./credentials";

export interface OwnerEntry {
  owner: Owner;
  /** この所有者の Issue 検索などに使う認証情報 */
  credentialId: string;
  repoCount: number;
  /** 認証したユーザー本人のアカウントか */
  isViewer: boolean;
}

export interface RepoEntry {
  repo: Repository;
  credentialId: string;
}

export interface CredentialFailure {
  credential: Credential;
  error: GitHubApiError;
}

export interface Workspace {
  owners: OwnerEntry[];
  repos: RepoEntry[];
  failures: CredentialFailure[];
}

export type ClientFactory = (credential: Credential) => GitHubClient;

interface Discovery {
  credential: Credential;
  orgs: Owner[];
  repos: Repository[];
}

export async function discoverWorkspace(
  credentials: readonly Credential[],
  clientFor: ClientFactory,
  options: { signal?: AbortSignal } = {},
): Promise<Workspace> {
  const call = options.signal ? { signal: options.signal } : {};
  const failures: CredentialFailure[] = [];

  const discoveries = await mapWithConcurrency(credentials, 3, async (credential): Promise<Discovery | null> => {
    const client = clientFor(credential);
    try {
      const [repos, orgs] = await Promise.all([
        client.listMyRepositories(call),
        // Fine-grained PAT などで Org 一覧が取れなくても、リポジトリから所有者はわかるので続ける
        client.listMyOrganizations(call).catch((e: unknown) => {
          if (e instanceof GitHubApiError && e.kind === "aborted") throw e;
          return [] as Owner[];
        }),
      ]);
      return { credential, orgs, repos };
    } catch (e) {
      const error = e instanceof GitHubApiError ? e : new GitHubApiError({ kind: "unexpected", message: String(e) });
      if (error.kind === "aborted") throw error;
      failures.push({ credential, error });
      return null;
    }
  });

  const repos = new Map<number, RepoEntry>();
  const owners = new Map<string, OwnerEntry>();
  const viewers = new Set(credentials.map((c) => c.login.toLowerCase()));

  const addOwner = (owner: Owner, credentialId: string) => {
    const key = owner.login.toLowerCase();
    if (!owners.has(key)) {
      owners.set(key, { owner, credentialId, repoCount: 0, isViewer: viewers.has(key) });
    }
    return owners.get(key)!;
  };

  // credentials は使える範囲の広い順に並んでいる前提。先に見つけた認証情報を優先する
  for (const d of discoveries) {
    if (!d) continue;
    for (const repo of d.repos) {
      if (repos.has(repo.id)) continue;
      repos.set(repo.id, { repo, credentialId: d.credential.id });
      addOwner(repo.owner, d.credential.id).repoCount++;
    }
    for (const org of d.orgs) addOwner(org, d.credential.id);
    // リポジトリを 1 つも持たない本人のアカウントも選べるようにする
    addOwner(
      { login: d.credential.login, id: 0, type: "User", avatarUrl: d.credential.avatarUrl },
      d.credential.id,
    );
  }

  return {
    owners: sortOwners([...owners.values()]),
    repos: [...repos.values()].sort((a, b) => a.repo.fullName.localeCompare(b.repo.fullName)),
    failures,
  };
}

/** 本人 → Organization → ほかのユーザーの順、それぞれ名前順 */
function sortOwners(list: OwnerEntry[]): OwnerEntry[] {
  const rank = (o: OwnerEntry) => (o.isViewer ? 0 : o.owner.type === "Organization" ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || a.owner.login.localeCompare(b.owner.login));
}

/** リポジトリ・所有者から、呼び出しに使うクライアントを引く */
export interface ClientRouter {
  forRepo(repo: RepoRef): GitHubClient;
  forOwner(owner: Pick<Owner, "login">): GitHubClient;
}

export function createClientRouter(
  workspace: Workspace,
  credentials: readonly Credential[],
  clientFor: ClientFactory,
): ClientRouter {
  const byId = new Map(credentials.map((c) => [c.id, c]));
  const clients = new Map<string, GitHubClient>();
  const client = (credentialId: string | undefined) => {
    const credential = (credentialId && byId.get(credentialId)) || credentials[0];
    if (!credential) throw new GitHubApiError({ kind: "unauthorized", message: "No credentials" });
    let c = clients.get(credential.id);
    if (!c) {
      c = clientFor(credential);
      clients.set(credential.id, c);
    }
    return c;
  };
  const repoCredential = new Map(workspace.repos.map((r) => [repoKey(toRepoRef(r.repo)).toLowerCase(), r.credentialId]));
  const ownerCredential = new Map(workspace.owners.map((o) => [o.owner.login.toLowerCase(), o.credentialId]));
  return {
    forRepo: (repo) =>
      client(repoCredential.get(repoKey(repo).toLowerCase()) ?? ownerCredential.get(repo.owner.toLowerCase())),
    forOwner: (owner) => client(ownerCredential.get(owner.login.toLowerCase())),
  };
}

/** Repository から RepoRef を作る */
export function toRepoRef(repo: Repository): RepoRef {
  return { owner: repo.owner.login, name: repo.name };
}

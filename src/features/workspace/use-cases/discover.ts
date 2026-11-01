import { isAbort, mapWithConcurrency } from "../../../lib/concurrency";
import type { RepositorySource } from "../ports";
import type { Identity, Owner, OwnerEntry, RepoEntry, Workspace } from "../repository";

export type Discover = (identities: readonly Identity[], options?: { signal?: AbortSignal }) => Promise<Workspace>;

/**
 * 認証情報ごとにリポジトリと所属 Organization を集め、1 つの作業範囲にまとめる。
 * 同じリポジトリ・所有者が複数の認証情報で見つかったら、全所有者に使える認証情報を優先する
 */
export function createDiscover(source: RepositorySource): Discover {
  return async (identities, options = {}) => {
    const ordered = [...identities].sort((a, b) => Number(b.broad) - Number(a.broad));
    const failures: Workspace["failures"] = [];

    const found = await mapWithConcurrency(ordered, 3, async (identity) => {
      try {
        const [repos, orgs] = await Promise.all([
          source.listRepositories(identity, options.signal),
          // Org 一覧が取れなくても、リポジトリから所有者はわかるので続ける
          source.listOrganizations(identity, options.signal).catch((e: unknown) => {
            if (isAbort(e) || options.signal?.aborted) throw e;
            return [] as Owner[];
          }),
        ]);
        return { identity, repos, orgs };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        failures.push({ identity, error });
        return null;
      }
    });

    const repos = new Map<number, RepoEntry>();
    const owners = new Map<string, OwnerEntry>();
    const viewers = new Set(ordered.map((i) => i.login.toLowerCase()));
    const addOwner = (owner: Owner, identityId: string) => {
      const key = owner.login.toLowerCase();
      if (!owners.has(key)) owners.set(key, { owner, identityId, repoCount: 0, isViewer: viewers.has(key) });
      return owners.get(key)!;
    };

    for (const f of found) {
      if (!f) continue;
      for (const repo of f.repos) {
        if (repos.has(repo.id)) continue;
        repos.set(repo.id, { repo, identityId: f.identity.id });
        addOwner(repo.owner, f.identity.id).repoCount++;
      }
      for (const org of f.orgs) addOwner(org, f.identity.id);
      // リポジトリを 1 つも持たない本人のアカウントも選べるようにする
      addOwner({ login: f.identity.login, id: 0, type: "User", avatarUrl: f.identity.avatarUrl }, f.identity.id);
    }

    return {
      owners: sortOwners([...owners.values()]),
      repos: [...repos.values()].sort((a, b) => a.repo.fullName.localeCompare(b.repo.fullName)),
      failures,
    };
  };
}

/** 本人 → Organization → ほかのユーザーの順、それぞれ名前順 */
function sortOwners(list: OwnerEntry[]): OwnerEntry[] {
  const rank = (o: OwnerEntry) => (o.isViewer ? 0 : o.owner.type === "Organization" ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b) || a.owner.login.localeCompare(b.owner.login));
}


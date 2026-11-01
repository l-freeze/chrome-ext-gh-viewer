// どのリポジトリ・所有者を、どのトークンで呼ぶか。
// 認証情報と作業範囲（どの認証情報でどのリポジトリが見えたか）が変わるたびに update で知らせてもらう。

import { GitHubApiError } from "../integrations/github/errors";
import type { GitHubHttp } from "../integrations/github/http";
import { repoKey, type RepoRef, type Workspace } from "../features/workspace/repository";

export interface GitHubAccess {
  update(tokens: ReadonlyArray<{ id: string; token: string }>, workspace?: Workspace): void;
  forIdentity(identityId: string): GitHubHttp;
  forRepo(repo: RepoRef): GitHubHttp;
  forOwner(login: string): GitHubHttp;
}

export function createGitHubAccess(httpFor: (token: string) => GitHubHttp): GitHubAccess {
  let tokens = new Map<string, string>();
  let order: string[] = [];
  let repoIdentity = new Map<string, string>();
  let ownerIdentity = new Map<string, string>();
  const clients = new Map<string, GitHubHttp>();

  const client = (identityId: string | undefined): GitHubHttp => {
    const id = identityId !== undefined && tokens.has(identityId) ? identityId : order[0];
    const token = id === undefined ? undefined : tokens.get(id);
    if (token === undefined) throw new GitHubApiError({ kind: "unauthorized", message: "No credentials" });
    let c = clients.get(token);
    if (!c) {
      c = httpFor(token);
      clients.set(token, c);
    }
    return c;
  };

  return {
    update(list, workspace) {
      tokens = new Map(list.map((t) => [t.id, t.token]));
      order = list.map((t) => t.id);
      for (const token of clients.keys()) if (![...tokens.values()].includes(token)) clients.delete(token);
      if (workspace) {
        repoIdentity = new Map(workspace.repos.map((r) => [repoKey({ owner: r.repo.owner.login, name: r.repo.name }).toLowerCase(), r.identityId]));
        ownerIdentity = new Map(workspace.owners.map((o) => [o.owner.login.toLowerCase(), o.identityId]));
      }
    },
    forIdentity: (id) => client(id),
    forRepo: (repo) => client(repoIdentity.get(repoKey(repo).toLowerCase()) ?? ownerIdentity.get(repo.owner.toLowerCase())),
    forOwner: (login) => client(ownerIdentity.get(login.toLowerCase())),
  };
}

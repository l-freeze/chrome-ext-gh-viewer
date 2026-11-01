import type { GitHubHttp } from "../../../integrations/github/http";
import { listMyOrganizations, listMyRepositories, type GitHubAccount, type GitHubRepository } from "../../../integrations/github/user";
import type { RepositorySource } from "../ports";
import type { Owner, Repository } from "../repository";

export function toOwner(a: GitHubAccount): Owner {
  // Bot などは User 扱いにする
  return { login: a.login, id: a.id, type: a.type === "Organization" ? "Organization" : "User", avatarUrl: a.avatar_url };
}

export function toRepository(r: GitHubRepository): Repository {
  return {
    id: r.id,
    owner: toOwner(r.owner),
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    archived: r.archived,
    htmlUrl: r.html_url,
    pushedAt: r.pushed_at,
    defaultBranch: r.default_branch,
  };
}

/** httpFor: 認証情報の ID から、そのトークンで呼ぶクライアントを返す */
export function createGitHubRepositorySource(httpFor: (identityId: string) => GitHubHttp): RepositorySource {
  return {
    async listRepositories(identity, signal) {
      return (await listMyRepositories(httpFor(identity.id), signal ? { signal } : {})).map(toRepository);
    },
    async listOrganizations(identity, signal) {
      return (await listMyOrganizations(httpFor(identity.id), signal ? { signal } : {})).map(toOwner);
    },
  };
}

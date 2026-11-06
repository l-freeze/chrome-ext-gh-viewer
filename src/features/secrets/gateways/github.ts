import { listEnvironments } from "../../../integrations/github/contents";
import { isGitHubApiError } from "../../../integrations/github/errors";
import type { GitHubHttp } from "../../../integrations/github/http";
import {
  listEnvironmentSecrets,
  listEnvironmentVariables,
  listRepoSecrets,
  listRepoVariables,
  type GitHubSecret,
  type GitHubVariable,
} from "../../../integrations/github/secrets";
import type { RepoRef } from "../../workspace/repository";
import type { ConfigItem } from "../item";
import type { SecretSource } from "../ports";

export function toSecretItem(s: GitHubSecret, repo: RepoRef, environment: string | null): ConfigItem {
  return { repo, environment, kind: "secret", name: s.name, value: null, createdAt: s.created_at, updatedAt: s.updated_at };
}

export function toVariableItem(v: GitHubVariable, repo: RepoRef, environment: string | null): ConfigItem {
  return { repo, environment, kind: "variable", name: v.name, value: v.value, createdAt: v.created_at, updatedAt: v.updated_at };
}

export function createGitHubSecretSource(httpFor: (repo: RepoRef) => GitHubHttp): SecretSource {
  const call = (signal?: AbortSignal) => (signal ? { signal } : {});
  return {
    listRepoSecrets: async (repo, signal) => (await listRepoSecrets(httpFor(repo), repo, call(signal))).map((s) => toSecretItem(s, repo, null)),
    listRepoVariables: async (repo, signal) => (await listRepoVariables(httpFor(repo), repo, call(signal))).map((v) => toVariableItem(v, repo, null)),
    async listEnvironments(repo, signal) {
      try {
        return await listEnvironments(httpFor(repo), repo, call(signal));
      } catch (e) {
        // Environment を使えないリポジトリ（プランによる）は 404 を返す
        if (isGitHubApiError(e, "not_found")) return [];
        throw e;
      }
    },
    listEnvironmentSecrets: async (repo, env, signal) =>
      (await listEnvironmentSecrets(httpFor(repo), repo, env, call(signal))).map((s) => toSecretItem(s, repo, env)),
    listEnvironmentVariables: async (repo, env, signal) =>
      (await listEnvironmentVariables(httpFor(repo), repo, env, call(signal))).map((v) => toVariableItem(v, repo, env)),
  };
}

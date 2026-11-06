import { settleEach } from "../../../lib/concurrency";
import { toRepoRef } from "../../workspace/repository";
import type { SecretOperations, SecretSource } from "../ports";

/**
 * リポジトリ単位の Secrets・Variables と Environment の一覧を取り、Environment があればその Secrets・Variables も取る
 * （Environment がなければ追加の呼び出しはしない）
 */
export function createListSecrets(source: SecretSource): SecretOperations["list"] {
  return (repos, options = {}) =>
    settleEach(
      repos,
      async (repo, signal) => {
        const ref = toRepoRef(repo);
        const [secrets, variables, environments] = await Promise.all([
          source.listRepoSecrets(ref, signal),
          source.listRepoVariables(ref, signal),
          source.listEnvironments(ref, signal),
        ]);
        const perEnvironment = await Promise.all(
          environments.map(async (env) => [
            ...(await source.listEnvironmentSecrets(ref, env, signal)),
            ...(await source.listEnvironmentVariables(ref, env, signal)),
          ]),
        );
        return [...secrets, ...variables, ...perEnvironment.flat()];
      },
      { concurrency: 4, ...options },
    );
}

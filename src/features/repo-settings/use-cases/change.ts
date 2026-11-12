// 公開範囲と既定のブランチの変更。送る前に値を確かめ、変えたあとの設定を読み直して返す。

import { ValidationError } from "../../../lib/validation";
import type { RepoSettingsOperations, RepoSettingsSource } from "../ports";

export function createChangeVisibility(source: RepoSettingsSource): RepoSettingsOperations["setVisibility"] {
  return async (repo, visibility) => {
    if (repo.archived) throw new ValidationError("Archived repositories cannot be changed.");
    if (visibility !== "public" && visibility !== "private") throw new ValidationError(`Unknown visibility: ${String(visibility)}`);
    await source.update(repo, { visibility });
    return source.get(repo);
  };
}

export function createChangeDefaultBranch(source: RepoSettingsSource): RepoSettingsOperations["setDefaultBranch"] {
  return async (repo, branch) => {
    if (repo.archived) throw new ValidationError("Archived repositories cannot be changed.");
    const name = branch.trim();
    if (name === "") throw new ValidationError("Choose a branch.");
    // 既存のブランチにだけ切り替える（GitHub はブランチを作らない）
    const branches = await source.listBranches(repo);
    if (!branches.includes(name)) throw new ValidationError(`Branch not found: ${name}`);
    await source.update(repo, { defaultBranch: name });
    return source.get(repo);
  };
}

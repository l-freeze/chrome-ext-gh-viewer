import { isGitHubApiError } from "../../../integrations/github/errors";
import type { GitHubHttp } from "../../../integrations/github/http";
import { listBranches } from "../../../integrations/github/contents";
import {
  getBranchSummary,
  getRepositoryDetails,
  listBranchRules,
  updateRepository,
  type GitHubBranchRule,
  type GitHubBranchSummary,
  type GitHubRepositoryDetails,
} from "../../../integrations/github/repository-settings";
import { toRepoRef, type RepoRef, type Repository } from "../../workspace/repository";
import type { RepoSettingsSource } from "../ports";
import { known, UNAVAILABLE, UNKNOWN, type RepoSettings, type SettingKey, type SettingValue } from "../settings";

/** ブランチ保護・ルールセットを使えないプラン（無料プランの private リポジトリ）の応答 */
function isPlanLimited(e: unknown): boolean {
  return isGitHubApiError(e, "forbidden") && /upgrade to github/i.test(e.message);
}

type Read<T> = { ok: true; value: T } | { ok: false; unavailable: boolean };

/** 保護とルールは、読めなくてもリポジトリ全体を失敗にしない（権限やプランで読めないことがある） */
async function attempt<T>(fn: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (isGitHubApiError(e, "aborted")) throw e;
    if (isPlanLimited(e)) return { ok: false, unavailable: true };
    if (isGitHubApiError(e, "forbidden") || isGitHubApiError(e, "not_found")) return { ok: false, unavailable: false };
    throw e;
  }
}

const hasRule = (rules: readonly GitHubBranchRule[], type: string) => rules.some((r) => r.type === type);

function requiredApprovals(rules: readonly GitHubBranchRule[]): number | false {
  const counts = rules
    .filter((r) => r.type === "pull_request")
    .map((r) => (typeof r.parameters?.["required_approving_review_count"] === "number" ? (r.parameters["required_approving_review_count"] as number) : 0));
  return counts.length === 0 ? false : Math.max(...counts);
}

function ruleChecks(rules: readonly GitHubBranchRule[]): string[] {
  return rules
    .filter((r) => r.type === "required_status_checks")
    .flatMap((r) => {
      const list = r.parameters?.["required_status_checks"];
      return Array.isArray(list) ? list.map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>)["context"] : null)).filter((c): c is string => typeof c === "string") : [];
    });
}

/** GitHub の 3 つの応答をモデルに変える */
export function toRepoSettings(
  repo: RepoRef,
  details: GitHubRepositoryDetails,
  branch: Read<GitHubBranchSummary> | null,
  rules: Read<GitHubBranchRule[]> | null,
): RepoSettings {
  const fromRules = (f: (rules: GitHubBranchRule[]) => string | number | boolean): SettingValue =>
    rules === null ? UNKNOWN : rules.ok ? known(f(rules.value)) : rules.unavailable ? UNAVAILABLE : UNKNOWN;
  const checks = (): SettingValue => {
    const classic = branch?.ok ? branch.value.required_status_checks : [];
    if (rules === null || !rules.ok) return classic.length > 0 ? known(classic.join(", ")) : fromRules(() => false);
    const all = [...new Set([...classic, ...ruleChecks(rules.value)])].sort();
    return known(all.length > 0 ? all.join(", ") : false);
  };
  const values: Record<SettingKey, SettingValue> = {
    visibility: known(details.visibility),
    defaultBranch: known(details.default_branch),
    issues: known(details.has_issues),
    projects: known(details.has_projects),
    wiki: known(details.has_wiki),
    discussions: known(details.has_discussions),
    mergeCommit: known(details.allow_merge_commit),
    squashMerge: known(details.allow_squash_merge),
    rebaseMerge: known(details.allow_rebase_merge),
    autoMerge: known(details.allow_auto_merge),
    deleteBranchOnMerge: known(details.delete_branch_on_merge),
    updateBranch: known(details.allow_update_branch),
    webSignoff: known(details.web_commit_signoff_required),
    protected: branch === null ? UNKNOWN : branch.ok ? known(branch.value.protected) : branch.unavailable ? UNAVAILABLE : UNKNOWN,
    requirePullRequest: fromRules(requiredApprovals),
    requiredChecks: checks(),
    blockForcePush: fromRules((r) => hasRule(r, "non_fast_forward")),
    restrictDeletion: fromRules((r) => hasRule(r, "deletion")),
    linearHistory: fromRules((r) => hasRule(r, "required_linear_history")),
    signedCommits: fromRules((r) => hasRule(r, "required_signatures")),
  };
  return { repo, values };
}

export function createGitHubRepoSettingsSource(httpFor: (repo: RepoRef) => GitHubHttp): RepoSettingsSource {
  const call = (signal?: AbortSignal) => (signal ? { signal } : {});
  return {
    async get(repository: Repository, signal) {
      const repo = toRepoRef(repository);
      const http = httpFor(repo);
      const details = await getRepositoryDetails(http, repo, call(signal));
      const branchName = details.default_branch ?? repository.defaultBranch;
      // 空のリポジトリなど、既定のブランチが無ければ保護は読まない
      if (!branchName) return toRepoSettings(repo, details, null, null);
      const [branch, rules] = await Promise.all([
        attempt(() => getBranchSummary(http, repo, branchName, call(signal))),
        attempt(() => listBranchRules(http, repo, branchName, call(signal))),
      ]);
      return toRepoSettings(repo, details, branch, rules);
    },
    listBranches: (repository, signal) => listBranches(httpFor(toRepoRef(repository)), toRepoRef(repository), call(signal)),
    async update(repository, update) {
      const repo = toRepoRef(repository);
      await updateRepository(httpFor(repo), repo, {
        ...(update.visibility ? { visibility: update.visibility } : {}),
        ...(update.defaultBranch ? { default_branch: update.defaultBranch } : {}),
      });
    },
  };
}

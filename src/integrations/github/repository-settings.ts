// リポジトリの設定: リポジトリ本体の設定、ブランチの保護の有無、ブランチに効いているルール（ルールセット）。閲覧のみ。
// リポジトリ本体のマージの方法などは、トークンの権限によっては返らないことがあるので、無い項目は null にする。

import { arrayOf, bool, obj, optStr, str, type Obj } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, repoPath, type GitHubHttp, type RepoPath } from "./http";

export interface GitHubRepositoryDetails {
  visibility: string | null;
  default_branch: string | null;
  has_issues: boolean | null;
  has_projects: boolean | null;
  has_wiki: boolean | null;
  has_discussions: boolean | null;
  allow_merge_commit: boolean | null;
  allow_squash_merge: boolean | null;
  allow_rebase_merge: boolean | null;
  allow_auto_merge: boolean | null;
  delete_branch_on_merge: boolean | null;
  allow_update_branch: boolean | null;
  web_commit_signoff_required: boolean | null;
}

export interface GitHubBranchSummary {
  protected: boolean;
  /** 従来のブランチ保護で必須にしているステータスチェック（保護が無ければ空） */
  required_status_checks: string[];
}

export interface GitHubBranchRule {
  type: string;
  parameters: Obj | null;
}

interface Call {
  signal?: AbortSignal;
}

const optBool = (o: Obj, key: string): boolean | null => (typeof o[key] === "boolean" ? (o[key] as boolean) : null);

export function readRepositoryDetails(v: unknown, path = "repository"): GitHubRepositoryDetails {
  const o = obj(v, path);
  return {
    visibility: optStr(o, "visibility", path),
    default_branch: optStr(o, "default_branch", path),
    has_issues: optBool(o, "has_issues"),
    has_projects: optBool(o, "has_projects"),
    has_wiki: optBool(o, "has_wiki"),
    has_discussions: optBool(o, "has_discussions"),
    allow_merge_commit: optBool(o, "allow_merge_commit"),
    allow_squash_merge: optBool(o, "allow_squash_merge"),
    allow_rebase_merge: optBool(o, "allow_rebase_merge"),
    allow_auto_merge: optBool(o, "allow_auto_merge"),
    delete_branch_on_merge: optBool(o, "delete_branch_on_merge"),
    allow_update_branch: optBool(o, "allow_update_branch"),
    web_commit_signoff_required: optBool(o, "web_commit_signoff_required"),
  };
}

export function readBranchSummary(v: unknown, path = "branch"): GitHubBranchSummary {
  const o = obj(v, path);
  const protection = o["protection"];
  const checks = protection && typeof protection === "object" ? (protection as Obj)["required_status_checks"] : null;
  const c = checks && typeof checks === "object" ? (checks as Obj) : null;
  const enforced = c !== null && c["enforcement_level"] !== "off";
  const contexts = enforced && Array.isArray(c["contexts"]) ? (c["contexts"] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return { protected: bool(o, "protected", path), required_status_checks: contexts };
}

export function readBranchRule(v: unknown, path = "rule"): GitHubBranchRule {
  const o = obj(v, path);
  const p = o["parameters"];
  return { type: str(o, "type", path), parameters: p && typeof p === "object" && !Array.isArray(p) ? (p as Obj) : null };
}

export async function getRepositoryDetails(http: GitHubHttp, repo: RepoPath, call: Call = {}): Promise<GitHubRepositoryDetails> {
  const { data } = await http.json(repoPath(repo), call);
  return decode(() => readRepositoryDetails(data));
}

export async function getBranchSummary(http: GitHubHttp, repo: RepoPath, branch: string, call: Call = {}): Promise<GitHubBranchSummary> {
  const { data } = await http.json(`${repoPath(repo)}/branches/${encodeURIComponent(branch)}`, call);
  return decode(() => readBranchSummary(data));
}

/** ブランチに効いているルール（リポジトリと Organization のルールセットから）。読み取りの権限で読める */
export async function listBranchRules(http: GitHubHttp, repo: RepoPath, branch: string, call: Call = {}): Promise<GitHubBranchRule[]> {
  const rules: GitHubBranchRule[] = [];
  for await (const page of http.paginate(`${repoPath(repo)}/rules/branches/${encodeURIComponent(branch)}`, { ...call, query: { per_page: PER_PAGE } })) {
    rules.push(...decode(() => arrayOf(page, "rules", readBranchRule)));
  }
  return rules;
}

/** 変えられる設定。管理者の権限が要る（Fine-grained PAT は Administration の write） */
export interface GitHubRepositoryUpdate {
  visibility?: "public" | "private";
  default_branch?: string;
}

/** リポジトリの設定を変え、変えたあとの設定を返す */
export async function updateRepository(http: GitHubHttp, repo: RepoPath, update: GitHubRepositoryUpdate, call: Call = {}): Promise<GitHubRepositoryDetails> {
  const { data } = await http.json(repoPath(repo), { ...call, method: "PATCH", body: update });
  return decode(() => readRepositoryDetails(data));
}

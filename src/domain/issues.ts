// Issue 一覧の絞り込みとリポジトリごとのまとめ。

import type { Issue, RepoRef } from "../api/types";
import { repoKey } from "./artifacts";

/**
 * 空白で区切った語がすべて、タイトル・番号・ラベル・担当者・作成者・リポジトリのどれかに含まれるものを残す。
 */
export function filterIssues(issues: readonly Issue[], text: string): Issue[] {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...issues];
  return issues.filter((issue) => {
    const haystack = [
      issue.title,
      `#${issue.number}`,
      repoKey(issue.repo),
      issue.author?.login ?? "",
      ...issue.labels.map((l) => l.name),
      ...issue.assignees.map((a) => a.login),
    ]
      .join("\n")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export interface IssueGroup {
  repo: RepoRef;
  key: string;
  issues: Issue[];
}

/** リポジトリごとにまとめる。グループも中身も更新日の新しい順 */
export function groupIssuesByRepo(issues: readonly Issue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  const sorted = [...issues].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.id - a.id);
  for (const issue of sorted) {
    const key = repoKey(issue.repo);
    let group = groups.get(key);
    if (!group) {
      group = { repo: issue.repo, key, issues: [] };
      groups.set(key, group);
    }
    group.issues.push(issue);
  }
  // Map は挿入順を保つので、最新の Issue を持つリポジトリから並ぶ
  return [...groups.values()];
}

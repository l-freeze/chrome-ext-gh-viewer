import type { GitHubHttp } from "../../../integrations/github/http";
import { searchOwnerIssues, type GitHubIssue } from "../../../integrations/github/search";
import type { Issue } from "../issue";
import type { IssueSource } from "../ports";

export function toIssue(i: GitHubIssue): Issue {
  return {
    id: i.id,
    number: i.number,
    repo: i.repository,
    title: i.title,
    state: i.state,
    stateReason: i.state_reason,
    htmlUrl: i.html_url,
    author: i.user && { login: i.user.login, avatarUrl: i.user.avatar_url },
    labels: i.labels,
    assignees: i.assignees.map((a) => ({ login: a.login, avatarUrl: a.avatar_url })),
    comments: i.comments,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    closedAt: i.closed_at,
  };
}

/** httpFor: 所有者から、その所有者を検索できるトークンのクライアントを返す */
export function createGitHubIssueSource(httpFor: (ownerLogin: string) => GitHubHttp): IssueSource {
  return {
    async searchOwner(owner, state, signal) {
      const res = await searchOwnerIssues(httpFor(owner.login), owner, { state }, signal ? { signal } : {});
      return { issues: res.issues.map(toIssue), truncated: res.truncated };
    },
  };
}

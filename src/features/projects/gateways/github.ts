import type { GitHubHttp } from "../../../integrations/github/http";
import {
  listOwnerProjects,
  listProjectFields,
  listProjectItems,
  selectedOptionId,
  updateProjectItemField,
  type GitHubProject,
  type GitHubProjectField,
  type GitHubProjectItem,
  type ProjectPath,
} from "../../../integrations/github/projects";
import type { Owner, RepoRef } from "../../workspace/repository";
import { projectHtmlUrl, type ItemKind, type ItemState, type Project, type ProjectItem, type SelectField } from "../project";
import type { ProjectSource } from "../ports";

const KIND: Record<GitHubProjectItem["content_type"], ItemKind> = {
  Issue: "issue",
  PullRequest: "pull_request",
  DraftIssue: "draft",
};

const HTML_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/\d+/;

/** https://github.com/{owner}/{repo}/issues/{n} などからリポジトリを取り出す */
export function repoFromHtmlUrl(url: string | null): RepoRef | null {
  const m = url === null ? null : HTML_URL_RE.exec(url);
  return m && m[1] && m[2] ? { owner: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) } : null;
}

export function toProject(p: GitHubProject, owner: Owner): Project {
  return {
    id: p.id,
    number: p.number,
    owner,
    title: p.title,
    shortDescription: p.short_description,
    closed: p.state === "closed",
    htmlUrl: projectHtmlUrl(owner, p.number),
    updatedAt: p.updated_at,
  };
}

export function toSelectField(f: GitHubProjectField): SelectField {
  return { id: f.id, name: f.name, options: f.options.map((o) => ({ ...o })) };
}

function itemState(item: GitHubProjectItem): ItemState | null {
  const c = item.content;
  if (!c || item.content_type === "DraftIssue") return null;
  if (item.content_type === "PullRequest" && c.merged_at !== null) return "merged";
  return c.state === "open" || c.state === "closed" ? c.state : null;
}

export function toProjectItem(item: GitHubProjectItem, fieldId: number | null): ProjectItem {
  const c = item.content;
  const isDraft = item.content_type === "DraftIssue";
  return {
    id: item.id,
    kind: KIND[item.content_type],
    title: c?.title ?? null,
    number: isDraft ? null : (c?.number ?? null),
    repo: isDraft ? null : repoFromHtmlUrl(c?.html_url ?? null),
    htmlUrl: isDraft ? null : (c?.html_url ?? null),
    state: itemState(item),
    labels: c?.labels.map((l) => ({ name: l.name, color: l.color })) ?? [],
    assignees: c?.assignees.map((a) => ({ login: a.login, avatarUrl: a.avatar_url })) ?? [],
    statusId: fieldId === null ? null : selectedOptionId(item.field_values.get(fieldId)),
    updatedAt: item.updated_at,
  };
}

const pathOf = (project: Project): ProjectPath => ({ owner: project.owner, number: project.number });

/** httpFor: 所有者から、その所有者を扱えるトークンのクライアントを返す */
export function createGitHubProjectSource(httpFor: (ownerLogin: string) => GitHubHttp): ProjectSource {
  const call = (signal?: AbortSignal) => (signal ? { signal } : {});
  return {
    async listProjects(owner, signal) {
      return (await listOwnerProjects(httpFor(owner.login), owner, call(signal))).map((p) => toProject(p, owner));
    },
    async listSelectFields(project, signal) {
      const fields = await listProjectFields(httpFor(project.owner.login), pathOf(project), call(signal));
      return fields.filter((f) => f.data_type === "single_select").map(toSelectField);
    },
    async listItems(project, fieldId, signal) {
      const items = await listProjectItems(httpFor(project.owner.login), pathOf(project), {
        ...call(signal),
        fieldIds: fieldId === null ? [] : [fieldId],
      });
      return items.filter((i) => i.archived_at === null).map((i) => toProjectItem(i, fieldId));
    },
    async setItemField(project, itemId, fieldId, optionId) {
      await updateProjectItemField(httpFor(project.owner.login), pathOf(project), itemId, { id: fieldId, value: optionId });
    },
  };
}

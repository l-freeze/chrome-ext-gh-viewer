// Projects（v2）: プロジェクト・フィールド・項目の一覧と、項目のフィールドの更新。
// 所有者が Organization なら /orgs/{org}/projectsV2、個人なら /users/{username}/projectsV2 の下にある。

import { arrayOf, num, obj, optStr, str, ValidationError, type Obj } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, type GitHubHttp } from "./http";

export interface ProjectOwnerPath {
  login: string;
  type: string;
}

export interface ProjectPath {
  owner: ProjectOwnerPath;
  number: number;
}

export interface GitHubProject {
  id: number;
  number: number;
  title: string;
  short_description: string | null;
  state: "open" | "closed";
  updated_at: string;
}

export interface GitHubSelectOption {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
}

export interface GitHubProjectField {
  id: number;
  name: string;
  data_type: string;
  /** single_select のときだけ */
  options: GitHubSelectOption[];
}

export type GitHubItemType = "Issue" | "PullRequest" | "DraftIssue";

export interface GitHubItemContent {
  title: string | null;
  number: number | null;
  html_url: string | null;
  state: string | null;
  merged_at: string | null;
  labels: Array<{ name: string; color: string | null }>;
  assignees: Array<{ login: string; avatar_url: string }>;
}

export interface GitHubProjectItem {
  id: number;
  content_type: GitHubItemType;
  /** 見る権限のない Issue などでは null */
  content: GitHubItemContent | null;
  archived_at: string | null;
  updated_at: string;
  /** 取得時に指定したフィールドの値（フィールド ID → 値） */
  field_values: Map<number, unknown>;
}

interface Call {
  signal?: AbortSignal;
}

export function projectsBase(owner: ProjectOwnerPath): string {
  const login = encodeURIComponent(owner.login);
  return owner.type === "Organization" ? `/orgs/${login}/projectsV2` : `/users/${login}/projectsV2`;
}

const projectPath = (p: ProjectPath) => `${projectsBase(p.owner)}/${p.number}`;

/** name や description は { raw, html } の形で返る */
function rawText(v: unknown, path: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  const raw = obj(v, path)["raw"];
  if (typeof raw !== "string") throw new ValidationError(`${path}.raw: expected string`, `${path}.raw`);
  return raw;
}

export function readProject(v: unknown, path = "project"): GitHubProject {
  const o = obj(v, path);
  const closedAt = optStr(o, "closed_at", path);
  const state = o["state"] === "open" || o["state"] === "closed" ? o["state"] : closedAt === null ? "open" : "closed";
  return {
    id: num(o, "id", path),
    number: num(o, "number", path),
    title: str(o, "title", path),
    short_description: optStr(o, "short_description", path),
    state,
    updated_at: str(o, "updated_at", path),
  };
}

export function readField(v: unknown, path = "field"): GitHubProjectField {
  const o = obj(v, path);
  const options = o["options"];
  return {
    id: num(o, "id", path),
    name: str(o, "name", path),
    data_type: str(o, "data_type", path),
    options:
      options === null || options === undefined
        ? []
        : arrayOf(options, `${path}.options`, (x, p) => {
            const opt = obj(x, p);
            return {
              id: str(opt, "id", p),
              name: rawText(opt["name"], `${p}.name`) ?? "",
              color: optStr(opt, "color", p),
              description: rawText(opt["description"], `${p}.description`),
            };
          }),
  };
}

function readContent(v: unknown, path: string): GitHubItemContent | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  const labels = o["labels"];
  const assignees = o["assignees"];
  const optNum = (key: string) => (typeof o[key] === "number" ? (o[key] as number) : null);
  return {
    title: optStr(o, "title", path),
    number: optNum("number"),
    html_url: optStr(o, "html_url", path),
    state: optStr(o, "state", path),
    merged_at: optStr(o, "merged_at", path),
    labels:
      labels === null || labels === undefined
        ? []
        : arrayOf(labels, `${path}.labels`, (x, p) => {
            const l = obj(x, p);
            return { name: str(l, "name", p), color: optStr(l, "color", p) };
          }),
    assignees:
      assignees === null || assignees === undefined
        ? []
        : arrayOf(assignees, `${path}.assignees`, (x, p) => {
            const a = obj(x, p);
            return { login: str(a, "login", p), avatar_url: str(a, "avatar_url", p) };
          }),
  };
}

function readFieldValues(v: unknown, path: string): Map<number, unknown> {
  const values = new Map<number, unknown>();
  if (v === null || v === undefined) return values;
  arrayOf(v, path, (x, p) => {
    const f: Obj = obj(x, p);
    values.set(num(f, "id", p), f["value"] ?? null);
  });
  return values;
}

export function readItem(v: unknown, path = "item"): GitHubProjectItem {
  const o = obj(v, path);
  const type = str(o, "content_type", path);
  if (type !== "Issue" && type !== "PullRequest" && type !== "DraftIssue") {
    throw new ValidationError(`${path}.content_type: unexpected "${type}"`, `${path}.content_type`);
  }
  return {
    id: num(o, "id", path),
    content_type: type,
    content: readContent(o["content"], `${path}.content`),
    archived_at: optStr(o, "archived_at", path),
    updated_at: str(o, "updated_at", path),
    field_values: readFieldValues(o["fields"], `${path}.fields`),
  };
}

/** single_select の値（{ id, name, ... }）から選択肢の ID を取り出す。未設定なら null */
export function selectedOptionId(value: unknown): string | null {
  if (value === null || value === undefined || typeof value !== "object") return null;
  const id = (value as Obj)["id"];
  return typeof id === "string" ? id : typeof id === "number" ? String(id) : null;
}

/** 所有者のプロジェクトを全部取得する */
export async function listOwnerProjects(http: GitHubHttp, owner: ProjectOwnerPath, call: Call = {}): Promise<GitHubProject[]> {
  const projects: GitHubProject[] = [];
  for await (const page of http.paginate(projectsBase(owner), { ...call, query: { per_page: PER_PAGE } })) {
    projects.push(...decode(() => arrayOf(page, "projects", readProject)));
  }
  return projects;
}

export async function listProjectFields(http: GitHubHttp, project: ProjectPath, call: Call = {}): Promise<GitHubProjectField[]> {
  const fields: GitHubProjectField[] = [];
  for await (const page of http.paginate(`${projectPath(project)}/fields`, { ...call, query: { per_page: PER_PAGE } })) {
    fields.push(...decode(() => arrayOf(page, "fields", readField)));
  }
  return fields;
}

/** 項目を全部取得する。fieldIds に指定したフィールドの値も一緒に返る */
export async function listProjectItems(
  http: GitHubHttp,
  project: ProjectPath,
  call: Call & { fieldIds?: readonly number[] } = {},
): Promise<GitHubProjectItem[]> {
  const { fieldIds = [], ...rest } = call;
  const query = { per_page: PER_PAGE, fields: fieldIds.length > 0 ? fieldIds.join(",") : undefined };
  const items: GitHubProjectItem[] = [];
  for await (const page of http.paginate(`${projectPath(project)}/items`, { ...rest, query })) {
    items.push(...decode(() => arrayOf(page, "items", readItem)));
  }
  return items;
}

/** 項目のフィールドを更新する。single_select には選択肢の ID、空にするときは null を渡す */
export async function updateProjectItemField(
  http: GitHubHttp,
  project: ProjectPath,
  itemId: number,
  field: { id: number; value: string | number | null },
  call: Call = {},
): Promise<void> {
  await http.request(`${projectPath(project)}/items/${itemId}`, {
    ...call,
    method: "PATCH",
    body: { fields: [{ id: field.id, value: field.value }] },
  });
}

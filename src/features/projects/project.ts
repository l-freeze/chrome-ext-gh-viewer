// プロジェクト（Projects v2）と、その項目。

import type { Owner, RepoRef, UserRef } from "../workspace/repository";

export interface Project {
  id: number;
  number: number;
  owner: Owner;
  title: string;
  shortDescription: string | null;
  closed: boolean;
  htmlUrl: string;
  updatedAt: string;
}

export interface StatusOption {
  id: string;
  name: string;
  /** GitHub の色の名前（GRAY、BLUE など）。不明なら null */
  color: string | null;
  description: string | null;
}

/** 単一選択のフィールド。カンバンの列になる */
export interface SelectField {
  id: number;
  name: string;
  options: StatusOption[];
}

/** 項目の種類。カンバンでは種類ごとに表示を切り替えられる */
export type ItemKind = "issue" | "pull_request" | "draft";
export const ITEM_KINDS: readonly ItemKind[] = ["issue", "pull_request", "draft"];

export type ItemState = "open" | "closed" | "merged";

export interface ItemLabel {
  name: string;
  /** 先頭の # を含まない 6 桁の 16 進数。不明なら null */
  color: string | null;
}

export interface ProjectItem {
  id: number;
  kind: ItemKind;
  /** 見る権限のない項目では null */
  title: string | null;
  number: number | null;
  repo: RepoRef | null;
  htmlUrl: string | null;
  state: ItemState | null;
  labels: ItemLabel[];
  assignees: UserRef[];
  /** 列にしているフィールドで選ばれている選択肢の ID。未設定なら null */
  statusId: string | null;
  updatedAt: string;
}

/** 別のプロジェクトへ移せる項目か。ドラフトはプロジェクトの中にしかないので移せない */
export function canMoveToAnotherProject(item: Pick<ProjectItem, "kind" | "repo" | "number">): boolean {
  return item.kind !== "draft" && item.repo !== null && item.number !== null;
}

/** 画面での区別や保存に使うキー。所有者（小文字）とプロジェクト番号 */
export function projectKey(project: Pick<Project, "owner" | "number">): string {
  return `${project.owner.login.toLowerCase()}/${project.number}`;
}

export function projectHtmlUrl(owner: Pick<Owner, "login" | "type">, number: number): string {
  const login = encodeURIComponent(owner.login);
  return owner.type === "Organization"
    ? `https://github.com/orgs/${login}/projects/${number}`
    : `https://github.com/users/${login}/projects/${number}`;
}

/**
 * カンバンの列にするフィールドを選ぶ。GitHub のボードと同じく「Status」を優先し、
 * なければ最初の単一選択のフィールドを使う。単一選択のフィールドがなければ null
 */
export function pickStatusField(fields: readonly SelectField[]): SelectField | null {
  return fields.find((f) => f.name.toLowerCase() === "status") ?? fields[0] ?? null;
}

/** 開いているプロジェクトだけを、タイトル順で並べる */
export function openProjects(projects: readonly Project[]): Project[] {
  return projects.filter((p) => !p.closed).sort((a, b) => a.title.localeCompare(b.title));
}

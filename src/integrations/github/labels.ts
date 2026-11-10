// Issue と PR のラベル: リポジトリごとの一覧、追加、変更（名前・色・説明）。
// 名前は大文字と小文字を区別せずに一意（GitHub が判定する）。色は # なしの 6 桁の 16 進数。

import { arrayOf, num, obj, optStr, str } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, repoPath, type GitHubHttp, type RepoPath } from "./http";

export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  /** 説明がなければ null */
  description: string | null;
}

/** 追加と変更で送る値 */
export interface GitHubLabelInput {
  name: string;
  color: string;
  description: string;
}

interface Call {
  signal?: AbortSignal;
}

export function readLabel(v: unknown, path = "label"): GitHubLabel {
  const o = obj(v, path);
  return { id: num(o, "id", path), name: str(o, "name", path), color: str(o, "color", path), description: optStr(o, "description", path) };
}

const labelsPath = (repo: RepoPath) => `${repoPath(repo)}/labels`;

export async function listLabels(http: GitHubHttp, repo: RepoPath, call: Call = {}): Promise<GitHubLabel[]> {
  const labels: GitHubLabel[] = [];
  for await (const page of http.paginate(labelsPath(repo), { ...call, query: { per_page: PER_PAGE } })) {
    labels.push(...decode(() => arrayOf(page, "labels", readLabel)));
  }
  return labels;
}

export async function createLabel(http: GitHubHttp, repo: RepoPath, input: GitHubLabelInput, call: Call = {}): Promise<GitHubLabel> {
  const { data } = await http.json(labelsPath(repo), { ...call, method: "POST", body: input });
  return decode(() => readLabel(data));
}

/** currentName のラベルを変える。名前を変えるときは new_name で送る（付いている Issue と PR からは外れない） */
export async function updateLabel(http: GitHubHttp, repo: RepoPath, currentName: string, input: GitHubLabelInput, call: Call = {}): Promise<GitHubLabel> {
  const { data } = await http.json(`${labelsPath(repo)}/${encodeURIComponent(currentName)}`, {
    ...call,
    method: "PATCH",
    body: { new_name: input.name, color: input.color, description: input.description },
  });
  return decode(() => readLabel(data));
}

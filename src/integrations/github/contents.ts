// リポジトリの中身: ファイル、ブランチ、Environment。

import { arrayOf, obj, str } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, repoPath, type GitHubHttp, type RepoPath } from "./http";

interface Call {
  signal?: AbortSignal;
}

/** ファイルの中身をテキストで取得する */
export async function getFileText(http: GitHubHttp, repo: RepoPath, path: string, ref?: string, call: Call = {}): Promise<string> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const response = await http.request(`${repoPath(repo)}/contents/${encodedPath}`, {
    ...call,
    accept: "application/vnd.github.raw+json",
    ...(ref ? { query: { ref } } : {}),
  });
  return response.text();
}

export async function listBranches(http: GitHubHttp, repo: RepoPath, call: Call = {}): Promise<string[]> {
  const names: string[] = [];
  for await (const page of http.paginate(`${repoPath(repo)}/branches`, { ...call, query: { per_page: PER_PAGE } })) {
    names.push(...decode(() => arrayOf(page, "branches", (x, p) => str(obj(x, p), "name", p))));
  }
  return names;
}

export async function listEnvironments(http: GitHubHttp, repo: RepoPath, call: Call = {}): Promise<string[]> {
  const names: string[] = [];
  for await (const page of http.paginate(`${repoPath(repo)}/environments`, { ...call, query: { per_page: PER_PAGE } })) {
    names.push(
      ...decode(() => arrayOf(obj(page, "environments")["environments"], "environments.environments", (x, p) => str(obj(x, p), "name", p))),
    );
  }
  return names;
}

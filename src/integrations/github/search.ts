// Issue の検索（Search API）。1 回の検索で 1,000 件までしか返らないため、超える分は作成日の範囲を分けて検索する。

import { DAY_MS, utcDate } from "../../lib/time";
import { arrayOf, bool, num, obj, optStr, str, ValidationError } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, type GitHubHttp } from "./http";

/** Search API が 1 つの検索で返す件数の上限 */
export const SEARCH_RESULT_LIMIT = 1000;

export interface GitHubIssue {
  id: number;
  number: number;
  /** repository_url から取り出した所有者とリポジトリ名 */
  repository: { owner: string; name: string };
  title: string;
  state: "open" | "closed";
  state_reason: string | null;
  html_url: string;
  user: { login: string; avatar_url: string } | null;
  labels: Array<{ name: string; color: string | null; description: string | null }>;
  assignees: Array<{ login: string; avatar_url: string }>;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface IssueSearchPage {
  totalCount: number;
  incomplete: boolean;
  issues: GitHubIssue[];
}

export type IssueStateFilter = "open" | "closed" | "all";

export interface IssueSearchFilter {
  state?: IssueStateFilter;
  /** 追加の検索条件（例: "label:bug"） */
  extra?: string;
}

export interface DateRange {
  /** YYYY-MM-DD（両端を含む） */
  from: string;
  to: string;
}

interface Call {
  signal?: AbortSignal;
}

const REPO_URL_RE = /\/repos\/([^/]+)\/([^/]+)\/?$/;

/** repository_url（https://api.github.com/repos/{owner}/{repo}）から所有者とリポジトリ名を取り出す */
export function parseRepositoryUrl(url: string, path = "repository_url"): { owner: string; name: string } {
  const m = REPO_URL_RE.exec(url);
  if (!m || m[1] === undefined || m[2] === undefined) throw new ValidationError(`${path}: expected repository API URL`, path);
  return { owner: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]) };
}

const readPerson = (v: unknown, path: string) => {
  const o = obj(v, path);
  return { login: str(o, "login", path), avatar_url: str(o, "avatar_url", path) };
};

/** PR が混ざっていたら null を返す */
export function readIssue(v: unknown, path = "issue"): GitHubIssue | null {
  const o = obj(v, path);
  if (o["pull_request"] !== undefined && o["pull_request"] !== null) return null;
  const state = str(o, "state", path);
  if (state !== "open" && state !== "closed") throw new ValidationError(`${path}.state: expected "open" | "closed"`, `${path}.state`);
  const user = o["user"];
  const assignees = o["assignees"];
  return {
    id: num(o, "id", path),
    number: num(o, "number", path),
    repository: parseRepositoryUrl(str(o, "repository_url", path), `${path}.repository_url`),
    title: str(o, "title", path),
    state,
    state_reason: optStr(o, "state_reason", path),
    html_url: str(o, "html_url", path),
    user: user === null || user === undefined ? null : readPerson(user, `${path}.user`),
    // labels は文字列だけの形で返ることもある
    labels: arrayOf(o["labels"], `${path}.labels`, (x, p) => {
      if (typeof x === "string") return { name: x, color: null, description: null };
      const l = obj(x, p);
      return { name: str(l, "name", p), color: optStr(l, "color", p), description: optStr(l, "description", p) };
    }),
    assignees: assignees === null || assignees === undefined ? [] : arrayOf(assignees, `${path}.assignees`, readPerson),
    comments: num(o, "comments", path),
    created_at: str(o, "created_at", path),
    updated_at: str(o, "updated_at", path),
    closed_at: optStr(o, "closed_at", path),
  };
}

export function readSearchPage(v: unknown): IssueSearchPage {
  const o = obj(v, "search");
  const issues = arrayOf(o["items"], "search.items", readIssue).filter((x): x is GitHubIssue => x !== null);
  return { totalCount: num(o, "total_count", "search"), incomplete: bool(o, "incomplete_results", "search"), issues };
}

/** 1 ページ分 */
export async function searchIssuesPage(
  http: GitHubHttp,
  q: string,
  page: number,
  call: Call & { sort?: "created" | "updated" | "comments"; order?: "asc" | "desc" } = {},
): Promise<IssueSearchPage> {
  const { sort = "updated", order = "desc", ...rest } = call;
  const { data } = await http.json("/search/issues", { ...rest, query: { q, sort, order, per_page: PER_PAGE, page } });
  return decode(() => readSearchPage(data));
}

/** 上限（1000 件）まで全ページ取得する。totalCount が上限を超えていれば truncated: true */
export async function searchIssues(
  http: GitHubHttp,
  q: string,
  call: Call & { firstPage?: IssueSearchPage } = {},
): Promise<IssueSearchPage & { truncated: boolean }> {
  const { firstPage, ...rest } = call;
  const first = firstPage ?? (await searchIssuesPage(http, q, 1, rest));
  const issues = [...first.issues];
  let incomplete = first.incomplete;
  const lastPage = Math.ceil(Math.min(first.totalCount, SEARCH_RESULT_LIMIT) / PER_PAGE);
  for (let page = 2; page <= lastPage; page++) {
    const p = await searchIssuesPage(http, q, page, rest);
    issues.push(...p.issues);
    incomplete ||= p.incomplete;
    if (p.issues.length === 0) break;
  }
  return { totalCount: first.totalCount, incomplete, issues, truncated: first.totalCount > SEARCH_RESULT_LIMIT };
}

/** 検索クエリは所有者 1 つごとに作る（複数の org:/user: をまとめたときの解釈に依存しないため） */
export function buildIssueQuery(
  owner: { login: string; type: string },
  filter: IssueSearchFilter = {},
  created?: DateRange,
): string {
  const parts = ["is:issue"];
  const state = filter.state ?? "open";
  if (state !== "all") parts.push(`is:${state}`);
  parts.push(`${owner.type === "Organization" ? "org" : "user"}:${owner.login}`);
  if (created) parts.push(`created:${created.from}..${created.to}`);
  const extra = filter.extra?.trim();
  if (extra) parts.push(extra);
  return parts.join(" ");
}

/** 日付範囲を重ならない 2 つに分ける。1 日だけなら分けられないので null */
export function splitRange(range: DateRange): [DateRange, DateRange] | null {
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  const days = Math.round((to - from) / DAY_MS);
  if (!(days >= 1)) return null;
  const mid = from + Math.floor(days / 2) * DAY_MS;
  return [
    { from: range.from, to: utcDate(mid) },
    { from: utcDate(mid + DAY_MS), to: range.to },
  ];
}

/**
 * 1 つの所有者の Issue を全件集める。1 回の検索で 1000 件を超える場合は、作成日の範囲を半分ずつに分けて検索し直す。
 * 1 日に絞っても超える分は取りきれず、truncated: true になる
 */
export async function searchOwnerIssues(
  http: GitHubHttp,
  owner: { login: string; type: string },
  filter: IssueSearchFilter,
  options: Call & { since?: string; today?: string } = {},
): Promise<{ issues: GitHubIssue[]; truncated: boolean }> {
  const call = options.signal ? { signal: options.signal } : {};
  const whole = { from: options.since ?? "2008-01-01", to: options.today ?? utcDate(Date.now()) };
  const seen = new Map<number, GitHubIssue>();
  let truncated = false;

  const searchRange = async (range: DateRange | undefined): Promise<void> => {
    const q = buildIssueQuery(owner, filter, range);
    const first = await searchIssuesPage(http, q, 1, call);
    if (first.totalCount > SEARCH_RESULT_LIMIT) {
      const split = splitRange(range ?? whole);
      if (split) {
        await searchRange(split[0]);
        await searchRange(split[1]);
        return;
      }
    }
    const res = await searchIssues(http, q, { ...call, firstPage: first });
    truncated ||= res.truncated;
    for (const issue of res.issues) seen.set(issue.id, issue);
  };

  await searchRange(undefined);
  return { issues: [...seen.values()], truncated };
}

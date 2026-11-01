// 認証したユーザー、所属 Organization、アクセスできるリポジトリ、トークンの情報。

import { arrayOf, bool, num, obj, optStr, str } from "../../lib/validation";
import { decode } from "./errors";
import { PER_PAGE, type GitHubHttp } from "./http";

export interface GitHubAccount {
  login: string;
  id: number;
  /** "User" / "Organization" / "Bot" など */
  type: string;
  avatar_url: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: GitHubAccount;
  private: boolean;
  archived: boolean;
  html_url: string;
  pushed_at: string | null;
  default_branch: string | null;
}

export type TokenKind = "classic-pat" | "fine-grained-pat" | "oauth" | "github-app-user" | "unknown";

export interface TokenInspection {
  kind: TokenKind;
  user: GitHubAccount;
  /** Classic PAT / OAuth トークンのスコープ。それ以外は null */
  scopes: string[] | null;
  /** 有効期限（ISO 8601）。期限なし・不明なら null */
  expiresAt: string | null;
}

interface Call {
  signal?: AbortSignal;
}

export function readAccount(v: unknown, path = "account", type?: string): GitHubAccount {
  const o = obj(v, path);
  return {
    login: str(o, "login", path),
    id: num(o, "id", path),
    type: type ?? optStr(o, "type", path) ?? "User",
    avatar_url: str(o, "avatar_url", path),
  };
}

export function readRepository(v: unknown, path = "repo"): GitHubRepository {
  const o = obj(v, path);
  return {
    id: num(o, "id", path),
    name: str(o, "name", path),
    full_name: str(o, "full_name", path),
    owner: readAccount(o["owner"], `${path}.owner`),
    private: bool(o, "private", path),
    archived: bool(o, "archived", path),
    html_url: str(o, "html_url", path),
    pushed_at: optStr(o, "pushed_at", path),
    default_branch: optStr(o, "default_branch", path),
  };
}

/** トークンの種類・スコープ・有効期限と、ログインしているユーザーを調べる */
export async function inspectToken(http: GitHubHttp, token: string, call: Call = {}): Promise<TokenInspection> {
  const { data, response } = await http.json("/user", call);
  const kind = tokenKindFromPrefix(token);
  // スコープを持つのは Classic PAT と OAuth トークンだけ。
  // スコープを持たないトークンにも空の X-OAuth-Scopes が付くことがあるので、ヘッダーの有無では判断しない
  const scopesHeader = response.headers.get("x-oauth-scopes");
  const hasScopes = kind === "classic-pat" || kind === "oauth";
  return {
    kind,
    user: decode(() => readAccount(data, "user")),
    scopes: hasScopes && scopesHeader !== null ? splitScopes(scopesHeader) : null,
    expiresAt: parseTokenExpiration(response.headers.get("github-authentication-token-expiration")),
  };
}

export async function listMyOrganizations(http: GitHubHttp, call: Call = {}): Promise<GitHubAccount[]> {
  const orgs: GitHubAccount[] = [];
  for await (const page of http.paginate("/user/orgs", { ...call, query: { per_page: PER_PAGE } })) {
    // /user/orgs の要素は type を持たない
    orgs.push(...decode(() => arrayOf(page, "orgs", (x, p) => readAccount(x, p, "Organization"))));
  }
  return orgs;
}

/** 自分がアクセスできるリポジトリ（自分の所有・コラボレーター・所属 Org）を全部返す */
export async function listMyRepositories(http: GitHubHttp, call: Call = {}): Promise<GitHubRepository[]> {
  const repos: GitHubRepository[] = [];
  const query = { per_page: PER_PAGE, affiliation: "owner,collaborator,organization_member", sort: "full_name" };
  for await (const page of http.paginate("/user/repos", { ...call, query })) {
    repos.push(...decode(() => arrayOf(page, "repos", readRepository)));
  }
  return repos;
}

export function tokenKindFromPrefix(token: string): TokenKind {
  if (token.startsWith("ghp_")) return "classic-pat";
  if (token.startsWith("github_pat_")) return "fine-grained-pat";
  if (token.startsWith("gho_")) return "oauth";
  if (token.startsWith("ghu_")) return "github-app-user";
  return "unknown";
}

/** "repo, read:org" や "repo,read:org" をスコープの配列にする */
export function splitScopes(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

/**
 * GitHub-Authentication-Token-Expiration ヘッダー（例: "2026-11-30 12:34:56 UTC"）を ISO 8601 にする。
 * 解釈できなければ null。
 */
export function parseTokenExpiration(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const zone = m[3] === undefined || m[3] === "UTC" || m[3] === "Z" ? "Z" : m[3].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

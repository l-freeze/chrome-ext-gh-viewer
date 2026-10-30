// 認証情報（OAuth トークンと PAT）の保存と検証。

import type { GitHubClient } from "../api/client";
import type { TokenKind } from "../api/types";
import type { KeyValueStore } from "../platform/storage";

export type AuthMethod = "oauth" | "pat";

export interface Credential {
  id: string;
  source: AuthMethod;
  token: string;
  kind: TokenKind;
  login: string;
  avatarUrl: string;
  /** Classic PAT / OAuth のスコープ。Fine-grained PAT は null */
  scopes: string[] | null;
  expiresAt: string | null;
  addedAt: string;
}

export interface AuthSettings {
  method: AuthMethod;
  credentials: Credential[];
}

const STORAGE_KEY = "auth";

/** アーティファクトの削除（private リポジトリ含む）と Org 一覧に必要なスコープ */
export const REQUIRED_SCOPES = ["repo", "read:org"] as const;

/** 上位のスコープが下位のスコープを含む関係 */
const IMPLIED_BY: Record<string, string[]> = {
  "read:org": ["write:org", "admin:org"],
};

export function defaultAuthSettings(oauthAvailable: boolean): AuthSettings {
  return { method: oauthAvailable ? "oauth" : "pat", credentials: [] };
}

export async function loadAuthSettings(store: KeyValueStore, oauthAvailable: boolean): Promise<AuthSettings> {
  const saved = await store.get<AuthSettings>(STORAGE_KEY);
  if (!saved || !Array.isArray(saved.credentials)) return defaultAuthSettings(oauthAvailable);
  // OAuth が使えないビルドでは PAT に切り替える
  const method = saved.method === "oauth" && !oauthAvailable ? "pat" : saved.method;
  return { method, credentials: saved.credentials };
}

export async function saveAuthSettings(store: KeyValueStore, settings: AuthSettings): Promise<void> {
  await store.set(STORAGE_KEY, settings);
}

/**
 * 選んでいる接続方法の認証情報。
 * 全所有者に使える OAuth / Classic PAT を先に、所有者が限られる Fine-grained PAT を後に並べる。
 */
export function activeCredentials(settings: AuthSettings): Credential[] {
  const rank = (c: Credential) => (c.kind === "fine-grained-pat" ? 1 : 0);
  return settings.credentials.filter((c) => c.source === settings.method).sort((a, b) => rank(a) - rank(b));
}

export function missingScopes(credential: Pick<Credential, "scopes">): string[] {
  if (credential.scopes === null) return [];
  const have = new Set(credential.scopes);
  return REQUIRED_SCOPES.filter((s) => !have.has(s) && !(IMPLIED_BY[s] ?? []).some((x) => have.has(x)));
}

/** トークンを API で確認し、保存用の認証情報を作る */
export async function inspectCredential(
  token: string,
  source: AuthMethod,
  client: GitHubClient,
  options: { now?: () => Date; newId?: () => string; signal?: AbortSignal } = {},
): Promise<Credential> {
  const info = await client.inspectToken(token, options.signal ? { signal: options.signal } : {});
  return {
    id: (options.newId ?? (() => crypto.randomUUID()))(),
    source,
    token,
    kind: info.kind,
    login: info.user.login,
    avatarUrl: info.user.avatarUrl,
    scopes: info.scopes,
    expiresAt: info.expiresAt,
    addedAt: (options.now?.() ?? new Date()).toISOString(),
  };
}

/** 画面表示用。トークン本体の先頭と末尾だけを見せる */
export function maskToken(token: string): string {
  const prefix = /^(github_pat_|gh[pousr]_)/.exec(token)?.[1] ?? "";
  return `${prefix}…${token.slice(-4)}`;
}

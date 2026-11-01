// 接続方法と認証情報（OAuth トークン・PAT）。

export type AuthMethod = "oauth" | "pat";

export type TokenKind = "classic-pat" | "fine-grained-pat" | "oauth" | "github-app-user" | "unknown";

export interface Credential {
  id: string;
  source: AuthMethod;
  token: string;
  kind: TokenKind;
  login: string;
  avatarUrl: string;
  /** Classic PAT / OAuth のスコープ。それ以外は null */
  scopes: string[] | null;
  expiresAt: string | null;
  addedAt: string;
}

export interface AuthSettings {
  method: AuthMethod;
  credentials: Credential[];
}

/** 画面に出す Device Flow のコード */
export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** アーティファクトの削除（private リポジトリ含む）、Org 一覧、プロジェクトの項目の移動に必要なスコープ */
export const REQUIRED_SCOPES = ["repo", "read:org", "project"] as const;

/** 上位のスコープが下位のスコープを含む関係 */
const IMPLIED_BY: Record<string, string[]> = {
  "read:org": ["write:org", "admin:org"],
};

export class DuplicateTokenError extends Error {
  override readonly name = "DuplicateTokenError";
  constructor() {
    super("This token is already added");
  }
}

export function defaultAuthSettings(oauthAvailable: boolean): AuthSettings {
  return { method: oauthAvailable ? "oauth" : "pat", credentials: [] };
}

/** 全所有者に使えるか（OAuth / Classic PAT）。Fine-grained PAT は所有者が限られる */
export function isBroad(c: Pick<Credential, "kind">): boolean {
  return c.kind !== "fine-grained-pat";
}

/** 選んでいる接続方法の認証情報。全所有者に使えるものを先に並べる */
export function activeCredentials(settings: AuthSettings): Credential[] {
  return settings.credentials.filter((c) => c.source === settings.method).sort((a, b) => Number(isBroad(b)) - Number(isBroad(a)));
}

export function missingScopes(credential: Pick<Credential, "scopes">): string[] {
  if (credential.scopes === null) return [];
  const have = new Set(credential.scopes);
  return REQUIRED_SCOPES.filter((s) => !have.has(s) && !(IMPLIED_BY[s] ?? []).some((x) => have.has(x)));
}

/** 画面表示用。トークン本体の先頭と末尾だけを見せる */
export function maskToken(token: string): string {
  const prefix = /^(github_pat_|gh[pousr]_)/.exec(token)?.[1] ?? "";
  return `${prefix}…${token.slice(-4)}`;
}

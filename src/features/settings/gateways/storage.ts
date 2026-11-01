// 認証情報の保存形式。保存済みの値は読み出すときに形を確かめる。

import { typedStore, type StorageDriver } from "../../../infrastructure/storage/contracts";
import { arrayOf, obj, optStr, str, ValidationError, type Validator } from "../../../lib/validation";
import type { AuthSettings, Credential, TokenKind } from "../credential";
import type { CredentialRepository } from "../ports";

const TOKEN_KINDS: readonly TokenKind[] = ["classic-pat", "fine-grained-pat", "oauth", "github-app-user", "unknown"];

const readCredential = (v: unknown, path: string): Credential => {
  const o = obj(v, path);
  const source = str(o, "source", path);
  if (source !== "oauth" && source !== "pat") throw new ValidationError(`${path}.source: unknown`, `${path}.source`);
  const kind = str(o, "kind", path);
  const scopes = o["scopes"];
  return {
    id: str(o, "id", path),
    source,
    token: str(o, "token", path),
    kind: (TOKEN_KINDS as readonly string[]).includes(kind) ? (kind as TokenKind) : "unknown",
    login: str(o, "login", path),
    avatarUrl: str(o, "avatarUrl", path),
    scopes: scopes === null || scopes === undefined ? null : arrayOf(scopes, `${path}.scopes`, (x, p) => {
      if (typeof x !== "string") throw new ValidationError(`${p}: expected string`, p);
      return x;
    }),
    expiresAt: optStr(o, "expiresAt", path),
    addedAt: str(o, "addedAt", path),
  };
};

const settings: Validator<AuthSettings> = {
  parse(v) {
    const o = obj(v, "auth");
    const method = str(o, "method", "auth");
    if (method !== "oauth" && method !== "pat") throw new ValidationError("auth.method: unknown", "auth.method");
    return { method, credentials: arrayOf(o["credentials"], "auth.credentials", readCredential) };
  },
};

export function createCredentialStorage(driver: StorageDriver): CredentialRepository {
  const store = typedStore<AuthSettings, AuthSettings | null>(driver, {
    key: "auth",
    input: settings,
    output: settings,
    empty: () => null,
    encode: (v) => v,
  });
  return { load: () => store.load(), save: (value) => store.save(value) };
}

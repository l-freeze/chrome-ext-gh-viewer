import { DuplicateTokenError, type AuthSettings, type Credential } from "../credential";
import type { CredentialRepository, TokenInspector } from "../ports";
import type { LoadSettings } from "./load";

export interface AddTokenInput {
  token: string;
}

export type AddToken = (input: AddTokenInput) => Promise<AuthSettings>;

/** 重複を確かめ → GitHub でトークンを確認し → PAT として保存する */
export function createAddToken(
  load: LoadSettings,
  inspector: TokenInspector,
  repository: CredentialRepository,
  clock: { now: () => number; newId: () => string },
): AddToken {
  return async ({ token }) => {
    const current = await load();
    if (current.credentials.some((c) => c.token === token)) throw new DuplicateTokenError();
    const info = await inspector.inspect(token);
    const credential: Credential = { id: clock.newId(), source: "pat", token, ...info, addedAt: new Date(clock.now()).toISOString() };
    const next: AuthSettings = { method: "pat", credentials: [...current.credentials, credential] };
    await repository.save(next);
    return next;
  };
}

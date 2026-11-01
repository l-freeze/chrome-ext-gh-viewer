import type { AuthSettings, Credential, DeviceCode } from "../credential";
import type { CredentialRepository, DeviceAuthorizer, TokenInspector } from "../ports";
import type { LoadSettings } from "./load";

export type FinishSignIn = (code: DeviceCode, signal?: AbortSignal) => Promise<AuthSettings>;

/** 承認を待ち → トークンを確認し → OAuth の認証情報として保存する（OAuth の認証情報は 1 つだけ持つ） */
export function createFinishSignIn(
  load: LoadSettings,
  authorizer: DeviceAuthorizer,
  inspector: TokenInspector,
  repository: CredentialRepository,
  clock: { now: () => number; newId: () => string },
): FinishSignIn {
  return async (code, signal) => {
    const token = await authorizer.pollToken(code, signal);
    const info = await inspector.inspect(token);
    const credential: Credential = { id: clock.newId(), source: "oauth", token, ...info, addedAt: new Date(clock.now()).toISOString() };
    const current = await load();
    const next: AuthSettings = { method: "oauth", credentials: [...current.credentials.filter((c) => c.source !== "oauth"), credential] };
    await repository.save(next);
    return next;
  };
}

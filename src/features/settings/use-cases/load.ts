import { defaultAuthSettings, type AuthSettings } from "../credential";
import type { CredentialRepository } from "../ports";

export type LoadSettings = () => Promise<AuthSettings>;

/** OAuth が使えないビルドで OAuth が選ばれていたら、PAT に切り替えて返す */
export function createLoadSettings(repository: CredentialRepository, oauthAvailable: boolean): LoadSettings {
  return async () => {
    const saved = await repository.load();
    if (!saved) return defaultAuthSettings(oauthAvailable);
    return { ...saved, method: saved.method === "oauth" && !oauthAvailable ? "pat" : saved.method };
  };
}

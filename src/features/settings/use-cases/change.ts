import type { AuthMethod, AuthSettings } from "../credential";
import type { CredentialRepository } from "../ports";
import type { LoadSettings } from "./load";

export type SetMethod = (method: AuthMethod) => Promise<AuthSettings>;
export type RemoveCredential = (id: string) => Promise<AuthSettings>;

export function createSetMethod(load: LoadSettings, repository: CredentialRepository): SetMethod {
  return async (method) => {
    const next = { ...(await load()), method };
    await repository.save(next);
    return next;
  };
}

export function createRemoveCredential(load: LoadSettings, repository: CredentialRepository): RemoveCredential {
  return async (id) => {
    const current = await load();
    const next = { ...current, credentials: current.credentials.filter((c) => c.id !== id) };
    await repository.save(next);
    return next;
  };
}

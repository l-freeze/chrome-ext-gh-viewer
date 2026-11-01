import { createAddTokenController } from "./controllers/add-token";
import type { CredentialRepository, DeviceAuthorizer, SettingsOperations, TokenInspector } from "./ports";
import { createAddToken } from "./use-cases/add-token";
import { createRemoveCredential, createSetMethod } from "./use-cases/change";
import { createLoadSettings } from "./use-cases/load";
import { createFinishSignIn } from "./use-cases/sign-in";

export function createSettingsFeature(dependencies: {
  repository: CredentialRepository;
  inspector: TokenInspector;
  /** OAuth App の Client ID がないビルドでは null */
  authorizer: DeviceAuthorizer | null;
  clock?: { now: () => number; newId: () => string };
}): SettingsOperations {
  const { repository, inspector, authorizer } = dependencies;
  const clock = dependencies.clock ?? { now: () => Date.now(), newId: () => crypto.randomUUID() };
  const load = createLoadSettings(repository, authorizer !== null);
  return {
    load,
    setMethod: createSetMethod(load, repository),
    addToken: createAddTokenController(createAddToken(load, inspector, repository, clock)),
    remove: createRemoveCredential(load, repository),
    signIn: authorizer && {
      start: (signal) => authorizer.requestCode(signal),
      finish: createFinishSignIn(load, authorizer, inspector, repository, clock),
    },
  };
}

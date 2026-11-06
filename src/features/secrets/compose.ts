import type { SecretOperations, SecretSource } from "./ports";
import { createListSecrets } from "./use-cases/list";

export function createSecretsFeature(dependencies: { source: SecretSource }): SecretOperations {
  return { list: createListSecrets(dependencies.source) };
}

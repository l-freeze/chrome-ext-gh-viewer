import { typedStore, type StorageDriver } from "../../../infrastructure/storage/contracts";
import { arrayOf, ValidationError, type Validator } from "../../../lib/validation";
import type { OwnerSelectionRepository } from "../ports";

const logins: Validator<string[]> = {
  parse(v) {
    try {
      return arrayOf(v, "hiddenOwners", (x, p) => {
        if (typeof x !== "string") throw new ValidationError(`${p}: expected string`, p);
        return x;
      });
    } catch (e) {
      throw e instanceof ValidationError ? e : new ValidationError(String(e));
    }
  },
};

export function createOwnerSelectionStorage(driver: StorageDriver): OwnerSelectionRepository {
  const store = typedStore(driver, { key: "hiddenOwners", input: logins, output: logins, empty: () => [], encode: (v) => v });
  return { load: () => store.load(), save: (hidden) => store.save(hidden) };
}

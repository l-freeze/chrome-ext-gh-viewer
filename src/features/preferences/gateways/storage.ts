import { typedStore, type StorageDriver } from "../../../infrastructure/storage/contracts";
import { bool, obj, type Validator } from "../../../lib/validation";
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences, type DisplayPreferencesRepository } from "../ports";

const preferences: Validator<DisplayPreferences> = {
  parse(v) {
    return { autoRefresh: bool(obj(v, "display"), "autoRefresh", "display") };
  },
};

export function createDisplayPreferencesStorage(driver: StorageDriver): DisplayPreferencesRepository {
  const store = typedStore(driver, {
    key: "display",
    input: preferences,
    output: preferences,
    empty: () => ({ ...DEFAULT_DISPLAY_PREFERENCES }),
    encode: (v) => v,
  });
  return { load: () => store.load(), save: (p) => store.save(p) };
}

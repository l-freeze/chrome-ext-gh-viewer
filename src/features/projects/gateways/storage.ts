import { typedStore, type StorageDriver } from "../../../infrastructure/storage/contracts";
import { arrayOf, obj, ValidationError, type Validator } from "../../../lib/validation";
import { ITEM_KINDS, type ItemKind } from "../project";
import { DEFAULT_BOARD_PREFERENCES, type BoardPreferences, type BoardPreferencesRepository } from "../ports";

const strings = (v: unknown, path: string) =>
  arrayOf(v, path, (x, p) => {
    if (typeof x !== "string") throw new ValidationError(`${p}: expected string`, p);
    return x;
  });

const preferences: Validator<BoardPreferences> = {
  parse(v) {
    const o = obj(v, "board");
    const kinds = strings(o["kinds"], "board.kinds").filter((k): k is ItemKind => (ITEM_KINDS as readonly string[]).includes(k));
    return { kinds, collapsed: strings(o["collapsed"], "board.collapsed") };
  },
};

export function createBoardPreferencesStorage(driver: StorageDriver): BoardPreferencesRepository {
  const store = typedStore(driver, {
    key: "projectBoard",
    input: preferences,
    output: preferences,
    empty: () => ({ ...DEFAULT_BOARD_PREFERENCES, kinds: [...DEFAULT_BOARD_PREFERENCES.kinds] }),
    encode: (v) => v,
  });
  return { load: () => store.load(), save: (p) => store.save(p) };
}

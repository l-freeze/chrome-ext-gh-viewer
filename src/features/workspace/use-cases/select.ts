import type { OwnerSelectionRepository } from "../ports";

export type ToggleOwner = (hidden: readonly string[], login: string) => Promise<string[]>;

/** 選択を外した所有者だけを覚える。新しく見つかった所有者は最初から選択された状態になる */
export function createToggleOwner(repository: OwnerSelectionRepository): ToggleOwner {
  return async (hidden, login) => {
    const key = login.toLowerCase();
    const next = hidden.includes(key) ? hidden.filter((h) => h !== key) : [...hidden, key];
    await repository.save(next);
    return next;
  };
}

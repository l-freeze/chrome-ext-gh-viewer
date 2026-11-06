// Actions の Secrets と Variables の項目と、一覧の絞り込み・並べ方。閲覧のみで、変更する操作は持たない。

import type { RepoRef } from "../workspace/repository";

export type ItemKind = "secret" | "variable";

export interface ConfigItem {
  repo: RepoRef;
  /** Environment 単位なら Environment の名前。リポジトリ単位なら null */
  environment: string | null;
  kind: ItemKind;
  name: string;
  /** Variables の値。Secrets は値を読めないので null */
  value: string | null;
  createdAt: string;
  updatedAt: string;
}

export type KindFilter = "all" | ItemKind;

/** 一覧のキー（リポジトリ・範囲・種類・名前で一意） */
export function itemKey(item: ConfigItem): string {
  return `${item.repo.owner}/${item.repo.name}|${item.environment ?? ""}|${item.kind}|${item.name}`;
}

/**
 * 種類と、空白で区切った語で絞り込む。語はすべて、名前・Variables の値・Environment・リポジトリのどれかに含まれるものを残す
 */
export function filterItems(items: readonly ConfigItem[], kind: KindFilter, text: string): ConfigItem[] {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    const haystack = [item.name, item.value ?? "", item.environment ?? "", `${item.repo.owner}/${item.repo.name}`].join("\n").toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/** リポジトリ単位を先に、Environment は名前順。その中で Secrets、Variables の順に名前順で並べる */
export function sortItems(items: readonly ConfigItem[]): ConfigItem[] {
  const scope = (i: ConfigItem) => (i.environment === null ? "" : `\u0001${i.environment}`);
  return [...items].sort(
    (a, b) =>
      scope(a).localeCompare(scope(b)) ||
      (a.kind === b.kind ? 0 : a.kind === "secret" ? -1 : 1) ||
      a.name.localeCompare(b.name),
  );
}

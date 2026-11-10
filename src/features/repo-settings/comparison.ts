// リポジトリの設定の違い: 設定ごとにいちばん多い値を求め、それと違うリポジトリを示す。

import { repoKey } from "../workspace/repository";
import { comparable, SETTINGS, type RepoSettings, type SettingKey, type SettingValue } from "./settings";

export interface SettingColumn {
  key: SettingKey;
  /** いちばん多い値（読めた値の中で。同じ数なら上の行の値）。読めた値が無ければ null */
  majority: SettingValue | null;
  /** 読めた値がすべて同じ（違いが無い） */
  uniform: boolean;
  /** いちばん多い値と違うリポジトリの数 */
  differing: number;
}

export interface SettingsComparison {
  /** リポジトリの名前順 */
  rows: RepoSettings[];
  columns: SettingColumn[];
}

export function compareSettings(list: readonly RepoSettings[]): SettingsComparison {
  const rows = [...list].sort((a, b) => repoKey(a.repo).localeCompare(repoKey(b.repo)));
  const columns = SETTINGS.map(({ key }): SettingColumn => {
    const counts = new Map<string, { value: SettingValue; count: number }>();
    for (const row of rows) {
      const v = row.values[key];
      const c = comparable(v);
      if (c === null) continue;
      const entry = counts.get(c) ?? { value: v, count: 0 };
      entry.count++;
      counts.set(c, entry);
    }
    let majority: { value: SettingValue; count: number } | null = null;
    for (const entry of counts.values()) if (!majority || entry.count > majority.count) majority = entry;
    const m = majority ? comparable(majority.value) : null;
    const differing = rows.filter((r) => {
      const c = comparable(r.values[key]);
      return c !== null && c !== m;
    }).length;
    return { key, majority: majority?.value ?? null, uniform: counts.size <= 1, differing };
  });
  return { rows, columns };
}

/** いちばん多い値と違うか（読めなかったものは違うとしない） */
export function differsFromMajority(value: SettingValue, column: SettingColumn): boolean {
  const c = comparable(value);
  return c !== null && column.majority !== null && c !== comparable(column.majority);
}

/** いちばん多い値と違う設定があるリポジトリか（columns に渡した設定の中で） */
export function rowDiffers(row: RepoSettings, columns: readonly SettingColumn[]): boolean {
  return columns.some((c) => differsFromMajority(row.values[c.key], c));
}

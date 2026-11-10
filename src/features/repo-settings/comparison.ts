// リポジトリの設定の違い: 設定ごとにいちばん多い値を求め、それと違うリポジトリを示す。

import type { SortDirection } from "../../lib/sort";
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

/** 並べ替えの列: リポジトリ名か設定 */
export type SettingsSortKey = "repo" | SettingKey;

/** 並べ替えの条件。並べた順に優先する（SQL の ORDER BY a, b と同じ） */
export type SettingsSort = ReadonlyArray<{ key: SettingsSortKey; dir: SortDirection }>;

/** 並べ替えに使う値。オフはオンより前、PR 必須の「不要」は承認の数より前。読めなかったもの（null）は向きにかかわらず末尾 */
function sortValue(row: RepoSettings, key: SettingsSortKey): string | number | null {
  if (key === "repo") return repoKey(row.repo).toLowerCase();
  const v = row.values[key];
  if (v.kind !== "value") return null;
  if (typeof v.value === "boolean") return key === "requirePullRequest" ? (v.value ? 0 : -1) : v.value ? 1 : 0;
  return v.value;
}

function compareValues(a: string | number | null, b: string | number | null, dir: SortDirection): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  const c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
  return dir === "asc" ? c : -c;
}

/** 条件の順に並べ替える。どの条件でも差が付かなければリポジトリ名の昇順（条件が無ければリポジトリ名の昇順） */
export function sortRows(rows: readonly RepoSettings[], sort: SettingsSort): RepoSettings[] {
  const keys = [...sort, { key: "repo" as const, dir: "asc" as const }];
  return [...rows].sort((a, b) => {
    for (const { key, dir } of keys) {
      const c = compareValues(sortValue(a, key), sortValue(b, key), dir);
      if (c !== 0) return c;
    }
    return 0;
  });
}

/** 見出しを押したときの条件: 無ければ末尾に昇順で足し、昇順なら降順に、降順なら外す */
export function cycleSort(sort: SettingsSort, key: SettingsSortKey): SettingsSort {
  const current = sort.find((s) => s.key === key);
  if (!current) return [...sort, { key, dir: "asc" }];
  if (current.dir === "asc") return sort.map((s) => (s.key === key ? { key, dir: "desc" as const } : s));
  return sort.filter((s) => s.key !== key);
}

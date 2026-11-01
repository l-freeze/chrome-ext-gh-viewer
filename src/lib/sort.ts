// 一覧の並べ替え。値のないものは向きにかかわらず末尾に置く。

export type SortDirection = "asc" | "desc";

export interface SortState<Key extends string> {
  key: Key;
  dir: SortDirection;
}

export function sortBy<T>(
  list: readonly T[],
  value: (item: T) => string | number | null,
  dir: SortDirection,
  tieBreak: (a: T, b: T) => number,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0) || tieBreak(a, b);
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return c * sign || tieBreak(a, b);
  });
}

/** 同じ列なら向きを反転し、違う列なら列ごとの既定の向きにする */
export function toggleSort<Key extends string>(
  current: SortState<Key>,
  key: Key,
  defaultDir: (key: Key) => SortDirection,
): SortState<Key> {
  return current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir(key) };
}

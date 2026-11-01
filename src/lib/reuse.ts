// 取り直した値のうち、前と同じものは前のオブジェクトをそのまま使う。
// 画面は参照で差分を取るので、変わっていない行やカードを作り直さずに済む。

/** JSON にしたときに同じ値か（取得した値の比較用。関数や循環参照は扱わない） */
export function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** 一覧を取り直したときの合わせ方。全体が同じなら前の配列を、違えば変わっていない要素だけ前のものを使う */
export function mergeList<T>(keyOf: (item: T) => string | number): (prev: T[], next: T[]) => T[] {
  return (prev, next) => (sameValue(prev, next) ? prev : reuseUnchanged(prev, next, keyOf));
}

/** next の各要素について、prev に同じキーで同じ値のものがあればそちらを返す。並びは next のまま */
export function reuseUnchanged<T>(prev: readonly T[], next: readonly T[], keyOf: (item: T) => string | number): T[] {
  const old = new Map(prev.map((item) => [keyOf(item), item]));
  return next.map((item) => {
    const before = old.get(keyOf(item));
    return before !== undefined && sameValue(before, item) ? before : item;
  });
}

// 一覧の複数選択。絞り込みで見えなくなったものは操作の対象にしない。

import { createMemo, type Accessor } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

export interface Selection<T> {
  isSelected(id: number): boolean;
  toggle(id: number): void;
  setMany(list: readonly T[], value: boolean): void;
  clear(): void;
  /** 指定したものだけを選ぶ */
  only(list: readonly T[]): void;
  /** 見えているもののうち選択中のもの */
  selected: Accessor<T[]>;
}

export function createSelection<T extends { id: number }>(visible: Accessor<readonly T[]>): Selection<T> {
  const [state, setState] = createStore<Record<number, boolean>>({});
  return {
    isSelected: (id) => state[id] === true,
    toggle: (id) => setState(id, (v) => !v),
    setMany: (list, value) =>
      setState(reconcile({ ...state, ...Object.fromEntries(list.map((x) => [x.id, value])) } as Record<number, boolean>)),
    clear: () => setState(reconcile({})),
    only: (list) => setState(reconcile(Object.fromEntries(list.map((x) => [x.id, true])) as Record<number, boolean>)),
    selected: createMemo(() => visible().filter((x) => state[x.id])),
  };
}

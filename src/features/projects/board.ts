// カンバン: プロジェクトの項目を、列にしたフィールドの選択肢ごとに並べる。

import type { ItemKind, Project, ProjectItem, SelectField, StatusOption } from "./project";

export interface Board {
  project: Project;
  /** 列にするフィールド。単一選択のフィールドがないプロジェクトでは null */
  field: SelectField | null;
  items: ProjectItem[];
}

export interface Column {
  /** 選択肢。null は「未設定」の列 */
  option: StatusOption | null;
  items: ProjectItem[];
}

/** 選択肢にない値は未設定として扱う */
function columnId(board: Board, item: ProjectItem): string | null {
  return item.statusId !== null && board.field?.options.some((o) => o.id === item.statusId) ? item.statusId : null;
}

/**
 * 表示する種類の項目を列に分ける。
 * 未設定の列は、該当する項目があるときだけ先頭に置く（GitHub のボードと同じ並び）
 */
export function columnsOf(board: Board, kinds: ReadonlySet<ItemKind>): Column[] {
  const visible = board.items.filter((i) => kinds.has(i.kind));
  const byId = new Map<string | null, ProjectItem[]>();
  for (const item of visible) {
    const id = columnId(board, item);
    byId.set(id, [...(byId.get(id) ?? []), item]);
  }
  const columns: Column[] = (board.field?.options ?? []).map((option) => ({ option, items: byId.get(option.id) ?? [] }));
  const unset = byId.get(null) ?? [];
  return unset.length > 0 || columns.length === 0 ? [{ option: null, items: unset }, ...columns] : columns;
}

export function countVisible(board: Board, kinds: ReadonlySet<ItemKind>): number {
  return board.items.filter((i) => kinds.has(i.kind)).length;
}

/**
 * キーボードで隣の列へ動かすときの移動先。左端・右端より先はない（undefined）。
 * 未設定の列は左端にあるものとして扱う
 */
export function adjacentStatus(board: Board, item: ProjectItem, direction: -1 | 1): string | null | undefined {
  if (!board.field) return undefined;
  const order: Array<string | null> = [null, ...board.field.options.map((o) => o.id)];
  const index = order.indexOf(columnId(board, item));
  const next = index + direction;
  if (next < 0 || next >= order.length) return undefined;
  return order[next];
}

/** 項目の列を変えた盤面を返す（元の盤面は変えない） */
export function withItemStatus(board: Board, itemId: number, statusId: string | null): Board {
  return { ...board, items: board.items.map((i) => (i.id === itemId ? { ...i, statusId } : i)) };
}

/** 項目を外した盤面を返す（元の盤面は変えない） */
export function withoutItem(board: Board, itemId: number): Board {
  return { ...board, items: board.items.filter((i) => i.id !== itemId) };
}

/** 項目を加えた盤面を返す。同じ ID があれば置き換える（元の盤面は変えない） */
export function withItem(board: Board, item: ProjectItem): Board {
  return board.items.some((i) => i.id === item.id)
    ? { ...board, items: board.items.map((i) => (i.id === item.id ? item : i)) }
    : { ...board, items: [...board.items, item] };
}

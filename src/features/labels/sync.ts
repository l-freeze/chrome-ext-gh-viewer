// ラベルのそろえ込み: リポジトリごとのラベルを並べて比べ、基準の値にそろえるための変更の予定を作る。
// 予定を作るだけで、送ることはしない（送るのは use-cases/apply）。

import { repoKey, type RepoRef } from "../workspace/repository";
import { changedFields, labelKey, type Label, type LabelField, type LabelValue } from "./label";

/** 列: リポジトリ */
export interface LabelColumn {
  key: string;
  repo: RepoRef;
}

/** 行: 大文字と小文字を区別しない名前ごとのラベル。cells は列と同じ順で、無いリポジトリは null */
export interface LabelRow {
  key: string;
  cells: Array<Label | null>;
  /** 名前・色・説明のそれぞれで、いちばん多い値（同じ数なら左の列の値） */
  majority: LabelValue;
}

export interface LabelTable {
  columns: LabelColumn[];
  rows: LabelRow[];
}

/** 行ごとに人が変えたもの。reference は基準にするリポジトリ（列の key）、renameTo は変更後の名前 */
export interface RowEdit {
  reference?: string;
  renameTo?: string;
}

export type CellStatus = "missing" | "same" | "differs";

/** 名前の大文字と小文字の違いを含めて、行の値をそろえるための変更 */
export type LabelChange =
  | { kind: "create"; repo: RepoRef; next: LabelValue }
  | { kind: "update"; repo: RepoRef; current: Label; next: LabelValue; fields: LabelField[] };

/** 別の名前へ変えようとしたが、そのリポジトリにすでに変更後の名前があるので送らないもの */
export interface SkippedRename {
  repo: RepoRef;
  current: Label;
  target: string;
}

export interface LabelPlan {
  changes: LabelChange[];
  skipped: SkippedRename[];
}

export interface PlanInput {
  /** 対象にする行（key） */
  rows: readonly string[];
  edits: ReadonlyMap<string, RowEdit>;
  /** 足りないリポジトリに追加する */
  add: boolean;
  /** 名前（大文字と小文字）・色・説明が基準と違うものを変える */
  update: boolean;
}

function mostCommon(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "";
  for (const v of values) if ((counts.get(v) ?? 0) > (counts.get(best) ?? 0)) best = v;
  return best;
}

/**
 * リポジトリごとのラベルから表を作る。列はリポジトリの名前順（ラベルが 1 つも無いリポジトリも列にする）、行は名前順
 */
export function buildTable(sources: ReadonlyArray<{ repo: RepoRef; labels: readonly Label[] }>): LabelTable {
  const sorted = [...sources].sort((a, b) => repoKey(a.repo).localeCompare(repoKey(b.repo)));
  const columns = sorted.map(({ repo }) => ({ key: repoKey(repo), repo }));
  const byKey = new Map<string, Array<Label | null>>();
  sorted.forEach(({ labels }, i) => {
    for (const label of labels) {
      const key = labelKey(label.name);
      const cells = byKey.get(key) ?? new Array<Label | null>(columns.length).fill(null);
      cells[i] = { ...label, color: label.color.toLowerCase() };
      byKey.set(key, cells);
    }
  });
  const rows = [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cells]) => {
      const present = cells.filter((c): c is Label => c !== null);
      return {
        key,
        cells,
        majority: {
          name: mostCommon(present.map((c) => c.name)),
          color: mostCommon(present.map((c) => c.color)),
          description: mostCommon(present.map((c) => c.description)),
        },
      };
    });
  return { columns, rows };
}

/** 別の名前へ変える（大文字と小文字だけの違いは名前の表記をそろえるだけなので含めない） */
export function renameTarget(row: LabelRow, edit: RowEdit | undefined): string | null {
  const to = edit?.renameTo;
  return to !== undefined && labelKey(to) !== row.key ? to : null;
}

/** 行の基準の値。基準のリポジトリを選んでいればその値、なければいちばん多い値。表記だけを変える名前はここに入る */
export function referenceOf(table: LabelTable, row: LabelRow, edit: RowEdit | undefined): LabelValue {
  const index = edit?.reference === undefined ? -1 : table.columns.findIndex((c) => c.key === edit.reference);
  const chosen = index >= 0 ? row.cells[index] : null;
  const base: LabelValue = chosen ? { name: chosen.name, color: chosen.color, description: chosen.description } : row.majority;
  const to = edit?.renameTo;
  return to !== undefined && labelKey(to) === row.key ? { ...base, name: to } : base;
}

export function cellStatus(cell: Label | null, reference: LabelValue): CellStatus {
  if (!cell) return "missing";
  return changedFields(cell, reference).length === 0 ? "same" : "differs";
}

/** そろっていない行か（無いリポジトリがある、基準と違う値がある、別の名前へ変える） */
export function hasDifference(table: LabelTable, row: LabelRow, edit: RowEdit | undefined): boolean {
  if (renameTarget(row, edit) !== null) return true;
  const reference = referenceOf(table, row, edit);
  return row.cells.some((cell) => cellStatus(cell, reference) !== "same");
}

/**
 * 変更の予定を作る。順番は、別の名前への変更、値の変更、追加。
 * - 別の名前へ変えるとき、変更後の名前の行があればその行の基準の値に、なければこの行の基準の色と説明にする。
 *   そのリポジトリに変更後の名前がすでにあるか、ほかの行が同じ名前へ先に変えるなら送らない（GitHub が受け付けないため）
 * - 別の名前への変更で生まれるラベルは、追加しない
 */
export function buildPlan(table: LabelTable, input: PlanInput): LabelPlan {
  const rowByKey = new Map(table.rows.map((r) => [r.key, r]));
  const selected = input.rows.map((k) => rowByKey.get(k)).filter((r): r is LabelRow => r !== undefined);
  const renames: LabelChange[] = [];
  const updates: LabelChange[] = [];
  const creates: LabelChange[] = [];
  const skipped: SkippedRename[] = [];
  // 変更のあとで、そのリポジトリにある名前（列の key と行の key）
  const claimed = new Set<string>();
  const slot = (column: LabelColumn, key: string) => `${column.key}|${key}`;

  for (const row of selected) {
    const edit = input.edits.get(row.key);
    const target = renameTarget(row, edit);
    if (target === null) continue;
    const targetKey = labelKey(target);
    const targetRow = rowByKey.get(targetKey);
    const own = referenceOf(table, row, edit);
    const next: LabelValue = targetRow
      ? referenceOf(table, targetRow, input.edits.get(targetKey))
      : { name: target, color: own.color, description: own.description };
    table.columns.forEach((column, i) => {
      const current = row.cells[i];
      if (!current) return;
      if (targetRow?.cells[i] || claimed.has(slot(column, targetKey))) {
        skipped.push({ repo: column.repo, current, target: next.name });
        return;
      }
      claimed.add(slot(column, targetKey));
      renames.push({ kind: "update", repo: column.repo, current, next, fields: changedFields(current, next) });
    });
  }

  for (const row of selected) {
    const edit = input.edits.get(row.key);
    if (renameTarget(row, edit) !== null) continue;
    const reference = referenceOf(table, row, edit);
    table.columns.forEach((column, i) => {
      const current = row.cells[i];
      if (!current) {
        if (input.add && !claimed.has(slot(column, row.key))) creates.push({ kind: "create", repo: column.repo, next: reference });
        return;
      }
      const fields = changedFields(current, reference);
      if (input.update && fields.length > 0) updates.push({ kind: "update", repo: column.repo, current, next: reference, fields });
    });
  }

  return { changes: [...renames, ...updates, ...creates], skipped };
}

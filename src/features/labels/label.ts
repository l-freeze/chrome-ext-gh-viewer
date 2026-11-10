// ラベルのモデルと、モデル自体の規則（名前の比べ方、値の違い、名前の制限）。

import type { RepoRef } from "../workspace/repository";

/** ラベルの値（名前・色・説明）。色は # なしの 6 桁の 16 進数を小文字で持つ。説明がなければ空文字 */
export interface LabelValue {
  name: string;
  color: string;
  description: string;
}

export interface Label extends LabelValue {
  repo: RepoRef;
}

export type LabelField = "name" | "color" | "description";

/** GitHub はラベルの名前を大文字と小文字を区別せずに一意にする */
export function labelKey(name: string): string {
  return name.toLowerCase();
}

/** current を next にするために変える項目 */
export function changedFields(current: LabelValue, next: LabelValue): LabelField[] {
  const fields: LabelField[] = [];
  if (current.name !== next.name) fields.push("name");
  if (current.color.toLowerCase() !== next.color.toLowerCase()) fields.push("color");
  if (current.description !== next.description) fields.push("description");
  return fields;
}

/** GitHub が受け付けるラベルの名前の長さの上限 */
export const MAX_LABEL_NAME_LENGTH = 50;

/** 人が入力した名前を確かめる。前後の空白は除く */
export function readLabelName(raw: string): { ok: true; name: string } | { ok: false; reason: "empty" | "tooLong" } {
  const name = raw.trim();
  if (name === "") return { ok: false, reason: "empty" };
  if ([...name].length > MAX_LABEL_NAME_LENGTH) return { ok: false, reason: "tooLong" };
  return { ok: true, name };
}

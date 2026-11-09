// Secrets と Variables の比較表の状態（閲覧のみ）: 種類・名前・設定漏れだけ、の絞り込み。
// 取得は一覧と同じ結果（createSecretsState の results）を使い、ここでは呼び出さない。

import { createMemo, createSignal } from "solid-js";
import type { KindFilter } from "../../../features/secrets/item";
import { buildMatrix, filterRows } from "../../../features/secrets/matrix";
import type { SecretsState } from "./state";

export function createSecretsMatrixState(list: Pick<SecretsState, "results">) {
  const [kind, setKind] = createSignal<KindFilter>("all");
  const [text, setText] = createSignal("");
  const [gapsOnly, setGapsOnly] = createSignal(false);

  const matrix = createMemo(() => buildMatrix(list.results.values().flatMap((r) => r.value)));
  const rows = createMemo(() => filterRows(matrix().rows, { kind: kind(), text: text(), gapsOnly: gapsOnly() }));

  return {
    results: list.results,
    kind,
    setKind,
    text,
    setText,
    gapsOnly,
    setGapsOnly,
    matrix,
    rows,
    gapCount: createMemo(() => matrix().rows.filter((r) => r.hasGap).length),
  };
}

export type SecretsMatrixState = ReturnType<typeof createSecretsMatrixState>;

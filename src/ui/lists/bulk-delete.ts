// まとめて削除する流れ: 確認 → 削除中（進捗） → 結果。確認の段階を経ないと削除できない。

import { createSignal } from "solid-js";
import type { Settled, SettleOptions } from "../../lib/concurrency";

export type DeleteState = { phase: "idle" } | { phase: "confirm" } | { phase: "deleting"; done: number; total: number };

export interface DeleteOutcome<T> {
  removed: T[];
  errors: unknown[];
}

export function createBulkDelete<T extends { id: number }>(options: {
  targets: () => readonly T[];
  remove: (items: readonly T[], options: SettleOptions<T, void>) => Promise<Settled<T, void>[]>;
  onDone: (outcome: DeleteOutcome<T>) => void;
}) {
  const [state, setState] = createSignal<DeleteState>({ phase: "idle" });
  return {
    state,
    ask: () => options.targets().length > 0 && setState({ phase: "confirm" }),
    cancel: () => setState({ phase: "idle" }),
    async run() {
      const targets = options.targets();
      if (state().phase !== "confirm" || targets.length === 0) return;
      setState({ phase: "deleting", done: 0, total: targets.length });
      const res = await options.remove(targets, { onProgress: (p) => setState({ phase: "deleting", ...p }) });
      setState({ phase: "idle" });
      options.onDone({ removed: res.filter((r) => r.ok).map((r) => r.item), errors: res.flatMap((r) => (r.ok ? [] : [r.error])) });
    },
  };
}

export type BulkDelete<T extends { id: number }> = ReturnType<typeof createBulkDelete<T>>;

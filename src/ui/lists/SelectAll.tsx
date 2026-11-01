import { createEffect, createMemo } from "solid-js";

/** 見えている行をまとめて選ぶチェックボックス。一部だけ選ばれていれば中間の状態を出す */
export function SelectAll(props: { total: number; selected: number; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const all = createMemo(() => props.total > 0 && props.selected === props.total);
  const some = createMemo(() => props.selected > 0 && !all());
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      checked={all()}
      disabled={props.disabled}
      ref={(el) => createEffect(() => (el.indeterminate = some()))}
      onChange={(e) => props.onChange(e.currentTarget.checked)}
    />
  );
}

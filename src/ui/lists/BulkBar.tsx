import type { JSX } from "solid-js";
import { Show } from "solid-js";

/** 選択中の件数や確認・結果を出す帯。tone で色を変える（確認は danger、失敗は warn） */
export function BulkBar(props: {
  tone: "info" | "danger" | "warn";
  label: string;
  text: JSX.Element;
  actions?: JSX.Element;
  detail?: JSX.Element;
}) {
  return (
    <div class="bulkbar" classList={{ "bulkbar--danger": props.tone === "danger", "bulkbar--warn": props.tone === "warn" }} role="region" aria-label={props.label}>
      <span class="bulkbar__text" role="status">
        {props.text}
      </span>
      <Show when={props.actions}>
        <div class="bulkbar__actions">{props.actions}</div>
      </Show>
      <Show when={props.detail}>
        <div class="bulkbar__detail">{props.detail}</div>
      </Show>
    </div>
  );
}

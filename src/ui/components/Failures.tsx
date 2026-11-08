import { For, Show, type JSX } from "solid-js";
import type { GitHubOperation } from "../../integrations/github/permissions";
import { useUi } from "../app/context";
import { errorText, ssoUrlOf } from "../errors";
import { Icon } from "./Icon";
import { PermissionHint } from "./PermissionHint";

export interface FailureItem {
  key: string;
  label: string;
  error: unknown;
}

/** 読み込めなかったリポジトリ・所有者の一覧。理由ごとの対処も示す */
/** hint を渡すと、operation から作る権限の案内の代わりに、項目ごとの案内を出す */
export function Failures(props: { title: string; items: FailureItem[]; operation?: GitHubOperation; hint?: (item: FailureItem) => JSX.Element }) {
  const { i18n } = useUi();
  return (
    <Show when={props.items.length > 0}>
      <details class="failures">
        <summary>
          <Icon name="warning" />
          {props.title}
        </summary>
        <ul>
          <For each={props.items}>
            {(item) => (
              <li>
                <span class="mono">{item.label}</span>
                <span class="failures__reason">{errorText(i18n.t, item.error)}</span>
                <Show when={ssoUrlOf(item.error)}>
                  {(url) => (
                    <a href={url()} target="_blank" rel="noreferrer">
                      {i18n.t("error.sso_link")}
                    </a>
                  )}
                </Show>
                <Show when={props.hint} fallback={<Show when={props.operation}>{(op) => <PermissionHint error={item.error} operation={op()} />}</Show>}>
                  {(hint) => hint()(item)}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </details>
    </Show>
  );
}

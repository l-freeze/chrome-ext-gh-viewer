import { For, Show } from "solid-js";
import type { GitHubApiError } from "../../api/errors";
import { errorText } from "../errors";
import { useDeps } from "../state/context";
import { Icon } from "./Icon";

export interface FailureItem {
  key: string;
  label: string;
  error: GitHubApiError;
}

/** 読み込めなかったリポジトリ・所有者の一覧。理由ごとの対処も示す */
export function Failures(props: { title: string; items: FailureItem[] }) {
  const { i18n } = useDeps();
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
                <Show when={item.error.ssoUrl}>
                  {(url) => (
                    <a href={url()} target="_blank" rel="noreferrer">
                      {i18n.t("error.sso_link")}
                    </a>
                  )}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </details>
    </Show>
  );
}

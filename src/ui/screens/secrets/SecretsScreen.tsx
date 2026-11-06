import { For, Show } from "solid-js";
import { useUi } from "../../app/context";
import { Failures } from "../../components/Failures";
import { formatDate } from "../../format";
import "./secrets.css";
import type { SecretsState } from "./state";

/** Secrets と Variables の一覧（閲覧のみ。変更は GitHub で行う） */
export function SecretsScreen(props: { state: SecretsState }) {
  const { i18n } = useUi();
  const { t } = i18n;
  const s = props.state;

  return (
    <div class="secrets">
      <div class="filters" role="search">
        <div class="segmented" role="radiogroup" aria-label={t("secrets.filter.kind")}>
          <For each={["all", "secret", "variable"] as const}>
            {(kind) => (
              <button type="button" role="radio" aria-checked={s.kind() === kind} onClick={() => s.setKind(kind)}>
                {t(`secrets.filter.${kind}`)}
              </button>
            )}
          </For>
        </div>
        <label class="field field--grow">
          <span class="field__label">{t("secrets.filter.text")}</span>
          <input
            type="search"
            value={s.text()}
            placeholder={t("secrets.filter.textPlaceholder")}
            onInput={(e) => s.setText(e.currentTarget.value)}
          />
        </label>
        <p class="secrets__count" role="status">
          <strong>{t("secrets.count", { count: s.count() })}</strong>{" "}
          <span class="muted">{t("issues.inRepos", { count: s.groups().length })}</span>
        </p>
      </div>
      <p class="muted small secrets__note">{t("secrets.readOnly")}</p>

      <Failures
        title={t("failures.title", { count: s.results.failures().length })}
        items={s.results.failures().map((f) => ({ key: f.repo.fullName, label: f.repo.fullName, error: f.error }))}
        operation="secrets.list"
      />

      <div class="table-wrap">
        <table class="table table--secrets">
          <thead>
            <tr>
              <th>{t("secrets.col.name")}</th>
              <th>{t("secrets.col.kind")}</th>
              <th>{t("secrets.col.scope")}</th>
              <th>{t("secrets.col.value")}</th>
              <th>{t("secrets.col.updated")}</th>
            </tr>
          </thead>
          <For each={s.groups()}>
            {(group) => (
              <tbody>
                <tr class="group-row">
                  <th colspan="5" scope="rowgroup">
                    <a href={`${group.repo.htmlUrl}/settings/secrets/actions`} target="_blank" rel="noreferrer">
                      <span class="muted">{group.repo.owner.login}/</span>
                      {group.repo.name}
                    </a>
                    <span class="group-row__count">{i18n.number(group.items.length)}</span>
                  </th>
                </tr>
                <For each={group.items}>
                  {(item) => (
                    <tr>
                      <td class="mono cell-secret-name">{item.name}</td>
                      <td>
                        <span class="badge" classList={{ "badge--secret": item.kind === "secret" }}>
                          {t(`secrets.kind.${item.kind}`)}
                        </span>
                      </td>
                      <td>
                        <Show when={item.environment} fallback={<span class="muted">{t("secrets.scope.repository")}</span>}>
                          {(env) => <span class="env">{env()}</span>}
                        </Show>
                      </td>
                      <td class="cell-secret-value">
                        <Show when={item.value !== null} fallback={<span class="muted" title={t("secrets.hiddenReason")}>{t("secrets.hidden")}</span>}>
                          <code class="mono" title={item.value ?? ""}>
                            {item.value}
                          </code>
                        </Show>
                      </td>
                      <td class="num-date">{formatDate(item.updatedAt)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            )}
          </For>
        </table>
        <Show when={!s.results.progress() && s.groups().length === 0}>
          <p class="empty">{t("secrets.empty")}</p>
        </Show>
      </div>
    </div>
  );
}

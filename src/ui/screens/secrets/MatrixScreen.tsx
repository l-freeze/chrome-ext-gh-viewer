import { For, Show } from "solid-js";
import type { ItemKind } from "../../../features/secrets/item";
import type { MatrixCell, MatrixRow } from "../../../features/secrets/matrix";
import { useUi } from "../../app/context";
import { Failures } from "../../components/Failures";
import { Icon } from "../../components/Icon";
import { formatDate } from "../../format";
import type { SecretsMatrixState } from "./matrix-state";
import "./matrix.css";

const settingsUrl = (repo: { owner: string; name: string }) => `https://github.com/${repo.owner}/${repo.name}/settings/secrets/actions`;

/** Secrets と Variables の比較表（閲覧のみ）。行は名前、列はリポジトリと Environment */
export function MatrixScreen(props: { state: SecretsMatrixState }) {
  const { i18n } = useUi();
  const { t } = i18n;
  const s = props.state;
  const kindRows = (kind: ItemKind) => s.rows().filter((r) => r.kind === kind);
  const total = () => s.matrix().columns.length;

  const cellTitle = (cell: MatrixCell) => {
    const item = cell.item;
    if (cell.state === "missing" || !item) return t("secretsMatrix.state.missing");
    const parts = [cell.state === "inherited" ? t("secretsMatrix.cell.inherited") : t("secretsMatrix.state.set")];
    if (item.value !== null) parts.push(item.value);
    parts.push(t("secretsMatrix.cell.updated", { date: formatDate(item.updatedAt) ?? "" }));
    return parts.join("\n");
  };

  const Mark = (p: { state: MatrixCell["state"] }) => (
    <>
      <Show when={p.state === "set"}>
        <Icon name="check" size={14} />
      </Show>
      <Show when={p.state === "inherited"}>
        <span aria-hidden="true">↑</span>
      </Show>
      <Show when={p.state === "missing"}>
        <span aria-hidden="true">–</span>
      </Show>
    </>
  );

  const Row = (p: { row: MatrixRow }) => (
    <tr classList={{ "matrix__row--gap": p.row.hasGap }}>
      <th scope="row" class="mono matrix__name">
        {p.row.name}
      </th>
      <td class="num matrix__coverage">{t("secretsMatrix.coverage", { covered: p.row.covered, total: total() })}</td>
      <For each={p.row.cells}>
        {(cell) => (
          <td class={`matrix__cell matrix__cell--${cell.state}`} title={cellTitle(cell)}>
            <Mark state={cell.state} />
            <span class="visually-hidden">{t(`secretsMatrix.state.${cell.state}`)}</span>
          </td>
        )}
      </For>
    </tr>
  );

  return (
    <div class="secrets-matrix">
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
          <span class="field__label">{t("secretsMatrix.filter.text")}</span>
          <input
            type="search"
            value={s.text()}
            placeholder={t("secretsMatrix.filter.textPlaceholder")}
            onInput={(e) => s.setText(e.currentTarget.value)}
          />
        </label>
        <label class="matrix__toggle">
          <input type="checkbox" checked={s.gapsOnly()} onChange={(e) => s.setGapsOnly(e.currentTarget.checked)} />
          {t("secretsMatrix.gapsOnly")}
        </label>
        <p class="matrix__count" role="status">
          <strong>{t("secretsMatrix.count", { count: s.rows().length })}</strong>{" "}
          <span class="muted">{t("secretsMatrix.gaps", { count: s.gapCount() })}</span>
        </p>
      </div>
      <p class="muted small matrix__note">{t("secretsMatrix.note")}</p>
      <ul class="matrix__legend small" aria-label={t("secretsMatrix.legend")}>
        <For each={["set", "inherited", "missing"] as const}>
          {(state) => (
            <li>
              <span class={`matrix__swatch matrix__cell--${state}`} aria-hidden="true">
                <Mark state={state} />
              </span>
              {t(`secretsMatrix.state.${state}`)}
            </li>
          )}
        </For>
      </ul>

      <Failures
        title={t("failures.title", { count: s.results.failures().length })}
        items={s.results.failures().map((f) => ({ key: f.repo.fullName, label: f.repo.fullName, error: f.error }))}
        operation="secrets.list"
      />

      <Show when={s.rows().length > 0}>
        <div class="table-wrap matrix__wrap">
          <table class="table table--matrix">
            <thead>
              <tr>
                <th rowspan="2" scope="col" class="matrix__name">
                  {t("secretsMatrix.col.name")}
                </th>
                <th rowspan="2" scope="col" class="num">
                  {t("secretsMatrix.col.coverage")}
                </th>
                <For each={s.matrix().groups}>
                  {(group) => (
                    <th colspan={group.columns.length} scope="colgroup" class="matrix__repo">
                      <a href={settingsUrl(group.repo)} target="_blank" rel="noreferrer">
                        <span class="muted">{group.repo.owner}/</span>
                        {group.repo.name}
                      </a>
                    </th>
                  )}
                </For>
              </tr>
              <tr>
                <For each={s.matrix().columns}>
                  {(column) => (
                    <th scope="col" class="matrix__scope" classList={{ "matrix__scope--repo": column.environment === null }}>
                      <Show when={column.environment} fallback={<span class="muted">{t("secrets.scope.repository")}</span>}>
                        {(env) => <span class="env">{env()}</span>}
                      </Show>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <For each={(["secret", "variable"] as const).filter((k) => kindRows(k).length > 0)}>
              {(kind) => (
                <tbody>
                  <tr class="group-row">
                    <th colspan={2 + total()} scope="rowgroup">
                      <span class="matrix__group-label">
                        {t(`secrets.filter.${kind}`)}
                        <span class="group-row__count">{i18n.number(kindRows(kind).length)}</span>
                      </span>
                    </th>
                  </tr>
                  <For each={kindRows(kind)}>{(row) => <Row row={row} />}</For>
                </tbody>
              )}
            </For>
          </table>
        </div>
      </Show>
      <Show when={!s.results.progress() && s.rows().length === 0}>
        <div class="table-wrap">
          <p class="empty">{t("secrets.empty")}</p>
        </div>
      </Show>
    </div>
  );
}

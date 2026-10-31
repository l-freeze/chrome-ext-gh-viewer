import { For, Show } from "solid-js";
import { formatDate, labelTextColor } from "../../domain/format";
import { Avatar } from "../components/Avatar";
import { Failures } from "../components/Failures";
import { Icon } from "../components/Icon";
import { useDeps } from "../state/context";
import type { IssuesState } from "../state/issues";

export function IssuesView(props: { state: IssuesState }) {
  const { i18n } = useDeps();
  const { t } = i18n;
  const s = props.state;

  return (
    <div class="issues">
      <div class="filters" role="search">
        <div class="segmented" role="radiogroup" aria-label={t("issues.filter.state")}>
          <For each={["open", "closed", "all"] as const}>
            {(state) => (
              <button
                type="button"
                role="radio"
                aria-checked={s.stateFilter() === state}
                onClick={() => s.setStateFilter(state)}
              >
                {t(`issues.filter.${state}`)}
              </button>
            )}
          </For>
        </div>
        <label class="field field--grow">
          <span class="field__label">{t("issues.filter.text")}</span>
          <input
            type="search"
            value={s.text()}
            placeholder={t("issues.filter.textPlaceholder")}
            onInput={(e) => s.setText(e.currentTarget.value)}
          />
        </label>
        <p class="issues__count" role="status">
          <strong>{t("issues.count", { count: s.filtered().length })}</strong>{" "}
          <span class="muted">{t("issues.inRepos", { count: s.groups().length })}</span>
        </p>
      </div>

      <Failures
        title={t("failures.ownersTitle", { count: s.failures().length })}
        items={s.failures().map((f) => ({ key: f.owner.login, label: f.owner.login, error: f.error! }))}
        operation="issues.search"
      />
      <Show when={s.truncatedOwners().length > 0}>
        <p class="notice">
          <Icon name="warning" />
          {t("issues.truncated", { owners: s.truncatedOwners().join(", ") })}
        </p>
      </Show>

      <div class="table-wrap">
        <table class="table table--issues">
          <thead>
            <tr>
              <th>{t("issues.col.title")}</th>
              <th>{t("issues.col.labels")}</th>
              <th>{t("issues.col.assignees")}</th>
              <th>{t("issues.col.updated")}</th>
            </tr>
          </thead>
          <For each={s.groups()}>
            {(group) => (
              <tbody>
                <tr class="group-row">
                  <th colspan="4" scope="rowgroup">
                    <a href={`https://github.com/${group.key}/issues`} target="_blank" rel="noreferrer">
                      <span class="muted">{group.repo.owner}/</span>
                      {group.repo.name}
                    </a>
                    <span class="group-row__count">{i18n.number(group.issues.length)}</span>
                  </th>
                </tr>
                <For each={group.issues}>
                  {(issue) => (
                    <tr classList={{ "row--closed": issue.state === "closed" }}>
                      <td class="cell-title">
                        <span class={`state-dot state-dot--${issue.state}`} title={issue.state} />
                        <a href={issue.htmlUrl} target="_blank" rel="noreferrer">
                          {issue.title}
                        </a>
                        <span class="muted small">
                          {" "}
                          #{issue.number} ·{" "}
                          {t("issues.opened", {
                            date: formatDate(issue.createdAt) ?? "",
                            author: issue.author?.login ?? "ghost",
                          })}
                          <Show when={issue.comments > 0}>
                            {" · "}
                            {t("issues.comments", { count: issue.comments })}
                          </Show>
                        </span>
                      </td>
                      <td class="cell-labels">
                        <For each={issue.labels}>
                          {(label) => (
                            <span
                              class="label"
                              title={label.description ?? undefined}
                              style={
                                label.color
                                  ? { background: `#${label.color}`, color: labelTextColor(label.color) }
                                  : undefined
                              }
                            >
                              {label.name}
                            </span>
                          )}
                        </For>
                      </td>
                      <td class="cell-assignees">
                        <For each={issue.assignees}>
                          {(a) => (
                            <span title={a.login}>
                              <Avatar src={a.avatarUrl} login={a.login} size={20} />
                            </span>
                          )}
                        </For>
                      </td>
                      <td class="num-date">{formatDate(issue.updatedAt)}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            )}
          </For>
        </table>
        <Show when={!s.progress() && s.groups().length === 0}>
          <p class="empty">{t("issues.empty")}</p>
        </Show>
      </div>
    </div>
  );
}


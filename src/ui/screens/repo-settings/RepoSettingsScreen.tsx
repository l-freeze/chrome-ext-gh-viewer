import { For, Show } from "solid-js";
import type { SettingColumn } from "../../../features/repo-settings/comparison";
import { differsFromMajority } from "../../../features/repo-settings/comparison";
import { SETTINGS, type SettingGroup, type SettingKey, type SettingValue } from "../../../features/repo-settings/settings";
import { repoKey } from "../../../features/workspace/repository";
import { useUi } from "../../app/context";
import { Failures } from "../../components/Failures";
import { Icon } from "../../components/Icon";
import "./repo-settings.css";
import type { RepoSettingsState } from "./state";

const groupOf = (key: SettingKey): SettingGroup => SETTINGS.find((s) => s.key === key)!.group;

/** リポジトリの設定の違いの表（閲覧のみ）。行はリポジトリ、列は設定 */
export function RepoSettingsScreen(props: { state: RepoSettingsState }) {
  const { i18n } = useUi();
  const { t } = i18n;
  const s = props.state;

  /** 見出しの 1 段目: 続いている同じ分類の列をまとめる */
  const groups = () => {
    const out: Array<{ group: SettingGroup; span: number }> = [];
    for (const c of s.columns()) {
      const g = groupOf(c.key);
      const last = out.at(-1);
      if (last && last.group === g) last.span++;
      else out.push({ group: g, span: 1 });
    }
    return out;
  };

  function Value(p: { value: SettingValue; settingKey: SettingKey }) {
    const v = p.value;
    if (v.kind === "unknown")
      return (
        <span class="muted" title={t("repoSettings.unknownReason")}>
          ?<span class="visually-hidden">{t("repoSettings.unknown")}</span>
        </span>
      );
    if (v.kind === "unavailable")
      return (
        <span class="muted small" title={t("repoSettings.unavailableReason")}>
          {t("repoSettings.unavailable")}
        </span>
      );
    if (v.value === true)
      return (
        <span class="repo-settings__on">
          <Icon name="check" size={14} />
          <span class="visually-hidden">{t("repoSettings.on")}</span>
        </span>
      );
    if (v.value === false) return <span class="muted">{t("repoSettings.off")}</span>;
    if (p.settingKey === "requirePullRequest") return <span>{t("repoSettings.approvals", { count: v.value as number })}</span>;
    if (p.settingKey === "visibility" && (v.value === "public" || v.value === "private" || v.value === "internal"))
      return <span>{t(`repoSettings.visibility.${v.value}`)}</span>;
    return <span class="mono">{String(v.value)}</span>;
  }

  const Cell = (p: { value: SettingValue; column: SettingColumn }) => (
    <td class="repo-settings__cell" classList={{ "repo-settings__cell--differs": differsFromMajority(p.value, p.column) }}>
      <Value value={p.value} settingKey={p.column.key} />
    </td>
  );

  return (
    <div class="repo-settings">
      <div class="filters" role="search">
        <label class="field field--grow">
          <span class="field__label">{t("repoSettings.filter.text")}</span>
          <input type="search" value={s.text()} placeholder={t("repoSettings.filter.textPlaceholder")} onInput={(e) => s.setText(e.currentTarget.value)} />
        </label>
        <label class="repo-settings__option">
          <input type="checkbox" checked={s.diffOnly()} onChange={(e) => s.setDiffOnly(e.currentTarget.checked)} />
          {t("repoSettings.diffOnly")}
        </label>
        <p class="repo-settings__count" role="status">
          <strong>{t("repoSettings.count", { count: s.rows().length })}</strong>{" "}
          <span class="muted">{t("repoSettings.differing", { settings: s.differingSettings(), repos: s.differingRepos() })}</span>
        </p>
      </div>
      <p class="muted small repo-settings__note">{t("repoSettings.note")}</p>

      <Failures
        title={t("failures.title", { count: s.results.failures().length })}
        items={s.results.failures().map((f) => ({ key: f.repo.fullName, label: f.repo.fullName, error: f.error }))}
        operation="repoSettings.read"
      />

      <Show when={s.rows().length > 0 && s.columns().length > 0}>
        <div class="table-wrap repo-settings__wrap">
          <table class="table table--repo-settings">
            <thead>
              <tr>
                <th rowspan="2" scope="col" class="repo-settings__repo">
                  {t("repoSettings.col.repo")}
                </th>
                <For each={groups()}>
                  {(g) => (
                    <th colspan={g.span} scope="colgroup" class="repo-settings__group">
                      {t(`repoSettings.group.${g.group}`)}
                    </th>
                  )}
                </For>
              </tr>
              <tr>
                <For each={s.columns()}>
                  {(c) => (
                    <th scope="col" class="repo-settings__setting" title={t(`repoSettings.setting.${c.key}.full`)}>
                      {t(`repoSettings.setting.${c.key}`)}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <tr class="repo-settings__majority">
                <th scope="row" class="repo-settings__repo">
                  {t("repoSettings.majority")}
                </th>
                <For each={s.columns()}>
                  {(c) => (
                    <td class="repo-settings__cell">
                      <Show when={c.majority} fallback={<span class="muted">?</span>}>
                        {(m) => <Value value={m()} settingKey={c.key} />}
                      </Show>
                    </td>
                  )}
                </For>
              </tr>
              <For each={s.rows()}>
                {(row) => (
                  <tr>
                    <th scope="row" class="repo-settings__repo">
                      <a href={`https://github.com/${repoKey(row.repo)}/settings`} target="_blank" rel="noreferrer">
                        <span class="muted">{row.repo.owner}/</span>
                        {row.repo.name}
                      </a>
                    </th>
                    <For each={s.columns()}>{(c) => <Cell value={row.values[c.key]} column={c} />}</For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
      <Show when={!s.results.progress() && (s.rows().length === 0 || s.columns().length === 0)}>
        <div class="table-wrap">
          <p class="empty">{s.rows().length > 0 ? t("repoSettings.allSame") : t("repoSettings.empty")}</p>
        </div>
      </Show>
    </div>
  );
}

import { For, Show } from "solid-js";
import { useUi } from "../../app/context";
import { Avatar } from "../../components/Avatar";
import { Failures } from "../../components/Failures";
import { Icon } from "../../components/Icon";
import { downloadFailureText, errorText } from "../../errors";
import { formatBytes, formatDate } from "../../format";
import "./releases.css";
import type { ReleaseNotice, ReleasesState } from "./state";

/** Release の一覧と、添付ファイルのダウンロード（閲覧とダウンロードのみ） */
export function ReleasesScreen(props: { state: ReleasesState }) {
  const { i18n } = useUi();
  const { t } = i18n;
  const s = props.state;

  const noticeText = (n: ReleaseNotice) => {
    switch (n.kind) {
      case "downloadStarted":
        return t("releases.downloadStarted", { name: n.name });
      case "downloadFailed":
        return t("releases.downloadFailed", { name: n.name, reason: downloadFailureText(t, n.reason) });
      case "error":
        return errorText(t, n.error);
    }
  };

  return (
    <div class="releases">
      <div class="filters" role="search">
        <div class="segmented" role="radiogroup" aria-label={t("releases.filter.kind")}>
          <For each={["all", "release", "prerelease"] as const}>
            {(kind) => (
              <button type="button" role="radio" aria-checked={s.kind() === kind} onClick={() => s.setKind(kind)}>
                {t(`releases.filter.${kind}`)}
              </button>
            )}
          </For>
        </div>
        <label class="field field--grow">
          <span class="field__label">{t("releases.filter.text")}</span>
          <input
            type="search"
            value={s.text()}
            placeholder={t("releases.filter.textPlaceholder")}
            onInput={(e) => s.setText(e.currentTarget.value)}
          />
        </label>
        <p class="releases__count" role="status">
          <strong>{t("releases.count", { count: s.count() })}</strong>{" "}
          <span class="muted">{t("issues.inRepos", { count: s.groups().length })}</span>
        </p>
      </div>

      <Show when={s.notice()}>
        {(n) => (
          <div class="notice" classList={{ "notice--info": n().kind === "downloadStarted" }} role="status">
            <span>{noticeText(n())}</span>
            <button type="button" class="button button--ghost" onClick={() => s.dismissNotice()}>
              {t("action.close")}
            </button>
          </div>
        )}
      </Show>

      <Failures
        title={t("failures.title", { count: s.results.failures().length })}
        items={s.results.failures().map((f) => ({ key: f.repo.fullName, label: f.repo.fullName, error: f.error }))}
        operation="releases.list"
      />

      <div class="table-wrap">
        <table class="table table--releases">
          <thead>
            <tr>
              <th>{t("releases.col.release")}</th>
              <th>{t("releases.col.date")}</th>
              <th>{t("releases.col.assets")}</th>
            </tr>
          </thead>
          <For each={s.groups()}>
            {(group) => (
              <tbody>
                <tr class="group-row">
                  <th colspan="3" scope="rowgroup">
                    <a href={`${group.repo.htmlUrl}/releases`} target="_blank" rel="noreferrer">
                      <span class="muted">{group.repo.owner.login}/</span>
                      {group.repo.name}
                    </a>
                    <span class="group-row__count">{i18n.number(group.releases.length)}</span>
                  </th>
                </tr>
                <For each={group.releases}>
                  {(release) => (
                    <tr>
                      <td class="cell-release">
                        <a href={release.htmlUrl} target="_blank" rel="noreferrer" class="release__title">
                          {release.title}
                        </a>
                        <div class="release__meta small">
                          <span class="mono">{release.tag}</span>
                          <Show when={release.prerelease}>
                            <span class="badge badge--warn">{t("releases.prerelease")}</span>
                          </Show>
                          <Show when={release.draft}>
                            <span class="badge">{t("releases.draft")}</span>
                          </Show>
                          <Show when={release.author}>
                            {(a) => (
                              <span class="release__author" title={a().login}>
                                <Avatar src={a().avatarUrl} login={a().login} size={16} />
                                {a().login}
                              </span>
                            )}
                          </Show>
                        </div>
                      </td>
                      <td class="num-date">{formatDate(release.date)}</td>
                      <td class="cell-assets">
                        <Show when={release.assets.length > 0} fallback={<span class="muted small">{t("releases.noAssets")}</span>}>
                          <ul class="assets">
                            <For each={release.assets}>
                              {(asset) => (
                                <li>
                                  <button
                                    type="button"
                                    class="asset"
                                    onClick={() => void s.download(asset)}
                                    aria-label={t("releases.download", { name: asset.name })}
                                  >
                                    <Icon name="download" size={14} />
                                    <span class="asset__name">{asset.name}</span>
                                    <span class="asset__meta">
                                      {formatBytes(asset.sizeInBytes, i18n.number)} · {t("releases.downloads", { count: asset.downloadCount })}
                                    </span>
                                  </button>
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            )}
          </For>
        </table>
        <Show when={!s.results.progress() && s.groups().length === 0}>
          <p class="empty">{t("releases.empty")}</p>
        </Show>
      </div>
    </div>
  );
}

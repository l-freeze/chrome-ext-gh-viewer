import { For, Show } from "solid-js";
import { formatBytes } from "../domain/format";
import { Avatar } from "./components/Avatar";
import { Icon } from "./components/Icon";
import type { ArtifactsState } from "./state/artifacts";
import { useDeps } from "./state/context";
import type { IssuesState } from "./state/issues";
import type { WorkspaceState } from "./state/workspace";

export type Route = "artifacts" | "issues" | "settings";

export function Header(props: {
  route: Route;
  ws: WorkspaceState;
  artifacts: ArtifactsState;
  issues: IssuesState;
  connected: boolean;
}) {
  const { i18n } = useDeps();
  const { t } = i18n;
  const bytes = (n: number) => formatBytes(n, i18n.number);

  const progress = () => {
    if (props.ws.loading()) return { label: t("loading.repos"), ratio: null };
    const p = props.route === "issues" ? props.issues.progress() : props.artifacts.progress();
    if (!p) return null;
    return {
      label:
        props.route === "issues"
          ? t("loading.issues", { done: p.done, total: p.total })
          : t("loading.progress", { done: p.done, total: p.total }),
      ratio: p.total === 0 ? 1 : p.done / p.total,
    };
  };

  const refresh = () => {
    if (props.route === "issues") props.issues.refresh();
    else props.artifacts.refresh();
  };

  return (
    <header class="band">
      <div class="band__row">
        <a class="brand" href="#artifacts">
          <Icon name="box" size={18} />
          <span>{t("app.title")}</span>
        </a>
        <nav class="tabs" aria-label="Views">
          <a class="tab" href="#artifacts" aria-current={props.route === "artifacts" ? "page" : undefined}>
            {t("tab.artifacts")}
            <Show when={props.connected}>
              <span class="tab__count">{i18n.number(props.artifacts.artifacts().length)}</span>
            </Show>
          </a>
          <a class="tab" href="#issues" aria-current={props.route === "issues" ? "page" : undefined}>
            {t("tab.issues")}
            <Show when={props.connected && props.issues.issues().length > 0}>
              <span class="tab__count">{i18n.number(props.issues.issues().length)}</span>
            </Show>
          </a>
        </nav>
        <div class="band__spacer" />
        <Show when={props.route === "artifacts" && props.artifacts.summary().liveBytes > 0}>
          <div class="meter" title={t("artifacts.kpi.stored")}>
            <span>
              <strong>{bytes(props.artifacts.selectionSummary().bytes)}</strong>
              {" / "}
              {bytes(props.artifacts.summary().liveBytes)}
            </span>
            <span class="meter__track">
              <span
                class="meter__fill"
                style={{
                  width: `${Math.min(100, (props.artifacts.selectionSummary().bytes / props.artifacts.summary().liveBytes) * 100)}%`,
                }}
              />
            </span>
          </div>
        </Show>
        <Show when={props.connected && props.route !== "settings"}>
          <button class="band__button" type="button" onClick={refresh} title={t("action.refresh")}>
            <Icon name="refresh" label={t("action.refresh")} />
          </button>
        </Show>
        <a
          class="band__button"
          href="#settings"
          aria-current={props.route === "settings" ? "page" : undefined}
          title={t("tab.settings")}
        >
          <Icon name="gear" label={t("tab.settings")} />
        </a>
      </div>

      <Show when={props.connected && props.route !== "settings"}>
        <div class="band__row band__row--owners">
          <span class="band__label">{t("owners.label")}</span>
          <div class="owners">
            <For each={props.ws.owners()}>
              {(entry) => (
                <button
                  type="button"
                  class="owner"
                  aria-pressed={props.ws.isOwnerSelected(entry.owner.login)}
                  onClick={() => props.ws.toggleOwner(entry.owner.login)}
                  title={`${entry.owner.login} · ${entry.owner.type === "Organization" ? t("owners.organization") : t("owners.personal")} · ${t("owners.repoCount", { count: entry.repoCount })}`}
                >
                  <span class="owner__check" aria-hidden="true">
                    <Icon name="check" size={12} />
                  </span>
                  <Avatar src={entry.owner.avatarUrl} login={entry.owner.login} size={18} />
                  <span>{entry.owner.login}</span>
                  <span class="owner__count">{i18n.number(entry.repoCount)}</span>
                </button>
              )}
            </For>
          </div>
          <div class="band__spacer" />
          <Show when={progress()}>
            {(p) => (
              <div class="loading" role="status">
                <span>{p().label}</span>
                <Show when={p().ratio !== null}>
                  <span class="meter__track meter__track--thin">
                    <span class="meter__fill meter__fill--plain" style={{ width: `${(p().ratio ?? 0) * 100}%` }} />
                  </span>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </header>
  );
}

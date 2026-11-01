import { createSignal, For, Show, type Accessor } from "solid-js";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { formatBytes } from "../format";
import { useUi } from "./context";
import type { WorkspaceState } from "./workspace";
import "./header.css";

export type Route = "artifacts" | "caches" | "actions" | "issues" | "kanban" | "settings";

/** URL の # 以降と画面の対応。Issue タブは一覧（#issues・#issues/list）とカンバン（#issues/kanban）に分かれる */
export const ROUTE_HASH: Record<Route, string> = {
  artifacts: "artifacts",
  caches: "caches",
  actions: "actions",
  issues: "issues",
  kanban: "issues/kanban",
  settings: "settings",
};

export function routeOf(hash: string): Route {
  const h = hash.replace(/^#/, "");
  if (h === "issues/list") return "issues";
  const found = (Object.keys(ROUTE_HASH) as Route[]).find((r) => ROUTE_HASH[r] === h);
  return found ?? "artifacts";
}

/** 各タブの件数。0 のときは出さない（アーティファクトだけは 0 でも出す） */
export interface TabCounts {
  artifacts: Accessor<number>;
  caches: Accessor<number>;
  actions: Accessor<number>;
  issues: Accessor<number>;
}

const PROGRESS_LABEL = { repos: "loading.progress", owners: "loading.issues", projects: "loading.projects" } as const;

export function Header(props: {
  route: Route;
  ws: WorkspaceState;
  connected: boolean;
  counts: TabCounts;
  /** 今のタブの読み込みの進み具合 */
  progress: { done: number; total: number } | null;
  progressKind: "repos" | "owners" | "projects";
  onRefresh: () => void;
  /** 自動更新に対応した画面でだけ渡す。minutes は取り直す間隔 */
  autoRefresh: { enabled: boolean; minutes: number; onToggle: () => void } | null;
  /** アーティファクトタブの、選択中の容量と保存量 */
  meter: { selected: number; total: number } | null;
}) {
  const { i18n } = useUi();
  const { t } = i18n;
  const bytes = (n: number) => formatBytes(n, i18n.number);

  const progress = () => {
    if (props.ws.loading()) return { label: t("loading.repos"), ratio: null };
    const p = props.progress;
    if (!p) return null;
    return {
      label: t(PROGRESS_LABEL[props.progressKind], { done: p.done, total: p.total }),
      ratio: p.total === 0 ? 1 : p.done / p.total,
    };
  };

  const tab = (route: Exclude<Route, "settings" | "kanban">, label: string, count: Accessor<number>, showZero = false, current = props.route === route) => (
    <a class="tab" href={`#${ROUTE_HASH[route]}`} aria-current={current ? "page" : undefined}>
      {label}
      <Show when={props.connected && (showZero || count() > 0)}>
        <span class="tab__count">{i18n.number(count())}</span>
      </Show>
    </a>
  );

  // Issue タブ: マウスを合わせるかフォーカスすると、文字の下に「一覧」と「カンバン」を出す。
  // タブの並びは狭い幅で横にスクロールするため、メニューは position: fixed でタブの真下に置く
  const [menuAt, setMenuAt] = createSignal<{ left: number; top: number }>({ left: 0, top: 0 });
  const placeMenu = (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenuAt({ left: r.left, top: r.bottom });
  };
  const issuesTab = () => (
    <div class="tab-menu" onPointerEnter={placeMenu} onFocusIn={placeMenu}>
      {tab("issues", t("tab.issues"), props.counts.issues, false, props.route === "issues" || props.route === "kanban")}
      <ul class="tab-menu__list" style={{ left: `${menuAt().left}px`, top: `${menuAt().top}px` }} aria-label={t("tab.issues")}>
        <li>
          <a href="#issues/list" aria-current={props.route === "issues" ? "page" : undefined}>
            {t("tab.issues.list")}
          </a>
        </li>
        <li>
          <a href={`#${ROUTE_HASH.kanban}`} aria-current={props.route === "kanban" ? "page" : undefined}>
            {t("tab.issues.kanban")}
          </a>
        </li>
      </ul>
    </div>
  );

  return (
    <header class="band">
      <div class="band__row">
        <a class="brand" href="#artifacts">
          <Icon name="box" size={18} />
          <span>{t("app.title")}</span>
        </a>
        <nav class="tabs" aria-label="Views">
          {tab("artifacts", t("tab.artifacts"), props.counts.artifacts, true)}
          {tab("caches", t("tab.caches"), props.counts.caches)}
          {tab("actions", t("tab.actions"), props.counts.actions)}
          {issuesTab()}
        </nav>
        <div class="band__spacer" />
        <Show when={props.meter}>
          {(m) => (
            <div class="meter" title={t("artifacts.kpi.stored")}>
              <span>
                <strong>{bytes(m().selected)}</strong>
                {" / "}
                {bytes(m().total)}
              </span>
              <span class="meter__track">
                <span class="meter__fill" style={{ width: `${Math.min(100, (m().selected / m().total) * 100)}%` }} />
              </span>
            </div>
          )}
        </Show>
        <Show when={props.connected && props.autoRefresh}>
          {(a) => (
            <button
              type="button"
              class="switch"
              role="switch"
              aria-checked={a().enabled}
              aria-label={t("autoRefresh.label")}
              onClick={() => a().onToggle()}
              title={t("autoRefresh.title", { count: a().minutes })}
            >
              <span class="switch__track" aria-hidden="true">
                <span class="switch__thumb" />
              </span>
              <span class="switch__label">{t("autoRefresh.label")}</span>
            </button>
          )}
        </Show>
        <Show when={props.connected && props.route !== "settings"}>
          <button class="band__button" type="button" onClick={() => props.onRefresh()} title={t("action.refresh")}>
            <Icon name="refresh" label={t("action.refresh")} />
          </button>
        </Show>
        <a class="band__button" href="#settings" aria-current={props.route === "settings" ? "page" : undefined} title={t("tab.settings")}>
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

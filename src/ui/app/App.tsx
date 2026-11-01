import { createSignal, Match, onCleanup, Show, Switch } from "solid-js";
import { Failures } from "../components/Failures";
import { errorText } from "../errors";
import { ActionsScreen } from "../screens/actions/ActionsScreen";
import { createRunCleanupState } from "../screens/actions/cleanup-state";
import { DispatchDialog } from "../screens/actions/DispatchDialog";
import { createDispatchState } from "../screens/actions/dispatch-state";
import { createWorkflowListState } from "../screens/actions/list-state";
import { ArtifactsScreen } from "../screens/artifacts/ArtifactsScreen";
import { createArtifactsState } from "../screens/artifacts/state";
import { CachesScreen } from "../screens/caches/CachesScreen";
import { createCachesState } from "../screens/caches/state";
import { IssuesScreen } from "../screens/issues/IssuesScreen";
import { KanbanScreen } from "../screens/kanban/KanbanScreen";
import { createKanbanState } from "../screens/kanban/state";
import { createIssuesState } from "../screens/issues/state";
import { SettingsScreen } from "../screens/settings/SettingsScreen";
import { createSettingsState } from "../screens/settings/state";
import "./app.css";
import { UiContext, type UiDeps } from "./context";
import { Header, routeOf, type Route } from "./Header";
import { createWorkspaceState } from "./workspace";

const currentRoute = (): Route => routeOf(location.hash);

export function App(props: { deps: UiDeps }) {
  const deps = props.deps;
  const { t } = deps.i18n;
  const [route, setRoute] = createSignal<Route>(currentRoute());
  const onHash = () => setRoute(currentRoute());
  window.addEventListener("hashchange", onHash);
  onCleanup(() => window.removeEventListener("hashchange", onHash));

  const settings = createSettingsState(deps);
  const ws = createWorkspaceState(deps, settings.active);
  const artifacts = createArtifactsState(deps, ws);
  const caches = createCachesState(deps, ws, () => route() === "caches");
  const workflows = createWorkflowListState(deps, ws, () => route() === "actions");
  const dispatch = createDispatchState(deps, (repo) => workflows.reload(repo));
  const cleanup = createRunCleanupState(deps, ws);
  const issues = createIssuesState(deps, ws, () => route() === "issues");
  const kanban = createKanbanState(deps, ws, () => route() === "kanban");
  const connected = () => settings.active().length > 0;

  const current = () => {
    switch (route()) {
      case "caches":
        return { progress: caches.results.progress(), refresh: caches.results.refresh };
      case "actions":
        return { progress: workflows.results.progress(), refresh: workflows.results.refresh };
      case "issues":
        return { progress: issues.progress(), refresh: issues.refresh };
      case "kanban":
        return { progress: kanban.progress(), refresh: kanban.refresh };
      default:
        return { progress: artifacts.results.progress(), refresh: artifacts.results.refresh };
    }
  };

  return (
    <UiContext.Provider value={deps}>
      <Header
        route={route()}
        ws={ws}
        connected={connected()}
        counts={{
          artifacts: () => artifacts.artifacts().length,
          caches: () => caches.caches().length,
          actions: workflows.total,
          issues: () => issues.issues().length,
        }}
        progress={current().progress}
        progressKind={route() === "issues" ? "owners" : route() === "kanban" ? "projects" : "repos"}
        onRefresh={() => current().refresh()}
        meter={
          route() === "artifacts" && artifacts.summary().liveBytes > 0
            ? { selected: artifacts.selectionSummary().bytes, total: artifacts.summary().liveBytes }
            : null
        }
      />
      <main class="main">
        <Show when={settings.ready()}>
          <Switch>
            <Match when={route() === "settings"}>
              <SettingsScreen state={settings} />
            </Match>
            <Match when={!connected()}>
              <section class="onboarding">
                <h1>{t("onboarding.title")}</h1>
                <p>{t("onboarding.body")}</p>
                <a class="button button--primary" href="#settings">
                  {t("onboarding.cta")}
                </a>
              </section>
            </Match>
            <Match when={true}>
              <Show when={ws.error()}>
                {(e) => (
                  <p class="error" role="alert">
                    {errorText(t, e())}
                  </p>
                )}
              </Show>
              <Failures
                title={t("failures.ownersTitle", { count: ws.workspace()?.failures.length ?? 0 })}
                items={(ws.workspace()?.failures ?? []).map((f) => ({ key: f.identity.id, label: f.identity.login, error: f.error }))}
              />
              <Show when={!ws.loading() && ws.workspace() && ws.owners().length === 0}>
                <p class="empty">{t("owners.none")}</p>
              </Show>
              <Switch>
                <Match when={route() === "issues"}>
                  <IssuesScreen state={issues} />
                </Match>
                <Match when={route() === "kanban"}>
                  <KanbanScreen state={kanban} />
                </Match>
                <Match when={route() === "actions"}>
                  <ActionsScreen
                    state={workflows}
                    cleanup={cleanup}
                    repoCount={ws.selectedRepos().length}
                    onRun={(target) => void dispatch.open(target)}
                  />
                </Match>
                <Match when={route() === "caches"}>
                  <CachesScreen state={caches} ws={ws} />
                </Match>
                <Match when={true}>
                  <ArtifactsScreen state={artifacts} ws={ws} />
                </Match>
              </Switch>
            </Match>
          </Switch>
        </Show>
      </main>
      <DispatchDialog state={dispatch} />
    </UiContext.Provider>
  );
}

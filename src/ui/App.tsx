import { createSignal, Match, onCleanup, Show, Switch } from "solid-js";
import { Header, type Route } from "./Header";
import { createArtifactsState } from "./state/artifacts";
import { createAuthState } from "./state/auth";
import { DepsContext, type AppDeps } from "./state/context";
import { createIssuesState } from "./state/issues";
import { createWorkspaceState } from "./state/workspace";
import { ArtifactsView } from "./views/ArtifactsView";
import { IssuesView } from "./views/IssuesView";
import { SettingsView } from "./views/SettingsView";
import { Failures } from "./components/Failures";
import { errorText } from "./errors";
import { GitHubApiError } from "../api/errors";

const ROUTES: readonly Route[] = ["artifacts", "issues", "settings"];

function currentRoute(): Route {
  const hash = location.hash.replace(/^#/, "");
  return (ROUTES as readonly string[]).includes(hash) ? (hash as Route) : "artifacts";
}

export function App(props: { deps: AppDeps }) {
  const deps = props.deps;
  const { t } = deps.i18n;
  const [route, setRoute] = createSignal<Route>(currentRoute());
  const onHash = () => setRoute(currentRoute());
  window.addEventListener("hashchange", onHash);
  onCleanup(() => window.removeEventListener("hashchange", onHash));

  const auth = createAuthState(deps);
  const ws = createWorkspaceState(deps, auth.active);
  const artifacts = createArtifactsState(deps, ws);
  const issues = createIssuesState(deps, ws, () => route() === "issues");
  const connected = () => auth.active().length > 0;

  return (
    <DepsContext.Provider value={deps}>
      <Header route={route()} ws={ws} artifacts={artifacts} issues={issues} connected={connected()} />
      <main class="main">
        <Show when={auth.ready()}>
          <Switch>
            <Match when={route() === "settings"}>
              <SettingsView auth={auth} />
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
                    {e() instanceof GitHubApiError ? errorText(t, e() as GitHubApiError) : String(e())}
                  </p>
                )}
              </Show>
              <Failures
                title={t("failures.ownersTitle", { count: ws.workspace()?.failures.length ?? 0 })}
                items={(ws.workspace()?.failures ?? []).map((f) => ({
                  key: f.credential.id,
                  label: f.credential.login,
                  error: f.error,
                }))}
              />
              <Show when={!ws.loading() && ws.workspace() && ws.owners().length === 0}>
                <p class="empty">{t("owners.none")}</p>
              </Show>
              <Switch>
                <Match when={route() === "issues"}>
                  <IssuesView state={issues} />
                </Match>
                <Match when={true}>
                  <ArtifactsView state={artifacts} ws={ws} />
                </Match>
              </Switch>
            </Match>
          </Switch>
        </Show>
      </main>
    </DepsContext.Provider>
  );
}

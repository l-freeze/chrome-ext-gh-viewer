import { createSignal, For, Match, Show, Switch } from "solid-js";
import { formatDate } from "../../format";
import { maskToken, missingScopes, type Credential } from "../../../features/settings/credential";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { errorText, isUnauthorized } from "../../errors";
import type { SettingsState } from "./state";
import "./settings.css";
import { useUi } from "../../app/context";

const CLASSIC_TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=repo,read:org&description=Artifact%20%26%20Issue%20Manager";
const FINE_GRAINED_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";
const AUTHORIZED_APPS_URL = "https://github.com/settings/applications";

export function SettingsScreen(props: { state: SettingsState }) {
  const deps = useUi();
  const { t } = deps.i18n;
  const auth = props.state;
  const method = () => auth.settings().method;
  const oauthCredential = () => auth.settings().credentials.find((c) => c.source === "oauth");
  const pats = () => auth.settings().credentials.filter((c) => c.source === "pat");

  return (
    <div class="settings">
      <h1>{t("settings.title")}</h1>
      <p class="notice notice--info">{t("settings.privacy")}</p>

      <fieldset class="methods">
        <legend>{t("settings.method")}</legend>
        <label class="method" classList={{ "method--disabled": !auth.oauthAvailable }}>
          <input
            type="radio"
            name="method"
            checked={method() === "oauth"}
            disabled={!auth.oauthAvailable}
            onChange={() => void auth.setMethod("oauth")}
          />
          <span>
            <strong>{t("settings.method.oauth")}</strong>
            <span class="muted small">
              {auth.oauthAvailable ? t("settings.method.oauthNote") : t("settings.oauth.notConfigured")}
            </span>
          </span>
        </label>
        <label class="method">
          <input type="radio" name="method" checked={method() === "pat"} onChange={() => void auth.setMethod("pat")} />
          <span>
            <strong>{t("settings.method.pat")}</strong>
            <span class="muted small">{t("settings.method.patNote")}</span>
          </span>
        </label>
      </fieldset>

      <Show when={method() === "oauth" && auth.oauthAvailable}>
        <section class="panel">
          <Show when={oauthCredential()} fallback={<OAuthSignIn auth={auth} />}>
            {(c) => (
              <div class="credential">
                <Avatar src={c().avatarUrl} login={c().login} size={32} />
                <div class="credential__body">
                  <strong>{t("settings.oauth.signedIn", { login: c().login })}</strong>
                  <ScopeInfo credential={c()} />
                </div>
                <div class="credential__actions">
                  <a class="button button--ghost" href={AUTHORIZED_APPS_URL} target="_blank" rel="noreferrer">
                    {t("settings.oauth.revoke")}
                    <Icon name="external" size={14} />
                  </a>
                  <button type="button" class="button" onClick={() => void auth.remove(c().id)}>
                    {t("settings.oauth.signOut")}
                  </button>
                </div>
              </div>
            )}
          </Show>
        </section>
      </Show>

      <Show when={method() === "pat"}>
        <section class="panel">
          <PatForm auth={auth} />
          <p class="links small">
            <a href={CLASSIC_TOKEN_URL} target="_blank" rel="noreferrer">
              {t("settings.pat.createClassic")} <Icon name="external" size={12} />
            </a>
            <a href={FINE_GRAINED_TOKEN_URL} target="_blank" rel="noreferrer">
              {t("settings.pat.createFineGrained")} <Icon name="external" size={12} />
            </a>
          </p>
          <ul class="credentials">
            <For each={pats()} fallback={<li class="muted">{t("settings.pat.empty")}</li>}>
              {(c) => (
                <li class="credential">
                  <Avatar src={c.avatarUrl} login={c.login} size={28} />
                  <div class="credential__body">
                    <div>
                      <strong>{c.login}</strong> <span class="badge">{t(`settings.pat.kind.${c.kind}`)}</span>{" "}
                      <span class="mono muted">{maskToken(c.token)}</span>
                    </div>
                    <ScopeInfo credential={c} />
                  </div>
                  <button type="button" class="button button--ghost" onClick={() => void auth.remove(c.id)}>
                    {t("settings.pat.remove")}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );

  function ScopeInfo(p: { credential: Credential }) {
    const missing = () => missingScopes(p.credential);
    return (
      <div class="small muted">
        <Show when={p.credential.scopes}>{(scopes) => <span>{t("settings.pat.scopes", { scopes: scopes().join(", ") || "—" })} · </span>}</Show>
        <span>
          {p.credential.expiresAt
            ? t("settings.pat.expires", { date: formatDate(p.credential.expiresAt) ?? "" })
            : t("settings.pat.noExpiry")}
        </span>
        <Show when={missing().length > 0}>
          <div class="warn">
            <Icon name="warning" size={14} /> {t("settings.pat.missingScopes", { scopes: missing().join(", ") })}
          </div>
        </Show>
      </div>
    );
  }

  function OAuthSignIn(p: { auth: SettingsState }) {
    return (
      <Switch>
        <Match when={p.auth.oauth().phase === "waiting" && p.auth.oauth()} keyed>
          {(state) =>
            state.phase === "waiting" && (
              <div class="device">
                <p>{t("settings.oauth.enterCode")}</p>
                <p class="device__code mono" aria-live="polite">{state.code.userCode}</p>
                <div class="device__actions">
                  <a
                    class="button button--primary"
                    href={state.code.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => void deps.copyText(state.code.userCode).catch(() => undefined)}
                  >
                    {t("settings.oauth.copyAndOpen")}
                    <Icon name="external" size={14} />
                  </a>
                  <button type="button" class="button button--ghost" onClick={() => p.auth.cancelOAuth()}>
                    {t("action.cancel")}
                  </button>
                </div>
                <p class="muted small" role="status">{t("settings.oauth.waiting")}</p>
              </div>
            )
          }
        </Match>
        <Match when={true}>
          <div class="device">
            <button
              type="button"
              class="button button--primary"
              disabled={p.auth.oauth().phase === "requesting"}
              onClick={() => void p.auth.startOAuth()}
            >
              {t("settings.oauth.signIn")}
            </button>
            <Show when={p.auth.oauth().phase === "error" && p.auth.oauth()} keyed>
              {(state) => state.phase === "error" && <p class="error" role="alert">{errorText(t, state.error)}</p>}
            </Show>
          </div>
        </Match>
      </Switch>
    );
  }

  function PatForm(p: { auth: SettingsState }) {
    const [value, setValue] = createSignal("");
    const state = () => p.auth.pat();
    return (
      <form
        class="patform"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await p.auth.addPat(value())) setValue("");
        }}
      >
        <label class="field field--grow">
          <span class="field__label">{t("settings.method.pat")}</span>
          <input
            type="password"
            autocomplete="off"
            spellcheck={false}
            placeholder={t("settings.pat.placeholder")}
            value={value()}
            onInput={(e) => setValue(e.currentTarget.value)}
          />
        </label>
        <button type="submit" class="button button--primary" disabled={state().phase === "checking" || !value().trim()}>
          {state().phase === "checking" ? t("settings.pat.checking") : t("settings.pat.add")}
        </button>
        <Show when={state().phase === "error" && state()} keyed>
          {(s) =>
            s.phase === "error" && (
              <p class="error" role="alert">
                {isUnauthorized(s.error) ? t("settings.pat.invalid") : errorText(t, s.error)}
              </p>
            )
          }
        </Show>
      </form>
    );
  }
}

import { For, Match, Show, Switch } from "solid-js";
import { useUi } from "../../app/context";
import { Icon } from "../../components/Icon";
import { PermissionHint } from "../../components/PermissionHint";
import { errorText } from "../../errors";
import { BulkBar } from "../../lists/BulkBar";
import type { RepoSettingsState } from "./state";

const TO_PUBLIC = ["code", "fork", "actions", "rulesets", "activity", "stars", "forks", "history"] as const;
const TO_PRIVATE = ["stars", "forks", "plan", "security"] as const;

/** 行の「変更」で開く欄: 公開範囲（2 段階の確認）と既定のブランチ（1 回の確認） */
export function EditPanel(props: { state: RepoSettingsState }) {
  const { i18n } = useUi();
  const { t } = i18n;
  const s = props.state;
  const label = () => t("repoSettings.edit.label");

  return (
    <Switch>
      <Match when={s.edit()} keyed>
        {(e) => (
          <Switch>
            <Match when={e.phase === "menu" && e}>
              {(m) => {
                const menu = () => (m().phase === "menu" ? (m() as Extract<typeof e, { phase: "menu" }>) : null);
                const visibility = () => s.currentVisibility(e.current);
                const from = () => s.currentBranch(e.current);
                return (
                  <BulkBar
                    tone="info"
                    label={label()}
                    text={<strong>{t("repoSettings.edit.title", { repo: e.repo.fullName })}</strong>}
                    actions={
                      <button type="button" class="button button--ghost" onClick={() => s.close()}>
                        {t("action.close")}
                      </button>
                    }
                    detail={
                      <div class="repo-settings__edit">
                        <p class="muted small">{t("repoSettings.edit.permission")}</p>
                        <div class="repo-settings__edit-row">
                          <span class="repo-settings__edit-name">{t("repoSettings.setting.visibility")}</span>
                          <span>{visibility() ? t(`repoSettings.visibility.${visibility()!}`) : t("repoSettings.unknown")}</span>
                          <Show when={visibility()}>
                            {(v) => (
                              <button type="button" class="button button--danger" onClick={() => s.askVisibility()}>
                                {v() === "public" ? t("repoSettings.edit.makePrivate") : t("repoSettings.edit.makePublic")}
                              </button>
                            )}
                          </Show>
                        </div>
                        <div class="repo-settings__edit-row">
                          <span class="repo-settings__edit-name">{t("repoSettings.setting.defaultBranch")}</span>
                          <Switch>
                            <Match when={menu()?.branches.status === "loading"}>
                              <span class="muted">{t("repoSettings.edit.loadingBranches")}</span>
                            </Match>
                            <Match when={menu()?.branches.status === "failed" && menu()!.branches} keyed>
                              {(b) => (
                                <span class="error">
                                  {t("repoSettings.edit.branchesFailed")} {b.status === "failed" ? errorText(t, b.error) : ""}
                                  {b.status === "failed" && <PermissionHint error={b.error} operation="repoSettings.branches" />}
                                </span>
                              )}
                            </Match>
                            <Match when={menu()?.branches.status === "ready" && menu()!.branches} keyed>
                              {(b) => (
                                <>
                                  <select
                                    class="repo-settings__branch"
                                    aria-label={t("repoSettings.setting.defaultBranch")}
                                    value={menu()?.branch ?? ""}
                                    onChange={(ev) => s.chooseBranch(ev.currentTarget.value)}
                                  >
                                    <For each={b.status === "ready" ? b.names : []}>{(name) => <option value={name}>{name}</option>}</For>
                                  </select>
                                  <button
                                    type="button"
                                    class="button"
                                    disabled={!menu() || menu()!.branch === from() || (b.status === "ready" && b.names.length < 2)}
                                    onClick={() => s.askBranch()}
                                  >
                                    {t("repoSettings.edit.changeBranch")}
                                  </button>
                                  <Show when={b.status === "ready" && b.names.length < 2}>
                                    <span class="muted small">{t("repoSettings.edit.oneBranch")}</span>
                                  </Show>
                                </>
                              )}
                            </Match>
                          </Switch>
                        </div>
                      </div>
                    }
                  />
                );
              }}
            </Match>
            <Match when={e.phase === "visibilityWarn" && e}>
              {(w) => {
                const to = () => (w().phase === "visibilityWarn" ? (w() as { to: "public" | "private" }).to : "public");
                return (
                  <BulkBar
                    tone="danger"
                    label={label()}
                    text={
                      <>
                        <Icon name="warning" />
                        {to() === "public" ? t("repoSettings.edit.toPublic.title", { repo: e.repo.fullName }) : t("repoSettings.edit.toPrivate.title", { repo: e.repo.fullName })}
                      </>
                    }
                    actions={
                      <>
                        <button type="button" class="button" onClick={() => s.close()}>
                          {t("action.cancel")}
                        </button>
                        <button type="button" class="button button--danger" onClick={() => s.acknowledgeVisibility()}>
                          {t("repoSettings.edit.understand")}
                        </button>
                      </>
                    }
                    detail={
                      <ul class="repo-settings__effects">
                        <For each={to() === "public" ? TO_PUBLIC : TO_PRIVATE}>
                          {(k) => <li>{t(`repoSettings.edit.${to() === "public" ? "toPublic" : "toPrivate"}.${k}` as never)}</li>}
                        </For>
                      </ul>
                    }
                  />
                );
              }}
            </Match>
            <Match when={e.phase === "visibilityConfirm" && e}>
              {(c) => {
                const confirm = () => c() as Extract<typeof e, { phase: "visibilityConfirm" }>;
                return (
                  <BulkBar
                    tone="danger"
                    label={label()}
                    text={
                      <>
                        <Icon name="warning" />
                        {t("repoSettings.edit.confirm.title")}
                      </>
                    }
                    detail={
                      <form
                        class="repo-settings__edit"
                        onSubmit={(ev) => {
                          ev.preventDefault();
                          if (s.nameMatches()) void s.changeVisibility();
                        }}
                      >
                        <p>{t("repoSettings.edit.confirm.type", { repo: e.repo.fullName })}</p>
                        <div class="repo-settings__edit-row">
                          <input
                            type="text"
                            class="mono repo-settings__confirm-input"
                            aria-label={t("repoSettings.edit.confirm.type", { repo: e.repo.fullName })}
                            autocomplete="off"
                            spellcheck={false}
                            value={confirm().typed}
                            onInput={(ev) => s.typeName(ev.currentTarget.value)}
                            ref={(el) => queueMicrotask(() => el.focus())}
                          />
                          <button type="submit" class="button button--danger-solid" disabled={!s.nameMatches()}>
                            {confirm().to === "public"
                              ? t("repoSettings.edit.confirm.public", { repo: e.repo.fullName })
                              : t("repoSettings.edit.confirm.private", { repo: e.repo.fullName })}
                          </button>
                          <button type="button" class="button" onClick={() => s.close()}>
                            {t("action.cancel")}
                          </button>
                        </div>
                      </form>
                    }
                  />
                );
              }}
            </Match>
            <Match when={e.phase === "branchConfirm" && e}>
              {(b) => {
                const confirm = () => b() as Extract<typeof e, { phase: "branchConfirm" }>;
                return (
                  <BulkBar
                    tone="danger"
                    label={label()}
                    text={
                      <>
                        <Icon name="warning" />
                        {t("repoSettings.edit.branch.title", { repo: e.repo.fullName, from: confirm().from, to: confirm().to })}
                      </>
                    }
                    actions={
                      <>
                        <button type="button" class="button" onClick={() => s.close()}>
                          {t("action.cancel")}
                        </button>
                        <button type="button" class="button button--danger-solid" onClick={() => void s.changeBranch()}>
                          {t("repoSettings.edit.branch.ok")}
                        </button>
                      </>
                    }
                    detail={<p class="repo-settings__edit">{t("repoSettings.edit.branch.body")}</p>}
                  />
                );
              }}
            </Match>
            <Match when={e.phase === "saving"}>
              <BulkBar tone="info" label={label()} text={t("repoSettings.edit.saving", { repo: e.repo.fullName })} />
            </Match>
          </Switch>
        )}
      </Match>
      <Match when={s.notice()} keyed>
        {(n) => (
          <BulkBar
            tone={n.kind === "failed" ? "warn" : "info"}
            label={label()}
            text={
              n.kind === "visibilityChanged"
                ? n.to === "public"
                  ? t("repoSettings.edit.done.public", { repo: n.repo })
                  : t("repoSettings.edit.done.private", { repo: n.repo })
                : n.kind === "branchChanged"
                  ? t("repoSettings.edit.done.branch", { repo: n.repo, to: n.to })
                  : `${t("repoSettings.edit.failed", { repo: n.repo })} ${errorText(t, n.error)}`
            }
            actions={
              <button type="button" class="button button--ghost" onClick={() => s.dismissNotice()}>
                {t("action.close")}
              </button>
            }
            detail={n.kind === "failed" ? <PermissionHint error={n.error} operation="repoSettings.write" /> : undefined}
          />
        )}
      </Match>
    </Switch>
  );
}

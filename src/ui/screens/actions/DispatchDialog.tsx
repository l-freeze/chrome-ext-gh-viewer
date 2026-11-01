import { createEffect, For, Match, Show, Switch, type ParentProps } from "solid-js";
import type { DispatchInput } from "../../../features/actions/dispatch";
import { Icon } from "../../components/Icon";
import { PermissionHint } from "../../components/PermissionHint";
import { errorText } from "../../errors";
import { useUi } from "../../app/context";
import "./actions.css";
import type { DispatchPhase, DispatchState } from "./dispatch-state";

type Phase<P extends DispatchPhase["phase"]> = Extract<DispatchPhase, { phase: P }>;

/** ワークフローの手動実行。入力 → 確認 → 実行の順に進み、確認の画面からだけ実行できる */
export function DispatchDialog(props: { state: DispatchState }) {
  const { i18n } = useUi();
  const { t } = i18n;
  const s = props.state;
  let dialog: HTMLDialogElement | undefined;

  createEffect(() => {
    const open = s.state().phase !== "closed";
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  const target = () => {
    const st = s.state();
    return st.phase === "closed" ? null : st.target;
  };

  return (
    <dialog
      ref={dialog}
      class="dialog"
      aria-labelledby="dispatch-title"
      // Esc で閉じるときも状態を合わせる。実行中は閉じさせない
      onCancel={(e) => {
        e.preventDefault();
        s.close();
      }}
    >
      <Show when={target()}>
        {(tg) => (
          <div class="dialog__body">
            <header class="dialog__header">
              <h2 id="dispatch-title">
                {s.state().phase === "confirm" || s.state().phase === "running" ? t("dispatch.confirmTitle") : t("dispatch.title")}
              </h2>
              <p class="muted small">
                {tg().repo.fullName} · <strong>{tg().workflow.name}</strong>{" "}
                <span class="mono">{tg().workflow.path}</span>
              </p>
            </header>

            <Switch>
              <Match when={s.state().phase === "loading"}>
                <p role="status">{t("dispatch.loading")}</p>
                <Footer>
                  <button type="button" class="button button--ghost" onClick={() => s.close()}>
                    {t("action.cancel")}
                  </button>
                </Footer>
              </Match>

              <Match when={s.state().phase === "unavailable" && (s.state() as Phase<"unavailable">)}>
                {(st) => (
                  <>
                    <p class="notice">
                      <Icon name="warning" />
                      {st().reason === "parse"
                        ? t("dispatch.parseError", { detail: st().detail ?? "" })
                        : st().detail
                          ? t("dispatch.notDispatchableOnRef", { ref: st().detail! })
                          : t("dispatch.notDispatchable")}
                    </p>
                    <Footer>
                      <button type="button" class="button" onClick={() => s.close()}>
                        {t("action.close")}
                      </button>
                    </Footer>
                  </>
                )}
              </Match>

              <Match when={s.state().phase === "error" && (s.state() as Phase<"error">)}>
                {(st) => (
                  <>
                    <p class="error" role="alert">{errorText(t, st().error)}</p>
                    <PermissionHint error={st().error} operation="workflow.read" />
                    <Footer>
                      <button type="button" class="button" onClick={() => s.close()}>
                        {t("action.close")}
                      </button>
                    </Footer>
                  </>
                )}
              </Match>

              <Match when={s.state().phase === "form" && (s.state() as Phase<"form">)}>
                {(st) => (
                  <form
                    class="dispatch-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      s.review();
                    }}
                  >
                    <label class="form-row form-row__field">
                      <span class="form-row__label">{t("dispatch.branch")}</span>
                      <select value={st().ref} disabled={st().reloading} onChange={(e) => void s.setRef(e.currentTarget.value)}>
                        <For each={st().branches}>{(b) => <option value={b}>{b}</option>}</For>
                      </select>
                    </label>
                    <Show when={st().reloading}>
                      <p class="muted small" role="status">{t("dispatch.loading")}</p>
                    </Show>
                    <Show when={st().inputs.length > 0} fallback={<p class="muted">{t("dispatch.noInputs")}</p>}>
                      <For each={st().inputs}>
                        {(input) => (
                          <InputField
                            input={input}
                            value={st().values[input.name] ?? ""}
                            error={st().errors[input.name]}
                            environments={st().environments}
                            onChange={(v) => s.setValue(input.name, v)}
                          />
                        )}
                      </For>
                    </Show>
                    <Footer>
                      <button type="button" class="button button--ghost" onClick={() => s.close()}>
                        {t("action.cancel")}
                      </button>
                      <button type="submit" class="button button--primary" disabled={st().reloading}>
                        {t("dispatch.review")}
                      </button>
                    </Footer>
                  </form>
                )}
              </Match>

              <Match
                when={
                  (s.state().phase === "confirm" || s.state().phase === "running" || s.state().phase === "failed") &&
                  (s.state() as Phase<"confirm"> | Phase<"running"> | Phase<"failed">)
                }
              >
                {(st) => (
                  <>
                    <p class="notice">
                      <Icon name="warning" />
                      {t("dispatch.confirmBody")}
                    </p>
                    <dl class="summary-list">
                      <dt>{t("dispatch.repository")}</dt>
                      <dd>{st().target.repo.fullName}</dd>
                      <dt>{t("dispatch.workflow")}</dt>
                      <dd>
                        {st().target.workflow.name} <span class="mono muted small">{st().target.workflow.path}</span>
                      </dd>
                      <dt>{t("dispatch.branch")}</dt>
                      <dd class="mono">{st().ref}</dd>
                      <For each={st().inputs}>
                        {(input) => (
                          <>
                            <dt>
                              <span class="mono">{input.name}</span>
                            </dt>
                            <dd class="mono">
                              {input.name in st().payload ? (
                                st().payload[input.name] || '""'
                              ) : (
                                <span class="muted">{t("dispatch.defaultValue")}</span>
                              )}
                            </dd>
                          </>
                        )}
                      </For>
                    </dl>
                    <Show when={st().phase === "failed" && (st() as Phase<"failed">)}>
                      {(f) => (
                        <>
                          <p class="error" role="alert">
                            {t("dispatch.failed")} {errorText(t, f().error)}
                          </p>
                          <PermissionHint error={f().error} operation="workflow.dispatch" />
                        </>
                      )}
                    </Show>
                    <Footer>
                      <button type="button" class="button button--ghost" disabled={st().phase === "running"} onClick={() => s.back()}>
                        {t("dispatch.back")}
                      </button>
                      <Show when={st().phase !== "failed"}>
                        <button
                          type="button"
                          class="button button--danger-solid"
                          disabled={st().phase === "running"}
                          onClick={() => void s.run()}
                        >
                          <Icon name="play" />
                          {st().phase === "running" ? t("dispatch.running") : t("dispatch.run")}
                        </button>
                      </Show>
                    </Footer>
                  </>
                )}
              </Match>

              <Match when={s.state().phase === "done" && (s.state() as Phase<"done">)}>
                {(st) => (
                  <>
                    <p role="status">
                      <Icon name="check" /> {st().runUrl ? t("dispatch.doneTracked", { ref: st().ref }) : t("dispatch.done", { ref: st().ref })}
                    </p>
                    <Footer>
                      <a class="button button--ghost" href={st().runUrl ?? st().target.workflow.htmlUrl} target="_blank" rel="noreferrer">
                        {st().runUrl ? t("dispatch.openRun") : t("dispatch.openOnGitHub")}
                        <Icon name="external" size={14} />
                      </a>
                      <button type="button" class="button button--primary" onClick={() => s.close()}>
                        {t("action.close")}
                      </button>
                    </Footer>
                  </>
                )}
              </Match>
            </Switch>
          </div>
        )}
      </Show>
    </dialog>
  );

  function Footer(p: ParentProps) {
    return <div class="dialog__footer">{p.children}</div>;
  }

  function InputField(p: {
    input: DispatchInput;
    value: string;
    error: string | undefined;
    environments: string[] | null;
    onChange: (value: string) => void;
  }) {
    const id = `input-${p.input.name}`;
    const describedBy = () => [p.input.description ? `${id}-desc` : "", p.error ? `${id}-err` : ""].filter(Boolean).join(" ");
    const label = (
      <span class="form-row__label">
        <span class="mono">{p.input.name}</span>
        <Show when={p.input.required}>
          <span class="required"> {t("dispatch.required")}</span>
        </Show>
      </span>
    );
    return (
      <div class="form-row" classList={{ "form-row--error": !!p.error }}>
        <Switch
          fallback={
            <label for={id} class="form-row__field">
              {label}
              <input
                id={id}
                type="text"
                inputmode={p.input.type === "number" ? "decimal" : undefined}
                value={p.value}
                aria-invalid={!!p.error}
                aria-describedby={describedBy() || undefined}
                onInput={(e) => p.onChange(e.currentTarget.value)}
              />
            </label>
          }
        >
          <Match when={p.input.type === "boolean"}>
            <label class="form-row__check">
              <input
                id={id}
                type="checkbox"
                checked={p.value === "true"}
                aria-describedby={describedBy() || undefined}
                onChange={(e) => p.onChange(e.currentTarget.checked ? "true" : "false")}
              />
              {label}
            </label>
          </Match>
          <Match when={p.input.type === "choice" || (p.input.type === "environment" && p.environments !== null)}>
            <label for={id} class="form-row__field">
              {label}
              <select
                id={id}
                value={p.value}
                aria-invalid={!!p.error}
                aria-describedby={describedBy() || undefined}
                onChange={(e) => p.onChange(e.currentTarget.value)}
              >
                <Show when={p.input.type === "environment" || !p.input.required}>
                  <option value="">—</option>
                </Show>
                <For each={p.input.type === "choice" ? p.input.options : (p.environments ?? [])}>
                  {(o) => <option value={o}>{o}</option>}
                </For>
              </select>
            </label>
          </Match>
        </Switch>
        <Show when={p.input.description}>
          <p id={`${id}-desc`} class="muted small">{p.input.description}</p>
        </Show>
        <Show when={p.error}>
          <p id={`${id}-err`} class="error small">{t(`dispatch.error.${p.error as "required" | "number" | "choice"}`)}</p>
        </Show>
      </div>
    );
  }
}

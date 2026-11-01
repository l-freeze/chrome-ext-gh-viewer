import { createEffect, createMemo, For, Match, Show, Switch } from "solid-js";
import { formatDate } from "../../domain/format";
import type { RunConclusionFilter } from "../../domain/runCleanup";
import { Failures } from "../components/Failures";
import { Icon } from "../components/Icon";
import { PermissionHint } from "../components/PermissionHint";
import { errorText } from "../errors";
import { useDeps } from "../state/context";
import type { RunCleanupState } from "../state/runCleanup";

const CONCLUSIONS: readonly RunConclusionFilter[] = ["all", "success", "failure", "cancelled", "skipped"];

/** 実行履歴の一括削除: 条件で検索 → リポジトリ単位で選ぶ → 確認 → 削除 */
export function RunCleanupView(props: { state: RunCleanupState; repoCount: number }) {
  const { i18n } = useDeps();
  const { t } = i18n;
  const s = props.state;
  const busy = () => s.phase().phase === "searching" || s.phase().phase === "deleting";
  const total = createMemo(() => s.groups().reduce((n, g) => n + g.runs.length, 0));

  return (
    <div class="run-cleanup">
      <p class="muted">{t("runs.intro")}</p>
      <form
        class="filters"
        onSubmit={(e) => {
          e.preventDefault();
          void s.search();
        }}
      >
        <label class="field">
          <span class="field__label">{t("runs.olderThan")}</span>
          <input
            type="number"
            min="0"
            inputmode="numeric"
            value={s.criteria.olderThanDays}
            disabled={busy()}
            onInput={(e) => {
              const v = Number(e.currentTarget.value);
              if (Number.isFinite(v) && v >= 0) s.setCriteria("olderThanDays", v);
            }}
          />
          <span class="field__unit">{t("runs.daysAgo")}</span>
        </label>
        <label class="field">
          <span class="field__label">{t("runs.conclusion")}</span>
          <select
            value={s.criteria.conclusion}
            disabled={busy()}
            onChange={(e) => s.setCriteria("conclusion", e.currentTarget.value as RunConclusionFilter)}
          >
            <For each={CONCLUSIONS}>{(c) => <option value={c}>{t(`runs.conclusion.${c}`)}</option>}</For>
          </select>
        </label>
        <label class="field field--grow">
          <span class="field__label">{t("runs.workflow")}</span>
          <input
            type="search"
            value={s.criteria.workflowQuery}
            placeholder={t("runs.workflowPlaceholder")}
            disabled={busy()}
            onInput={(e) => s.setCriteria("workflowQuery", e.currentTarget.value)}
          />
        </label>
        <button type="submit" class="button button--primary" disabled={busy() || props.repoCount === 0}>
          {t("runs.search")}
        </button>
      </form>

      <Show when={s.phase().phase === "searching" && s.phase()} keyed>
        {(p) =>
          p.phase === "searching" && (
            <p class="notice notice--info" role="status">
              {t("runs.searching", { done: p.done, total: p.total })}
              <button type="button" class="button button--ghost" onClick={() => s.stop()}>
                {t("runs.stop")}
              </button>
            </p>
          )
        }
      </Show>

      <Show when={s.stale()}>
        <p class="notice">
          <Icon name="warning" />
          {t("runs.stale")}
        </p>
      </Show>

      <Failures
        title={t("failures.title", { count: s.failures().length })}
        items={s.failures().map((f) => ({ key: String(f.repo.id), label: f.repo.fullName, error: f.error }))}
        operation="runs.list"
      />

      <Show when={s.searched() && s.phase().phase !== "searching"}>
        <p class="issues__count" role="status">
          {total() > 0 ? <strong>{t("runs.resultSummary", { count: total(), repos: s.groups().length })}</strong> : t("runs.none")}
        </p>

        <BulkBar />

        <Show when={s.groups().length > 0}>
          <div class="table-wrap">
            <table class="table table--runs">
              <thead>
                <tr>
                  <th class="col-check">
                    <SelectAll />
                  </th>
                  <th>{t("runs.col.repository")}</th>
                  <th class="num">{t("runs.col.runs")}</th>
                  <th>{t("runs.col.workflows")}</th>
                  <th>{t("runs.col.period")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={s.groups()}>
                  {(g) => (
                    <tr classList={{ "row--selected": s.isIncluded(g.key) }}>
                      <td class="col-check">
                        <input
                          type="checkbox"
                          aria-label={g.key}
                          checked={s.isIncluded(g.key)}
                          disabled={busy()}
                          onChange={() => s.toggleRepo(g.key)}
                        />
                      </td>
                      <td class="cell-repo">
                        <a href={`https://github.com/${g.key}/actions`} target="_blank" rel="noreferrer">
                          <span class="muted">{g.repo.owner.login}/</span>
                          {g.repo.name}
                        </a>
                        <Show when={g.truncated}>
                          <div class="warn small">{t("runs.truncated")}</div>
                        </Show>
                      </td>
                      <td class="num">{i18n.number(g.runs.length)}</td>
                      <td class="cell-labels">
                        <For each={g.summary.byWorkflow}>
                          {(w) => (
                            <span class="label">
                              {w.name} <span class="muted">{i18n.number(w.count)}</span>
                            </span>
                          )}
                        </For>
                      </td>
                      <td class="num-date">
                        {formatDate(g.summary.oldest)} – {formatDate(g.summary.newest)}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
    </div>
  );

  function SelectAll() {
    const included = createMemo(() => s.targetRepoCount());
    const all = () => included() === s.groups().length && included() > 0;
    const some = () => included() > 0 && !all();
    return (
      <input
        type="checkbox"
        aria-label="Select all"
        checked={all()}
        disabled={busy()}
        ref={(el) => createEffect(() => (el.indeterminate = some()))}
        onChange={(e) => s.setAll(e.currentTarget.checked)}
      />
    );
  }

  function BulkBar() {
    const failedNotice = () => {
      const n = s.notice();
      return n?.kind === "deleteFailed" ? n : null;
    };
    const count = () => s.targets().length;
    const repos = () => s.targetRepoCount();
    return (
      <Show when={count() > 0 || s.notice() || s.phase().phase === "deleting"}>
        <div
          class="bulkbar"
          classList={{
            "bulkbar--danger": s.phase().phase === "confirm",
            "bulkbar--warn": s.phase().phase === "results" && s.notice()?.kind === "deleteFailed",
          }}
          role="region"
          aria-label={t("runs.selection", { count: count(), repos: repos() })}
        >
          <Switch>
            <Match when={s.phase().phase === "confirm"}>
              <span class="bulkbar__text">
                <Icon name="warning" />
                <span>
                  {t("runs.confirm", { count: count(), repos: repos() })}
                  <br />
                  <span class="small">{t("runs.requests", { count: count() })}</span>
                </span>
              </span>
              <div class="bulkbar__actions">
                <button type="button" class="button" onClick={() => s.cancelDelete()}>
                  {t("action.cancel")}
                </button>
                <button type="button" class="button button--danger-solid" onClick={() => void s.deleteTargets()}>
                  {t("artifacts.confirmDeleteButton")}
                </button>
              </div>
            </Match>
            <Match when={s.phase().phase === "deleting" && s.phase()} keyed>
              {(p) =>
                p.phase === "deleting" && (
                  <>
                    <span class="bulkbar__text" role="status">
                      {t("runs.deleting", { done: p.done, total: p.total })}
                    </span>
                    <div class="bulkbar__actions">
                      <button type="button" class="button" onClick={() => s.stop()}>
                        {t("runs.stop")}
                      </button>
                    </div>
                  </>
                )
              }
            </Match>
            <Match when={true}>
              <span class="bulkbar__text" role="status">
                <Show when={s.notice()} keyed>
                  {(n) => (
                    <span>
                      {n.kind === "deleted"
                        ? t("runs.deleted", { count: n.count })
                        : n.kind === "stopped"
                          ? t("runs.stopped", { count: n.count })
                          : `${t("runs.deleteFailed", { deleted: n.deleted, failed: n.failed })} ${errorText(t, n.errors[0]!)}`}
                    </span>
                  )}
                </Show>
                <Show when={count() > 0}>
                  <strong>{t("runs.selection", { count: count(), repos: repos() })}</strong>
                </Show>
              </span>
              <div class="bulkbar__actions">
                <Show when={count() > 0}>
                  <button type="button" class="button button--danger" disabled={s.stale()} onClick={() => s.askDelete()}>
                    <Icon name="trash" />
                    {t("runs.delete", { count: count() })}
                  </button>
                </Show>
                <Show when={s.notice()}>
                  <button type="button" class="button button--ghost" onClick={() => s.dismissNotice()}>
                    {t("action.close")}
                  </button>
                </Show>
              </div>
              <Show when={failedNotice()}>
                {(n) => (
                  <div class="bulkbar__detail">
                    <PermissionHint error={n().errors[0]!} operation="runs.delete" />
                  </div>
                )}
              </Show>
            </Match>
          </Switch>
        </div>
      </Show>
    );
  }
}

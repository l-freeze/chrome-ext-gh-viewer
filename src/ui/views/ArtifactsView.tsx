import { For, Match, Show, Switch, createEffect, createMemo } from "solid-js";
import type { Artifact } from "../../api/types";
import { expiryState, isExpired, repoKey, STALE_DAYS, type ArtifactSortKey } from "../../domain/artifacts";
import { formatBytes, formatDate, formatPercent } from "../../domain/format";
import { Failures } from "../components/Failures";
import { Icon } from "../components/Icon";
import { errorText } from "../errors";
import type { ArtifactsState } from "../state/artifacts";
import { useDeps } from "../state/context";
import type { WorkspaceState } from "../state/workspace";

export function ArtifactsView(props: { state: ArtifactsState; ws: WorkspaceState }) {
  const { i18n } = useDeps();
  const { t } = i18n;
  const s = props.state;
  const bytes = (n: number) => formatBytes(n, i18n.number);

  return (
    <div class="artifacts">
      <div class="artifacts__main">
        <Summary state={s} scanned={props.ws.selectedRepos().length} />
        <Failures
          title={t("failures.title", { count: s.failures().length })}
          items={s.failures().map((f) => ({ key: String(f.repo.id), label: f.repo.fullName, error: f.error }))}
        />
        <Filters state={s} />
        <BulkBar state={s} />
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="col-check">
                  <SelectAll state={s} />
                </th>
                <SortHeader state={s} key="name" label={t("artifacts.col.artifact")} />
                <SortHeader state={s} key="repo" label={t("artifacts.col.repository")} />
                <SortHeader state={s} key="branch" label={t("artifacts.col.branch")} />
                <SortHeader state={s} key="size" label={t("artifacts.col.size")} numeric />
                <SortHeader state={s} key="created" label={t("artifacts.col.created")} />
                <SortHeader state={s} key="expires" label={t("artifacts.col.expires")} />
                <th class="col-action">
                  <span class="visually-hidden">{t("artifacts.downloadSelected", { count: 1 })}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={s.visible()}>{(a) => <Row state={s} artifact={a} />}</For>
              <Show when={s.progress()}>
                <For each={[0, 1]}>
                  {() => (
                    <tr class="row--skeleton" aria-hidden="true">
                      <td />
                      <td><span class="skeleton" style={{ width: "60%" }} /></td>
                      <td><span class="skeleton" style={{ width: "70%" }} /></td>
                      <td><span class="skeleton" style={{ width: "40%" }} /></td>
                      <td class="num"><span class="skeleton" style={{ width: "50%" }} /></td>
                      <td><span class="skeleton" style={{ width: "60%" }} /></td>
                      <td><span class="skeleton" style={{ width: "50%" }} /></td>
                      <td />
                    </tr>
                  )}
                </For>
              </Show>
            </tbody>
          </table>
          <Show when={!s.progress() && !props.ws.loading() && s.visible().length === 0}>
            <p class="empty">{s.artifacts().length === 0 ? t("artifacts.noneAtAll") : t("artifacts.empty")}</p>
          </Show>
        </div>
        <p class="footnote">{t("artifacts.footer")}</p>
      </div>
      <ByRepo state={s} />
    </div>
  );

  function Summary(p: { state: ArtifactsState; scanned: number }) {
    const sum = () => p.state.summary();
    const largest = () => sum().stale[0];
    return (
      <section class="summary" aria-labelledby="summary-text">
        <div class="summary__lead">
          <p id="summary-text">
            <Show
              when={sum().stale.length > 0}
              fallback={t("artifacts.summary.noStale", { days: STALE_DAYS })}
            >
              <strong>
                {t("artifacts.summary.stale", {
                  count: sum().stale.length,
                  days: STALE_DAYS,
                  size: bytes(sum().staleBytes),
                  percent: formatPercent(sum().staleBytes / Math.max(1, sum().liveBytes), i18n.number),
                })}
              </strong>{" "}
              <Show when={largest()}>
                {(a) =>
                  t("artifacts.summary.largest", { name: a().name, repo: a().repo.name, size: bytes(a().sizeInBytes) })
                }
              </Show>
            </Show>
          </p>
          <Show when={sum().stale.length > 0}>
            <button type="button" class="button button--primary" onClick={() => p.state.selectStale()}>
              {t("artifacts.selectStale", { count: sum().stale.length, days: STALE_DAYS })}
            </button>
          </Show>
        </div>
        <dl class="kpis">
          <div>
            <dt>{t("artifacts.kpi.stored")}</dt>
            <dd class="kpi__value">{bytes(sum().liveBytes)}</dd>
            <dd class="kpi__note">{t("artifacts.kpi.storedNote", { count: sum().liveCount })}</dd>
          </div>
          <div>
            <dt>{t("artifacts.kpi.listed")}</dt>
            <dd class="kpi__value">{i18n.number(p.state.artifacts().length)}</dd>
            <dd class="kpi__note">{t("artifacts.kpi.listedNote", { count: sum().expiredCount })}</dd>
          </div>
          <div>
            <dt>{t("artifacts.kpi.repos")}</dt>
            <dd class="kpi__value">{i18n.number(sum().reposWithArtifacts)}</dd>
            <dd class="kpi__note">{t("artifacts.kpi.reposNote", { count: p.scanned })}</dd>
          </div>
          <div>
            <dt>{t("artifacts.kpi.expiring")}</dt>
            <dd class="kpi__value">{i18n.number(sum().expiringSoon.length)}</dd>
            <dd class="kpi__note mono">{sum().expiringSoon[0]?.name ?? "—"}</dd>
          </div>
        </dl>
      </section>
    );
  }

  function Filters(p: { state: ArtifactsState }) {
    const f = p.state.filter;
    const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)));
    return (
      <div class="filters" role="search">
        <label class="field field--grow">
          <span class="field__label">{t("artifacts.filter.repo")}</span>
          <input
            type="search"
            value={f.repoQuery}
            placeholder={t("artifacts.filter.repoPlaceholder")}
            onInput={(e) => p.state.setFilter("repoQuery", e.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span class="field__label">{t("artifacts.filter.olderThan")}</span>
          <input
            type="number"
            min="0"
            inputmode="numeric"
            value={f.olderThanDays ?? ""}
            onInput={(e) => p.state.setFilter("olderThanDays", num(e.currentTarget.value))}
          />
          <span class="field__unit">{t("artifacts.filter.days")}</span>
        </label>
        <label class="field">
          <span class="field__label">{t("artifacts.filter.minSize")}</span>
          <input
            type="number"
            min="0"
            inputmode="decimal"
            value={f.minSizeMB ?? ""}
            onInput={(e) => p.state.setFilter("minSizeMB", num(e.currentTarget.value))}
          />
          <span class="field__unit">MB</span>
        </label>
        <div class="segmented" role="radiogroup" aria-label={t("artifacts.filter.status")}>
          <For each={["all", "active", "expired"] as const}>
            {(status) => (
              <button
                type="button"
                role="radio"
                aria-checked={f.status === status}
                onClick={() => p.state.setFilter("status", status)}
              >
                {t(`artifacts.filter.${status}`)}
              </button>
            )}
          </For>
        </div>
      </div>
    );
  }

  /** chrome.downloads の中断理由（SERVER_UNAUTHORIZED など）を利用者向けの文にする */
  function downloadReason(reason: string): string {
    if (reason === "SERVER_UNAUTHORIZED") return t("error.unauthorized");
    if (reason === "SERVER_FORBIDDEN") return t("error.forbidden");
    if (reason.startsWith("NETWORK_")) return t("error.network");
    return reason;
  }

  function BulkBar(p: { state: ArtifactsState }) {
    const sel = () => p.state.selectionSummary();
    const notice = () => p.state.notice();
    const noticeText = () => {
      const n = notice();
      if (!n) return "";
      switch (n.kind) {
        case "deleted":
          return t("artifacts.deleted", { count: n.count });
        case "deleteFailed":
          return `${t("artifacts.deleteFailed", { count: n.count })} ${errorText(t, n.errors[0]!)}`;
        case "downloadStarted":
          return t("artifacts.downloadStarted", { count: n.count });
        case "downloadFailed":
          return t("artifacts.downloadFailed", { name: n.name, reason: downloadReason(n.reason) });
        case "error":
          return errorText(t, n.error);
      }
    };
    return (
      <Show when={sel().count > 0 || p.state.deleteState().phase !== "idle" || notice()}>
        <div
          class="bulkbar"
          classList={{
            "bulkbar--danger": p.state.deleteState().phase === "confirm",
            "bulkbar--warn":
              p.state.deleteState().phase === "idle" &&
              sel().count === 0 &&
              ["deleteFailed", "downloadFailed", "error"].includes(notice()?.kind ?? ""),
          }}
          role="region"
          aria-label={t("artifacts.selection", { count: sel().count })}
        >
          <Switch>
            <Match when={p.state.deleteState().phase === "confirm"}>
              <span class="bulkbar__text">
                <Icon name="warning" />
                {t("artifacts.confirmDelete", { count: sel().count, size: bytes(sel().bytes) })}
              </span>
              <div class="bulkbar__actions">
                <button type="button" class="button" onClick={() => p.state.cancelDelete()}>
                  {t("action.cancel")}
                </button>
                <button type="button" class="button button--danger-solid" onClick={() => void p.state.deleteSelection()}>
                  {t("artifacts.confirmDeleteButton")}
                </button>
              </div>
            </Match>
            <Match when={p.state.deleteState()} keyed>
              {(d) =>
                d.phase === "deleting" ? (
                  <span class="bulkbar__text" role="status">
                    {t("artifacts.deleting", { done: d.done, total: d.total })}
                  </span>
                ) : (
                  <>
                    <span class="bulkbar__text" role="status">
                      <Show when={sel().count > 0} fallback={noticeText()}>
                        <strong>{t("artifacts.selection", { count: sel().count })}</strong>
                        <span class="muted">
                          {" · "}
                          {bytes(sel().bytes)} · {t("artifacts.selectionFrom", { count: sel().repoCount })}
                        </span>
                        <Show when={notice()}>
                          <span class="muted"> — {noticeText()}</span>
                        </Show>
                      </Show>
                    </span>
                    <div class="bulkbar__actions">
                      <Show
                        when={sel().count > 0}
                        fallback={
                          <button type="button" class="button button--ghost" onClick={() => p.state.dismissNotice()}>
                            {t("action.close")}
                          </button>
                        }
                      >
                        <button type="button" class="button button--primary" onClick={() => void p.state.download(p.state.selection())}>
                          <Icon name="download" />
                          {t("artifacts.downloadSelected", { count: sel().count })}
                        </button>
                        <button type="button" class="button button--danger" onClick={() => p.state.askDelete()}>
                          <Icon name="trash" />
                          {t("artifacts.deleteSelected", { count: sel().count })}
                        </button>
                        <button type="button" class="button button--ghost" onClick={() => p.state.clearSelection()}>
                          {t("action.clear")}
                        </button>
                      </Show>
                    </div>
                  </>
                )
              }
            </Match>
          </Switch>
        </div>
      </Show>
    );
  }

  function SelectAll(p: { state: ArtifactsState }) {
    const all = createMemo(() => p.state.visible().length > 0 && p.state.selection().length === p.state.visible().length);
    const some = createMemo(() => p.state.selection().length > 0 && !all());
    return (
      <input
        type="checkbox"
        aria-label="Select all"
        checked={all()}
        ref={(el) => createEffect(() => (el.indeterminate = some()))}
        onChange={(e) => p.state.setMany(p.state.visible(), e.currentTarget.checked)}
      />
    );
  }

  function SortHeader(p: { state: ArtifactsState; key: ArtifactSortKey; label: string; numeric?: boolean }) {
    const dir = () => (p.state.sort().key === p.key ? p.state.sort().dir : null);
    return (
      <th
        class={p.numeric ? "num" : undefined}
        aria-sort={dir() === "asc" ? "ascending" : dir() === "desc" ? "descending" : undefined}
      >
        <button type="button" class="sort" onClick={() => p.state.toggleSort(p.key)}>
          {p.label}
          <span class="sort__arrow" aria-hidden="true">
            {dir() === "asc" ? "↑" : dir() === "desc" ? "↓" : ""}
          </span>
        </button>
      </th>
    );
  }

  function Row(p: { state: ArtifactsState; artifact: Artifact }) {
    const a = p.artifact;
    const expired = () => isExpired(a, p.state.now());
    const expiry = () => expiryState(a, p.state.now());
    return (
      <tr classList={{ "row--selected": p.state.isSelected(a.id), "row--expired": expired() }}>
        <td class="col-check">
          <input
            type="checkbox"
            aria-label={a.name}
            checked={p.state.isSelected(a.id)}
            onChange={() => p.state.toggle(a.id)}
          />
        </td>
        <td class="mono cell-name" title={a.name}>{a.name}</td>
        <td class="cell-repo">
          <a href={`https://github.com/${repoKey(a.repo)}/actions`} target="_blank" rel="noreferrer">
            <span class="muted">{a.repo.owner}/</span>
            {a.repo.name}
          </a>
        </td>
        <td class="mono muted cell-branch" title={a.workflowRun?.headBranch ?? undefined}>
          {a.workflowRun?.headBranch ?? "—"}
        </td>
        <td class="num">{bytes(a.sizeInBytes)}</td>
        <td class="num-date">{formatDate(a.createdAt) ?? "—"}</td>
        <td class="num-date">
          <Switch fallback={<span>—</span>}>
            <Match when={expiry().kind === "expired"}>
              <span class="badge">{t("artifacts.expired")}</span>
            </Match>
            <Match when={expiry().kind === "today"}>
              <span class="badge badge--warn">{t("artifacts.expiresToday")}</span>
            </Match>
            <Match when={expiry().kind === "tomorrow"}>
              <span class="badge badge--warn">{t("artifacts.expiresTomorrow")}</span>
            </Match>
            <Match when={expiry().kind === "days"}>
              {formatDate(a.expiresAt)}
              <span class="muted"> · {t("artifacts.daysLeft", { days: (expiry() as { days: number }).days })}</span>
            </Match>
          </Switch>
        </td>
        <td class="col-action">
          <button
            type="button"
            class="icon-button"
            disabled={expired()}
            title={t("artifacts.download", { name: a.name })}
            onClick={() => void p.state.download([a])}
          >
            <Icon name="download" label={t("artifacts.download", { name: a.name })} />
          </button>
        </td>
      </tr>
    );
  }

  function ByRepo(p: { state: ArtifactsState }) {
    const rows = () => p.state.summary().byRepo.slice(0, 12);
    const max = () => rows()[0]?.bytes ?? 1;
    return (
      <Show when={rows().length > 0}>
        <aside class="byrepo" aria-labelledby="byrepo-title">
          <h2 id="byrepo-title">{t("artifacts.byRepo.title")}</h2>
          <p class="muted small">{t("artifacts.byRepo.note")}</p>
          <ol>
            <For each={rows()}>
              {(r) => (
                <li>
                  <div class="byrepo__line">
                    <span class="byrepo__name" title={r.key}>{r.repo.name}</span>
                    <span class="mono">{bytes(r.bytes)}</span>
                  </div>
                  <span class="byrepo__bar" style={{ width: `${(r.bytes / max()) * 100}%` }} />
                  <div class="muted small">
                    {r.repo.owner} · {t("artifacts.byRepo.count", { count: r.count })}
                  </div>
                </li>
              )}
            </For>
          </ol>
        </aside>
      </Show>
    );
  }
}

import { For, Match, Show, Switch } from "solid-js";
import { expiryState, isExpired, type Artifact } from "../../../features/artifacts/artifact";
import { STALE_DAYS } from "../../../features/artifacts/listing";
import { repoKey } from "../../../features/workspace/repository";
import { useUi } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { Failures } from "../../components/Failures";
import { Icon } from "../../components/Icon";
import { PermissionHint } from "../../components/PermissionHint";
import { downloadFailureText, errorText } from "../../errors";
import { formatBytes, formatDate, formatPercent } from "../../format";
import { BulkBar } from "../../lists/BulkBar";
import { SelectAll } from "../../lists/SelectAll";
import { SortHeader } from "../../lists/SortHeader";
import { UsageByRepo } from "../../lists/UsageByRepo";
import "../../lists/lists.css";
import type { ArtifactsState } from "./state";

export function ArtifactsScreen(props: { state: ArtifactsState; ws: WorkspaceState }) {
  const { i18n } = useUi();
  const { t } = i18n;
  const s = props.state;
  const bytes = (n: number) => formatBytes(n, i18n.number);
  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)));
  const sortHeader = (column: Parameters<typeof s.toggleSort>[0], label: string, numeric = false) => (
    <SortHeader sort={s.sort()} column={column} label={label} numeric={numeric} onSort={s.toggleSort} />
  );

  return (
    <div class="listing">
      <div class="listing__main">
        <Summary />
        <Failures
          title={t("failures.title", { count: s.results.failures().length })}
          items={s.results.failures().map((f) => ({ key: String(f.repo.id), label: f.repo.fullName, error: f.error }))}
          operation="artifacts.list"
        />
        <div class="filters" role="search">
          <label class="field field--grow">
            <span class="field__label">{t("artifacts.filter.repo")}</span>
            <input
              type="search"
              value={s.filter.repoQuery}
              placeholder={t("artifacts.filter.repoPlaceholder")}
              onInput={(e) => s.setFilter("repoQuery", e.currentTarget.value)}
            />
          </label>
          <label class="field">
            <span class="field__label">{t("artifacts.filter.olderThan")}</span>
            <input type="number" min="0" inputmode="numeric" value={s.filter.olderThanDays ?? ""} onInput={(e) => s.setFilter("olderThanDays", num(e.currentTarget.value))} />
            <span class="field__unit">{t("artifacts.filter.days")}</span>
          </label>
          <label class="field">
            <span class="field__label">{t("artifacts.filter.minSize")}</span>
            <input type="number" min="0" inputmode="decimal" value={s.filter.minSizeMB ?? ""} onInput={(e) => s.setFilter("minSizeMB", num(e.currentTarget.value))} />
            <span class="field__unit">MB</span>
          </label>
          <div class="segmented" role="radiogroup" aria-label={t("artifacts.filter.status")}>
            <For each={["all", "active", "expired"] as const}>
              {(status) => (
                <button type="button" role="radio" aria-checked={s.filter.status === status} onClick={() => s.setFilter("status", status)}>
                  {t(`artifacts.filter.${status}`)}
                </button>
              )}
            </For>
          </div>
        </div>
        <Bar />
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="col-check">
                  <SelectAll total={s.visible().length} selected={s.selection.selected().length} onChange={(v) => s.selection.setMany(s.visible(), v)} />
                </th>
                {sortHeader("name", t("artifacts.col.artifact"))}
                {sortHeader("repo", t("artifacts.col.repository"))}
                {sortHeader("branch", t("artifacts.col.branch"))}
                {sortHeader("size", t("artifacts.col.size"), true)}
                {sortHeader("created", t("artifacts.col.created"))}
                {sortHeader("expires", t("artifacts.col.expires"))}
                <th class="col-action">
                  <span class="visually-hidden">{t("artifacts.downloadSelected", { count: 1 })}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={s.visible()}>{(a) => <Row artifact={a} />}</For>
              <Show when={s.results.progress()}>
                <For each={[0, 1]}>
                  {() => (
                    <tr class="row--skeleton" aria-hidden="true">
                      <td />
                      <For each={["60%", "70%", "40%", "50%", "60%", "50%"]}>
                        {(w) => (
                          <td>
                            <span class="skeleton" style={{ width: w }} />
                          </td>
                        )}
                      </For>
                      <td />
                    </tr>
                  )}
                </For>
              </Show>
            </tbody>
          </table>
          <Show when={!s.results.progress() && !props.ws.loading() && s.visible().length === 0}>
            <p class="empty">{s.artifacts().length === 0 ? t("artifacts.noneAtAll") : t("artifacts.empty")}</p>
          </Show>
        </div>
        <p class="footnote">{t("artifacts.footer")}</p>
      </div>
      <UsageByRepo
        rows={s.summary().byRepo}
        title={t("artifacts.byRepo.title")}
        note={t("artifacts.byRepo.note")}
        countLabel={(count) => t("artifacts.byRepo.count", { count })}
      />
    </div>
  );

  function Summary() {
    const sum = () => s.summary();
    return (
      <section class="summary">
        <div class="summary__lead">
          <p>
            <Show when={sum().stale.length > 0} fallback={t("artifacts.summary.noStale", { days: STALE_DAYS })}>
              <strong>
                {t("artifacts.summary.stale", {
                  count: sum().stale.length,
                  days: STALE_DAYS,
                  size: bytes(sum().staleBytes),
                  percent: formatPercent(sum().staleBytes / Math.max(1, sum().liveBytes), i18n.number),
                })}
              </strong>{" "}
              <Show when={sum().stale[0]}>
                {(a) => t("artifacts.summary.largest", { name: a().name, repo: a().repo.name, size: bytes(a().sizeInBytes) })}
              </Show>
            </Show>
          </p>
          <Show when={sum().stale.length > 0}>
            <button type="button" class="button button--primary" onClick={() => s.selectStale()}>
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
            <dd class="kpi__value">{i18n.number(s.artifacts().length)}</dd>
            <dd class="kpi__note">{t("artifacts.kpi.listedNote", { count: sum().expiredCount })}</dd>
          </div>
          <div>
            <dt>{t("artifacts.kpi.repos")}</dt>
            <dd class="kpi__value">{i18n.number(sum().reposWithArtifacts)}</dd>
            <dd class="kpi__note">{t("artifacts.kpi.reposNote", { count: props.ws.selectedRepos().length })}</dd>
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

  function Bar() {
    const sel = () => s.selectionSummary();
    const del = () => s.bulkDelete.state();
    const noticeText = () => {
      const n = s.notice();
      if (!n) return "";
      switch (n.kind) {
        case "deleted":
          return t("artifacts.deleted", { count: n.count });
        case "deleteFailed":
          return `${t("artifacts.deleteFailed", { count: n.count })} ${errorText(t, n.errors[0])}`;
        case "downloadStarted":
          return t("artifacts.downloadStarted", { count: n.count });
        case "downloadFailed":
          return t("artifacts.downloadFailed", { name: n.name, reason: downloadFailureText(t, n.reason) });
        case "error":
          return errorText(t, n.error);
      }
    };
    const failedDelete = () => {
      const n = s.notice();
      return n?.kind === "deleteFailed" ? n : null;
    };
    const label = () => t("artifacts.selection", { count: sel().count });
    return (
      <Switch>
        <Match when={del().phase === "confirm"}>
          <BulkBar
            tone="danger"
            label={label()}
            text={
              <>
                <Icon name="warning" />
                {t("artifacts.confirmDelete", { count: sel().count, size: bytes(sel().bytes) })}
              </>
            }
            actions={
              <>
                <button type="button" class="button" onClick={() => s.bulkDelete.cancel()}>
                  {t("action.cancel")}
                </button>
                <button type="button" class="button button--danger-solid" onClick={() => void s.bulkDelete.run()}>
                  {t("artifacts.confirmDeleteButton")}
                </button>
              </>
            }
          />
        </Match>
        <Match when={del().phase === "deleting" && del()} keyed>
          {(d) => d.phase === "deleting" && <BulkBar tone="info" label={label()} text={t("artifacts.deleting", { done: d.done, total: d.total })} />}
        </Match>
        <Match when={sel().count > 0}>
          <BulkBar
            tone="info"
            label={label()}
            text={
              <>
                <strong>{t("artifacts.selection", { count: sel().count })}</strong>
                <span class="muted">
                  {" · "}
                  {bytes(sel().bytes)} · {t("artifacts.selectionFrom", { count: sel().repoCount })}
                </span>
                <Show when={s.notice()}>
                  <span class="muted"> — {noticeText()}</span>
                </Show>
              </>
            }
            actions={
              <>
                <button type="button" class="button button--primary" onClick={() => void s.download(s.selection.selected())}>
                  <Icon name="download" />
                  {t("artifacts.downloadSelected", { count: sel().count })}
                </button>
                <button type="button" class="button button--danger" onClick={() => s.bulkDelete.ask()}>
                  <Icon name="trash" />
                  {t("artifacts.deleteSelected", { count: sel().count })}
                </button>
                <button type="button" class="button button--ghost" onClick={() => s.selection.clear()}>
                  {t("action.clear")}
                </button>
              </>
            }
          />
        </Match>
        <Match when={s.notice()}>
          <BulkBar
            tone={["deleteFailed", "downloadFailed", "error"].includes(s.notice()?.kind ?? "") ? "warn" : "info"}
            label={label()}
            text={noticeText()}
            actions={
              <button type="button" class="button button--ghost" onClick={() => s.dismissNotice()}>
                {t("action.close")}
              </button>
            }
            detail={<Show when={failedDelete()}>{(n) => <PermissionHint error={n().errors[0]} operation="artifacts.delete" />}</Show>}
          />
        </Match>
      </Switch>
    );
  }

  function Row(p: { artifact: Artifact }) {
    const a = p.artifact;
    const expired = () => isExpired(a, s.results.now());
    const expiry = () => expiryState(a, s.results.now());
    return (
      <tr classList={{ "row--selected": s.selection.isSelected(a.id), "row--expired": expired() }}>
        <td class="col-check">
          <input type="checkbox" aria-label={a.name} checked={s.selection.isSelected(a.id)} onChange={() => s.selection.toggle(a.id)} />
        </td>
        <td class="mono cell-name" title={a.name}>
          {a.name}
        </td>
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
            onClick={() => void s.download([a])}
          >
            <Icon name="download" label={t("artifacts.download", { name: a.name })} />
          </button>
        </td>
      </tr>
    );
  }
}

import { For, Match, Show, Switch } from "solid-js";
import { daysSinceUsed, refLabel, UNUSED_DAYS, type ActionsCache } from "../../../features/caches/cache";
import { repoKey } from "../../../features/workspace/repository";
import { useUi } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { Failures } from "../../components/Failures";
import { Icon } from "../../components/Icon";
import { PermissionHint } from "../../components/PermissionHint";
import { errorText } from "../../errors";
import { formatBytes, formatDate } from "../../format";
import { BulkBar } from "../../lists/BulkBar";
import { SelectAll } from "../../lists/SelectAll";
import { SortHeader } from "../../lists/SortHeader";
import { UsageByRepo } from "../../lists/UsageByRepo";
import "../../lists/lists.css";
import type { CachesState } from "./state";

export function CachesScreen(props: { state: CachesState; ws: WorkspaceState }) {
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
        <section class="summary">
          <div class="summary__lead">
            <div>
              <p>
                <strong>{t("caches.summary", { count: s.summary().count, size: bytes(s.summary().totalBytes), repos: s.summary().repos })}</strong>
              </p>
              <p class="muted small">{t("caches.summaryNote")}</p>
            </div>
            <div class="summary__actions">
              <Show when={s.summary().pullRequest.length > 0}>
                <button type="button" class="button button--primary" onClick={() => s.selectOnly(s.summary().pullRequest)}>
                  {t("caches.selectPr", { count: s.summary().pullRequest.length, size: bytes(s.summary().pullRequestBytes) })}
                </button>
              </Show>
              <Show when={s.summary().unused.length > 0}>
                <button type="button" class="button" onClick={() => s.selectOnly(s.summary().unused)}>
                  {t("caches.selectUnused", { count: s.summary().unused.length, days: UNUSED_DAYS, size: bytes(s.summary().unusedBytes) })}
                </button>
              </Show>
            </div>
          </div>
        </section>

        <Failures
          title={t("failures.title", { count: s.results.failures().length })}
          items={s.results.failures().map((f) => ({ key: String(f.repo.id), label: f.repo.fullName, error: f.error }))}
          operation="caches.list"
        />

        <div class="filters" role="search">
          <label class="field field--grow">
            <span class="field__label">{t("artifacts.filter.repo")}</span>
            <input type="search" value={s.filter.repoQuery} placeholder={t("artifacts.filter.repoPlaceholder")} onInput={(e) => s.setFilter("repoQuery", e.currentTarget.value)} />
          </label>
          <label class="field">
            <span class="field__label">{t("caches.filter.ref")}</span>
            <input type="search" value={s.filter.refQuery} placeholder={t("caches.filter.refPlaceholder")} onInput={(e) => s.setFilter("refQuery", e.currentTarget.value)} />
          </label>
          <label class="field">
            <span class="field__label">{t("caches.filter.unusedFor")}</span>
            <input type="number" min="0" inputmode="numeric" value={s.filter.unusedForDays ?? ""} onInput={(e) => s.setFilter("unusedForDays", num(e.currentTarget.value))} />
            <span class="field__unit">{t("artifacts.filter.days")}</span>
          </label>
          <label class="field">
            <span class="field__label">{t("artifacts.filter.minSize")}</span>
            <input type="number" min="0" inputmode="decimal" value={s.filter.minSizeMB ?? ""} onInput={(e) => s.setFilter("minSizeMB", num(e.currentTarget.value))} />
            <span class="field__unit">MB</span>
          </label>
        </div>

        <Bar />

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="col-check">
                  <SelectAll total={s.visible().length} selected={s.selection.selected().length} onChange={(v) => s.selection.setMany(s.visible(), v)} />
                </th>
                {sortHeader("key", t("caches.col.key"))}
                {sortHeader("repo", t("artifacts.col.repository"))}
                {sortHeader("ref", t("caches.col.ref"))}
                {sortHeader("size", t("artifacts.col.size"), true)}
                {sortHeader("lastUsed", t("caches.col.lastUsed"))}
                {sortHeader("created", t("artifacts.col.created"))}
              </tr>
            </thead>
            <tbody>
              <For each={s.visible()}>{(c) => <Row cache={c} />}</For>
            </tbody>
          </table>
          <Show when={!s.results.progress() && !props.ws.loading() && s.visible().length === 0}>
            <p class="empty">{s.caches().length === 0 ? t("caches.noneAtAll") : t("caches.empty")}</p>
          </Show>
        </div>
      </div>
      <UsageByRepo
        rows={s.summary().byRepo}
        title={t("artifacts.byRepo.title")}
        note={t("caches.byRepo.note")}
        countLabel={(count) => t("caches.byRepo.count", { count })}
      />
    </div>
  );

  function Bar() {
    const sel = () => s.selectionSummary();
    const del = () => s.bulkDelete.state();
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
                {t("caches.confirmDelete", { count: sel().count, size: bytes(sel().bytes) })}
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
              </>
            }
            actions={
              <>
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
        <Match when={s.notice()} keyed>
          {(n) => (
            <BulkBar
              tone={n.kind === "deleteFailed" ? "warn" : "info"}
              label={label()}
              text={
                n.kind === "deleted"
                  ? t("caches.deleted", { count: n.count, size: bytes(n.bytes) })
                  : `${t("caches.deleteFailed", { count: n.count })} ${errorText(t, n.errors[0])}`
              }
              actions={
                <button type="button" class="button button--ghost" onClick={() => s.dismissNotice()}>
                  {t("action.close")}
                </button>
              }
              detail={n.kind === "deleteFailed" ? <PermissionHint error={n.errors[0]} operation="caches.delete" /> : undefined}
            />
          )}
        </Match>
      </Switch>
    );
  }

  function Row(p: { cache: ActionsCache }) {
    const c = p.cache;
    const days = () => daysSinceUsed(c, s.results.now());
    return (
      <tr classList={{ "row--selected": s.selection.isSelected(c.id) }}>
        <td class="col-check">
          <input type="checkbox" aria-label={c.key} checked={s.selection.isSelected(c.id)} onChange={() => s.selection.toggle(c.id)} />
        </td>
        <td class="mono cell-name" title={c.key}>
          {c.key}
        </td>
        <td class="cell-repo">
          <a href={`https://github.com/${repoKey(c.repo)}/actions/caches`} target="_blank" rel="noreferrer">
            <span class="muted">{c.repo.owner}/</span>
            {c.repo.name}
          </a>
        </td>
        <td class="mono muted cell-branch" title={c.ref}>
          {refLabel(c.ref)}
        </td>
        <td class="num">{bytes(c.sizeInBytes)}</td>
        <td class="num-date">
          {formatDate(c.lastAccessedAt) ?? "—"}
          <Show when={days() !== null}>
            <span class="muted"> · {days()! <= 0 ? t("caches.today") : t("caches.daysAgo", { days: days()! })}</span>
          </Show>
        </td>
        <td class="num-date">{formatDate(c.createdAt) ?? "—"}</td>
      </tr>
    );
  }
}

import { createEffect, createMemo, For, Match, Show, Switch } from "solid-js";
import type { ActionsCache } from "../../api/types";
import { repoKey } from "../../domain/artifacts";
import { daysSinceUsed, refLabel, UNUSED_DAYS, type CacheSortKey } from "../../domain/caches";
import { formatBytes, formatDate } from "../../domain/format";
import { Failures } from "../components/Failures";
import { Icon } from "../components/Icon";
import { PermissionHint } from "../components/PermissionHint";
import { errorText } from "../errors";
import type { CachesState } from "../state/caches";
import { useDeps } from "../state/context";
import type { WorkspaceState } from "../state/workspace";

export function CachesView(props: { state: CachesState; ws: WorkspaceState }) {
  const { i18n } = useDeps();
  const { t } = i18n;
  const s = props.state;
  const bytes = (n: number) => formatBytes(n, i18n.number);
  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Math.max(0, Number(v)));

  return (
    <div class="artifacts">
      <div class="artifacts__main">
        <section class="summary">
          <div class="summary__lead">
            <div>
              <p>
                <strong>
                  {t("caches.summary", { count: s.summary().count, size: bytes(s.summary().totalBytes), repos: s.summary().repos })}
                </strong>
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
                  {t("caches.selectUnused", {
                    count: s.summary().unused.length,
                    days: UNUSED_DAYS,
                    size: bytes(s.summary().unusedBytes),
                  })}
                </button>
              </Show>
            </div>
          </div>
        </section>

        <Failures
          title={t("failures.title", { count: s.failures().length })}
          items={s.failures().map((f) => ({ key: String(f.repo.id), label: f.repo.fullName, error: f.error }))}
          operation="caches.list"
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
            <span class="field__label">{t("caches.filter.ref")}</span>
            <input
              type="search"
              value={s.filter.refQuery}
              placeholder={t("caches.filter.refPlaceholder")}
              onInput={(e) => s.setFilter("refQuery", e.currentTarget.value)}
            />
          </label>
          <label class="field">
            <span class="field__label">{t("caches.filter.unusedFor")}</span>
            <input
              type="number"
              min="0"
              inputmode="numeric"
              value={s.filter.unusedForDays ?? ""}
              onInput={(e) => s.setFilter("unusedForDays", num(e.currentTarget.value))}
            />
            <span class="field__unit">{t("artifacts.filter.days")}</span>
          </label>
          <label class="field">
            <span class="field__label">{t("artifacts.filter.minSize")}</span>
            <input
              type="number"
              min="0"
              inputmode="decimal"
              value={s.filter.minSizeMB ?? ""}
              onInput={(e) => s.setFilter("minSizeMB", num(e.currentTarget.value))}
            />
            <span class="field__unit">MB</span>
          </label>
        </div>

        <BulkBar />

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th class="col-check">
                  <SelectAll />
                </th>
                <SortHeader key="key" label={t("caches.col.key")} />
                <SortHeader key="repo" label={t("artifacts.col.repository")} />
                <SortHeader key="ref" label={t("caches.col.ref")} />
                <SortHeader key="size" label={t("artifacts.col.size")} numeric />
                <SortHeader key="lastUsed" label={t("caches.col.lastUsed")} />
                <SortHeader key="created" label={t("artifacts.col.created")} />
              </tr>
            </thead>
            <tbody>
              <For each={s.visible()}>{(c) => <Row cache={c} />}</For>
            </tbody>
          </table>
          <Show when={!s.progress() && !props.ws.loading() && s.visible().length === 0}>
            <p class="empty">{s.caches().length === 0 ? t("caches.noneAtAll") : t("caches.empty")}</p>
          </Show>
        </div>
      </div>
      <ByRepo />
    </div>
  );

  function BulkBar() {
    const sel = () => s.selectionSummary();
    const notice = () => s.notice();
    return (
      <Show when={sel().count > 0 || s.deleteState().phase !== "idle" || notice()}>
        <div
          class="bulkbar"
          classList={{
            "bulkbar--danger": s.deleteState().phase === "confirm",
            "bulkbar--warn": sel().count === 0 && notice()?.kind === "deleteFailed",
          }}
          role="region"
          aria-label={t("artifacts.selection", { count: sel().count })}
        >
          <Switch>
            <Match when={s.deleteState().phase === "confirm"}>
              <span class="bulkbar__text">
                <Icon name="warning" />
                {t("caches.confirmDelete", { count: sel().count, size: bytes(sel().bytes) })}
              </span>
              <div class="bulkbar__actions">
                <button type="button" class="button" onClick={() => s.cancelDelete()}>
                  {t("action.cancel")}
                </button>
                <button type="button" class="button button--danger-solid" onClick={() => void s.deleteSelection()}>
                  {t("artifacts.confirmDeleteButton")}
                </button>
              </div>
            </Match>
            <Match when={s.deleteState().phase === "deleting" && s.deleteState()} keyed>
              {(d) =>
                d.phase === "deleting" && (
                  <span class="bulkbar__text" role="status">
                    {t("artifacts.deleting", { done: d.done, total: d.total })}
                  </span>
                )
              }
            </Match>
            <Match when={sel().count > 0}>
              <span class="bulkbar__text" role="status">
                <strong>{t("artifacts.selection", { count: sel().count })}</strong>
                <span class="muted">
                  {" · "}
                  {bytes(sel().bytes)} · {t("artifacts.selectionFrom", { count: sel().repoCount })}
                </span>
              </span>
              <div class="bulkbar__actions">
                <button type="button" class="button button--danger" onClick={() => s.askDelete()}>
                  <Icon name="trash" />
                  {t("artifacts.deleteSelected", { count: sel().count })}
                </button>
                <button type="button" class="button button--ghost" onClick={() => s.clearSelection()}>
                  {t("action.clear")}
                </button>
              </div>
            </Match>
            <Match when={notice()} keyed>
              {(n) => (
                <>
                  <span class="bulkbar__text" role="status">
                    {n.kind === "deleted"
                      ? t("caches.deleted", { count: n.count, size: bytes(n.bytes) })
                      : `${t("caches.deleteFailed", { count: n.count })} ${errorText(t, n.errors[0]!)}`}
                  </span>
                  <div class="bulkbar__actions">
                    <button type="button" class="button button--ghost" onClick={() => s.dismissNotice()}>
                      {t("action.close")}
                    </button>
                  </div>
                  <Show when={n.kind === "deleteFailed" ? n : null}>
                    {(f) => (
                      <div class="bulkbar__detail">
                        <PermissionHint error={f().errors[0]!} operation="caches.delete" />
                      </div>
                    )}
                  </Show>
                </>
              )}
            </Match>
          </Switch>
        </div>
      </Show>
    );
  }

  function SelectAll() {
    const all = createMemo(() => s.visible().length > 0 && s.selection().length === s.visible().length);
    const some = createMemo(() => s.selection().length > 0 && !all());
    return (
      <input
        type="checkbox"
        aria-label="Select all"
        checked={all()}
        ref={(el) => createEffect(() => (el.indeterminate = some()))}
        onChange={(e) => s.setMany(s.visible(), e.currentTarget.checked)}
      />
    );
  }

  function SortHeader(p: { key: CacheSortKey; label: string; numeric?: boolean }) {
    const dir = () => (s.sort().key === p.key ? s.sort().dir : null);
    return (
      <th class={p.numeric ? "num" : undefined} aria-sort={dir() === "asc" ? "ascending" : dir() === "desc" ? "descending" : undefined}>
        <button type="button" class="sort" onClick={() => s.toggleSort(p.key)}>
          {p.label}
          <span class="sort__arrow" aria-hidden="true">
            {dir() === "asc" ? "↑" : dir() === "desc" ? "↓" : ""}
          </span>
        </button>
      </th>
    );
  }

  function Row(p: { cache: ActionsCache }) {
    const c = p.cache;
    const days = () => daysSinceUsed(c, s.now());
    return (
      <tr classList={{ "row--selected": s.isSelected(c.id) }}>
        <td class="col-check">
          <input type="checkbox" aria-label={c.key} checked={s.isSelected(c.id)} onChange={() => s.toggle(c.id)} />
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

  function ByRepo() {
    const rows = () => s.summary().byRepo.slice(0, 12);
    const max = () => rows()[0]?.bytes ?? 1;
    return (
      <Show when={rows().length > 0}>
        <aside class="byrepo" aria-labelledby="caches-byrepo-title">
          <h2 id="caches-byrepo-title">{t("artifacts.byRepo.title")}</h2>
          <p class="muted small">{t("caches.byRepo.note")}</p>
          <ol>
            <For each={rows()}>
              {(r) => (
                <li>
                  <div class="byrepo__line">
                    <span class="byrepo__name" title={r.key}>
                      {r.repo.name}
                    </span>
                    <span class="mono">{bytes(r.bytes)}</span>
                  </div>
                  <span class="byrepo__bar" style={{ width: `${(r.bytes / max()) * 100}%` }} />
                  <div class="muted small">
                    {r.repo.owner} · {t("caches.byRepo.count", { count: r.count })}
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

import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js";
import { changedFields, labelKey, readLabelName, type LabelField, type LabelValue } from "../../../features/labels/label";
import { cellStatus, renameTarget, type LabelChange, type LabelRow } from "../../../features/labels/sync";
import { repoKey } from "../../../features/workspace/repository";
import { useUi } from "../../app/context";
import { Failures } from "../../components/Failures";
import { Icon } from "../../components/Icon";
import { PermissionHint } from "../../components/PermissionHint";
import { errorText } from "../../errors";
import { BulkBar } from "../../lists/BulkBar";
import { SelectAll } from "../../lists/SelectAll";
import "./labels.css";
import type { LabelsState } from "./state";

/** 背景の色に合わせて、読みやすい文字の色（黒か白）を選ぶ */
function textOn(hex: string): string {
  const n = Number.parseInt(hex.slice(0, 6), 16);
  if (Number.isNaN(n)) return "#000";
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1f2328" : "#ffffff";
}

function Pill(props: { value: LabelValue }) {
  return (
    <span class="label-pill" style={{ background: `#${props.value.color}`, color: textOn(props.value.color) }} title={props.value.description || undefined}>
      {props.value.name}
    </span>
  );
}

/** ラベルのそろえ込み。行はラベル（大文字と小文字を区別しない名前）、列はリポジトリ */
export function LabelsScreen(props: { state: LabelsState }) {
  const { i18n } = useUi();
  const { t } = i18n;
  const s = props.state;
  const fieldNames = (fields: readonly LabelField[]) => fields.map((f) => t(`labels.field.${f}`)).join(t("labels.field.separator"));
  const busy = () => s.phase().phase !== "idle";

  function changeText(c: LabelChange): string {
    const repo = repoKey(c.repo);
    if (c.kind === "create") return t("labels.plan.create", { name: c.next.name, repo });
    if (labelKey(c.current.name) !== labelKey(c.next.name)) return t("labels.plan.rename", { name: c.current.name, to: c.next.name, repo });
    return t("labels.plan.update", { name: c.current.name, repo, fields: fieldNames(c.fields) });
  }

  function RowHeader(p: { row: LabelRow }) {
    const [editing, setEditing] = createSignal(false);
    const [draft, setDraft] = createSignal("");
    const [error, setError] = createSignal<"empty" | "tooLong" | null>(null);
    const target = () => renameTarget(p.row, s.edit(p.row));
    const ref = () => s.reference(p.row);
    const start = () => {
      setDraft(s.edit(p.row)?.renameTo ?? ref().name);
      setError(null);
      setEditing(true);
    };
    const renamed = () => s.edit(p.row)?.renameTo !== undefined;
    const commit = () => {
      const r = readLabelName(draft());
      if (!r.ok) return setError(r.reason);
      if (r.name !== ref().name) s.setRename(p.row.key, r.name);
      setEditing(false);
    };
    return (
      <th scope="row" class="labels__name">
        <div class="labels__name-line">
          <input
            type="checkbox"
            aria-label={t("labels.select", { name: ref().name })}
            checked={s.isSelected(p.row.key)}
            disabled={busy()}
            onChange={() => s.toggle(p.row.key)}
          />
          <Pill value={ref()} />
          <Show when={target()}>
            {(to) => (
              <span class="labels__rename-to">
                → <strong>{to()}</strong>
              </span>
            )}
          </Show>
          <Show when={renamed()}>
            <button type="button" class="icon-button" title={t("labels.undoRename")} aria-label={t("labels.undoRename")} disabled={busy()} onClick={() => s.setRename(p.row.key, undefined)}>
              <Icon name="x" size={12} />
            </button>
          </Show>
          <Show when={!editing() && !renamed()}>
            <button type="button" class="button button--ghost button--small labels__rename" disabled={busy()} onClick={start}>
              {t("labels.rename")}
            </button>
          </Show>
        </div>
        <Show when={ref().description}>
          <div class="labels__desc muted small">{ref().description}</div>
        </Show>
        <Show when={editing()}>
          <form
            class="labels__rename-form"
            onSubmit={(e) => {
              e.preventDefault();
              commit();
            }}
          >
            <input
              type="text"
              class="mono"
              aria-label={t("labels.renameTo")}
              list="labels-names"
              value={draft()}
              maxLength={60}
              onInput={(e) => setDraft(e.currentTarget.value)}
              ref={(el) => queueMicrotask(() => el.select())}
            />
            <button type="submit" class="button button--small button--primary">
              {t("labels.renameApply")}
            </button>
            <button type="button" class="button button--small" onClick={() => setEditing(false)}>
              {t("action.cancel")}
            </button>
            <Show when={error()}>{(e) => <span class="error small">{t(`labels.renameError.${e()}`)}</span>}</Show>
          </form>
        </Show>
      </th>
    );
  }

  function Row(p: { row: LabelRow }) {
    const ref = () => s.reference(p.row);
    return (
      <tr classList={{ "row--selected": s.isSelected(p.row.key) }}>
        <RowHeader row={p.row} />
        <For each={p.row.cells}>
          {(cell, i) => {
            const column = () => s.table().columns[i()]!;
            const status = () => cellStatus(cell, ref());
            const isRef = () => s.edit(p.row)?.reference === column().key;
            return (
              <td class={`labels__cell labels__cell--${status()}`} classList={{ "labels__cell--reference": isRef() }}>
                <Show
                  when={cell}
                  fallback={
                    <>
                      <span aria-hidden="true">–</span>
                      <span class="visually-hidden">{t("labels.state.missing")}</span>
                    </>
                  }
                >
                  {(c) => (
                    <button
                      type="button"
                      class="labels__cell-button"
                      aria-pressed={isRef()}
                      disabled={busy()}
                      title={`${c().name} · #${c().color}${c().description ? `\n${c().description}` : ""}\n${t("labels.useAsReference", { repo: column().key })}`}
                      onClick={() => s.toggleReference(p.row.key, column().key)}
                    >
                      <span class="labels__swatch" style={{ background: `#${c().color}` }} aria-hidden="true" />
                      <Show when={status() === "differs"}>
                        <span class="labels__diff">{fieldNames(changedFields(c(), ref()))}</span>
                      </Show>
                      <Show when={isRef()}>
                        <span class="labels__ref-mark">{t("labels.state.reference")}</span>
                      </Show>
                      <span class="visually-hidden">{t(`labels.state.${status()}`)}</span>
                    </button>
                  )}
                </Show>
              </td>
            );
          }}
        </For>
      </tr>
    );
  }

  const searchUrl = (repo: string, name: string) =>
    `https://github.com/search?type=issues&q=${encodeURIComponent(`repo:${repo} label:"${name}"`)}`;

  function ActionBar() {
    const label = () => t("labels.selection", { count: s.selectedCount() });
    const deleteCount = () => s.toDelete().length;
    const deleteRepos = () => new Set(s.toDelete().map((l) => repoKey(l.repo))).size;
    return (
      <Switch>
        <Match when={s.phase().phase === "deleteWarn"}>
          <BulkBar
            tone="danger"
            label={label()}
            text={
              <>
                <Icon name="warning" />
                {t("labels.deleteWarn.title", { count: deleteCount(), repos: t("labels.repoCount", { count: deleteRepos() }) })}
              </>
            }
            actions={
              <>
                <button type="button" class="button" onClick={() => s.cancel()}>
                  {t("action.cancel")}
                </button>
                <button type="button" class="button button--danger" onClick={() => s.acknowledgeDelete()}>
                  {t("labels.deleteWarn.ok")}
                </button>
              </>
            }
            detail={
              <div class="labels__delete">
                <p class="labels__delete-body">{t("labels.deleteWarn.body")}</p>
                <ul class="labels__plan">
                  <For each={s.toDelete()}>
                    {(l) => (
                      <li>
                        {t("labels.deleteItem", { name: l.name, repo: repoKey(l.repo) })}{" "}
                        <a class="small" href={searchUrl(repoKey(l.repo), l.name)} target="_blank" rel="noreferrer">
                          {t("labels.deleteLink")}
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            }
          />
        </Match>
        <Match when={s.phase().phase === "deleteConfirm"}>
          <BulkBar
            tone="danger"
            label={label()}
            text={
              <>
                <Icon name="warning" />
                {t("labels.deleteConfirm.title")}
              </>
            }
            detail={
              <form
                class="labels__delete"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (s.canDelete()) void s.remove();
                }}
              >
                <p class="labels__delete-body">
                  {t("labels.deleteConfirm.body")} {t("labels.deleteConfirm.type")}
                </p>
                <div class="labels__delete-confirm">
                  <input
                    type="text"
                    class="mono"
                    aria-label={t("labels.deleteConfirm.type")}
                    autocomplete="off"
                    spellcheck={false}
                    value={s.deleteWord()}
                    onInput={(e) => s.setDeleteWord(e.currentTarget.value)}
                    ref={(el) => queueMicrotask(() => el.focus())}
                  />
                  <button type="submit" class="button button--danger-solid" disabled={!s.canDelete()}>
                    <Icon name="trash" />
                    {t("labels.deleteConfirm.button", { count: deleteCount() })}
                  </button>
                  <button type="button" class="button" onClick={() => s.cancel()}>
                    {t("action.cancel")}
                  </button>
                </div>
              </form>
            }
          />
        </Match>
        <Match when={s.phase().phase === "confirm"}>
          <BulkBar
            tone="danger"
            label={label()}
            text={
              <>
                <Icon name="warning" />
                {t("labels.confirm", { count: s.plan().changes.length })}
              </>
            }
            actions={
              <>
                <button type="button" class="button" onClick={() => s.cancel()}>
                  {t("action.cancel")}
                </button>
                <button type="button" class="button button--danger-solid" onClick={() => void s.apply()}>
                  {t("labels.apply", { count: s.plan().changes.length })}
                </button>
              </>
            }
            detail={
              <ul class="labels__plan">
                <For each={s.plan().changes}>{(c) => <li>{changeText(c)}</li>}</For>
                <For each={s.plan().skipped}>
                  {(k) => <li class="labels__plan-skip">{t("labels.plan.skip", { name: k.current.name, to: k.target, repo: repoKey(k.repo) })}</li>}
                </For>
              </ul>
            }
          />
        </Match>
        <Match when={s.phase().phase === "applying" && s.phase()} keyed>
          {(ph) => ph.phase === "applying" && <BulkBar tone="info" label={label()} text={t("labels.applying", { done: ph.done, total: ph.total })} />}
        </Match>
        <Match when={s.phase().phase === "deleting" && s.phase()} keyed>
          {(ph) => ph.phase === "deleting" && <BulkBar tone="danger" label={label()} text={t("labels.deleting", { done: ph.done, total: ph.total })} />}
        </Match>
        <Match when={s.selectedCount() > 0}>
          <BulkBar
            tone="info"
            label={label()}
            text={
              <>
                <strong>{label()}</strong>
                <label class="labels__option">
                  <input type="checkbox" checked={s.add()} onChange={(e) => s.setAdd(e.currentTarget.checked)} />
                  {t("labels.add")}
                </label>
                <label class="labels__option">
                  <input type="checkbox" checked={s.update()} onChange={(e) => s.setUpdate(e.currentTarget.checked)} />
                  {t("labels.update")}
                </label>
                <Show when={s.targetCount() === 0}>
                  <span class="labels__no-targets">{t("labels.noTargets")}</span>
                </Show>
              </>
            }
            actions={
              <>
                <button type="button" class="button button--primary" disabled={s.plan().changes.length === 0} onClick={() => s.review()}>
                  {s.plan().changes.length === 0 ? t("labels.noChanges") : t("labels.review", { count: s.plan().changes.length })}
                </button>
                <button type="button" class="button button--danger" disabled={s.deletable().length === 0} onClick={() => s.askDelete()}>
                  <Icon name="trash" />
                  {t("labels.delete")}
                </button>
                <button type="button" class="button button--ghost" onClick={() => s.clearSelection()}>
                  {t("action.clear")}
                </button>
              </>
            }
          />
        </Match>
        <Match when={s.notice()} keyed>
          {(n) => (
            <BulkBar
              tone={n.kind === "failed" || n.kind === "deleteFailed" ? "warn" : "info"}
              label={t("tab.labels")}
              text={
                n.kind === "applied"
                  ? t("labels.applied", { count: n.count })
                  : n.kind === "deleted"
                    ? t("labels.deleted", { count: n.count })
                    : n.kind === "failed"
                      ? `${t("labels.applyFailed", { count: n.count, total: n.total })} ${errorText(t, n.errors[0])}`
                      : `${t("labels.deleteFailed", { count: n.count, total: n.total })} ${errorText(t, n.errors[0])}`
              }
              actions={
                <button type="button" class="button button--ghost" onClick={() => s.dismissNotice()}>
                  {t("action.close")}
                </button>
              }
              detail={
                n.kind === "failed" ? (
                  <PermissionHint error={n.errors[0]} operation="labels.write" />
                ) : n.kind === "deleteFailed" ? (
                  <div class="labels__delete">
                    <p class="labels__delete-body">{t("labels.remaining")}</p>
                    <ul class="labels__plan">
                      <For each={n.remaining}>{(l) => <li>{t("labels.deleteItem", { name: l.name, repo: repoKey(l.repo) })}</li>}</For>
                    </ul>
                    <PermissionHint error={n.errors[0]} operation="labels.write" />
                  </div>
                ) : undefined
              }
            />
          )}
        </Match>
      </Switch>
    );
  }

  return (
    <div class="labels">
      <div class="filters" role="search">
        <label class="field field--grow">
          <span class="field__label">{t("labels.filter.text")}</span>
          <input type="search" value={s.text()} placeholder={t("labels.filter.textPlaceholder")} onInput={(e) => s.setText(e.currentTarget.value)} />
        </label>
        <label class="labels__option labels__option--filter">
          <input type="checkbox" checked={s.diffOnly()} onChange={(e) => s.setDiffOnly(e.currentTarget.checked)} />
          {t("labels.diffOnly")}
        </label>
        <p class="labels__count" role="status">
          <strong>{t("labels.count", { count: s.rows().length })}</strong>{" "}
          <span class="muted">{t("labels.diffCount", { count: s.diffCount() })}</span>
        </p>
      </div>
      <p class="muted small labels__note">{t("labels.note")}</p>
      <ul class="labels__legend small" aria-label={t("labels.legend")}>
        <For each={["same", "differs", "missing"] as const}>
          {(state) => (
            <li>
              <span class={`labels__key labels__cell--${state}`} aria-hidden="true">
                {state === "missing" ? "–" : <span class="labels__swatch" style={{ background: "#d73a4a" }} />}
              </span>
              {t(`labels.state.${state}`)}
            </li>
          )}
        </For>
      </ul>

      <Failures
        title={t("failures.title", { count: s.results.failures().length })}
        items={s.results.failures().map((f) => ({ key: f.repo.fullName, label: f.repo.fullName, error: f.error }))}
        operation="labels.list"
      />

      <div class="labels__targets">
        <label class="labels__option">
          <input
            type="checkbox"
            checked={s.table().columns.length > 0 && s.targetCount() === s.table().columns.length}
            disabled={busy() || s.table().columns.length === 0}
            ref={(el) => createEffect(() => (el.indeterminate = s.targetCount() > 0 && s.targetCount() < s.table().columns.length))}
            onChange={(e) => s.setAllTargets(e.currentTarget.checked)}
          />
          {t("labels.targets.all")}
        </label>
        <span class="muted small">{t("labels.targets.count", { count: s.targetCount(), total: s.table().columns.length })}</span>
      </div>

      <ActionBar />

      <datalist id="labels-names">
        <For each={s.table().rows}>{(row) => <option value={s.reference(row).name} />}</For>
      </datalist>

      <Show when={s.rows().length > 0}>
        <div class="table-wrap labels__wrap">
          <table class="table table--labels">
            <thead>
              <tr>
                <th scope="col" class="labels__name">
                  <div class="labels__name-line">
                    <SelectAll total={s.rows().length} selected={s.selectedShown()} disabled={busy()} onChange={(c) => s.selectShown(c)} />
                    {t("labels.col.label")}
                  </div>
                </th>
                <For each={s.table().columns}>
                  {(column) => (
                    <th scope="col" class="labels__repo" classList={{ "labels__repo--off": !s.isTarget(column.key) }}>
                      <div class="labels__repo-line">
                        <input
                          type="checkbox"
                          aria-label={t("labels.targets.repo", { repo: column.key })}
                          checked={s.isTarget(column.key)}
                          disabled={busy()}
                          onChange={() => s.toggleTarget(column.key)}
                        />
                        <a href={`https://github.com/${column.key}/labels`} target="_blank" rel="noreferrer">
                          <span class="muted">{column.repo.owner}/</span>
                          {column.repo.name}
                        </a>
                      </div>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={s.rows()}>{(row) => <Row row={row} />}</For>
            </tbody>
          </table>
        </div>
      </Show>
      <Show when={!s.results.progress() && s.rows().length === 0}>
        <div class="table-wrap">
          <p class="empty">{s.table().rows.length > 0 && s.diffOnly() ? t("labels.allSame") : t("labels.empty")}</p>
        </div>
      </Show>
    </div>
  );
}

import { createMemo, createSignal, For, Index, Match, Show, Switch } from "solid-js";
import { adjacentStatus, columnsOf, countVisible, type Board, type Column } from "../../../features/projects/board";
import { ITEM_KINDS, projectKey, type Project, type ProjectItem } from "../../../features/projects/project";
import { useUi } from "../../app/context";
import { Avatar } from "../../components/Avatar";
import { Failures } from "../../components/Failures";
import { Icon } from "../../components/Icon";
import { PermissionHint } from "../../components/PermissionHint";
import { errorText } from "../../errors";
import { labelTextColor } from "../../format";
import "./kanban.css";
import type { KanbanState } from "./state";

/** ドラッグ中のカード。動かせるのは同じプロジェクトの列の間だけ */
interface Dragging {
  projectKey: string;
  itemId: number;
}

const columnKey = (column: Column) => column.option?.id ?? "";
const cardId = (project: Project, itemId: number) => `card-${projectKey(project).replace(/[^a-z0-9]/gi, "-")}-${itemId}`;

export function KanbanScreen(props: { state: KanbanState }) {
  const { i18n } = useUi();
  const { t } = i18n;
  const s = props.state;
  const [dragging, setDragging] = createSignal<Dragging | null>(null);
  const [over, setOver] = createSignal<string | null>(null);
  const [announcement, setAnnouncement] = createSignal("");

  const columnName = (board: Board, column: Column) =>
    column.option?.name ?? t("kanban.unset", { field: board.field?.name ?? "Status" });

  function moveTo(board: Board, item: ProjectItem, statusId: string | null) {
    const column = statusId === null ? null : (board.field?.options.find((o) => o.id === statusId) ?? null);
    void s.move(board.project, item.id, statusId);
    setAnnouncement(
      t("kanban.moved", {
        title: item.title ?? t("kanban.noAccess"),
        column: columnName(board, { option: column, items: [] }),
      }),
    );
  }

  const endDrag = () => {
    setDragging(null);
    setOver(null);
  };

  return (
    <div class="kanban">
      <div class="filters">
        <div class="chips" role="group" aria-label={t("kanban.kinds")}>
          <span class="field__label">{t("kanban.kinds")}</span>
          <For each={ITEM_KINDS}>
            {(kind) => (
              <button type="button" class="chip" aria-pressed={s.kinds().has(kind)} onClick={() => s.toggleKind(kind)}>
                <span class="chip__check" aria-hidden="true">
                  <Icon name="check" size={12} />
                </span>
                {t(`kanban.kind.${kind}`)}
              </button>
            )}
          </For>
        </div>
        <p class="muted small kanban__hint">{t("kanban.hint")}</p>
      </div>

      <Failures
        title={t("kanban.failures", { count: s.failures().length })}
        items={s.failures().map((f) => ({ key: f.owner.login, label: f.owner.login, error: f.error }))}
        operation="projects.list"
      />
      <Show when={s.moveFailure()}>
        {(f) => (
          <div class="notice notice--error" role="alert">
            <div>
              <p>{t("kanban.moveFailed", { title: f().title, reason: errorText(t, f().error) })}</p>
              <PermissionHint error={f().error} operation="projects.move" />
            </div>
            <button type="button" class="button button--ghost" onClick={() => s.dismissMoveFailure()}>
              {t("action.close")}
            </button>
          </div>
        )}
      </Show>
      <p class="visually-hidden" role="status">
        {announcement()}
      </p>

      <For each={s.projects()}>
        {(project) => {
          const bodyId = `board-${projectKey(project).replace(/[^a-z0-9]/gi, "-")}`;
          const entry = () => s.board(project);
          const expanded = () => !s.isCollapsed(project);
          const readyBoard = () => {
            const e = entry();
            return e?.status === "ready" ? e.board : undefined;
          };
          return (
            <section class="board" classList={{ "board--collapsed": !expanded() }}>
              <header class="board__head">
                <button
                  type="button"
                  class="board__toggle"
                  aria-expanded={expanded()}
                  aria-controls={bodyId}
                  onClick={() => s.toggleCollapsed(project)}
                >
                  <span class="board__chevron">
                    <Icon name="chevron" size={14} />
                  </span>
                  <Avatar src={project.owner.avatarUrl} login={project.owner.login} size={18} />
                  <span class="muted">{project.owner.login} /</span>
                  <strong>{project.title}</strong>
                  <Show when={readyBoard()}>
                    {(b) => <span class="board__count">{t("kanban.count", { count: countVisible(b(), s.kinds()) })}</span>}
                  </Show>
                </button>
                <a class="board__link" href={project.htmlUrl} target="_blank" rel="noreferrer" title={t("kanban.openOnGitHub")}>
                  <Icon name="external" size={14} label={t("kanban.openOnGitHub")} />
                </a>
              </header>

              <Show when={expanded()}>
                <div id={bodyId} class="board__body">
                  <Switch>
                    <Match when={entry() === undefined || entry()?.status === "loading"}>
                      <p class="muted small board__message">{t("kanban.loading")}</p>
                    </Match>
                    <Match when={entry()?.status === "error" && entry()} keyed>
                      {(e) =>
                        e.status === "error" && (
                          <div class="board__message">
                            <p class="error">{errorText(t, e.error)}</p>
                            <PermissionHint error={e.error} operation="projects.list" />
                          </div>
                        )
                      }
                    </Match>
                    {/* 盤面が差し替わっても列とカードを作り直さない（自動更新や移動の途中でもドラッグやフォーカスが切れない） */}
                    <Match when={readyBoard()}>{(b) => <BoardColumns board={b()} />}</Match>
                  </Switch>
                </div>
              </Show>
            </section>
          );
        }}
      </For>

      <Show when={!s.progress() && s.ownersLoaded() && s.projects().length === 0}>
        <p class="empty">{t("kanban.empty")}</p>
      </Show>
    </div>
  );

  function BoardColumns(p: { board: Board }) {
    const key = () => projectKey(p.board.project);
    const columns = createMemo(() => columnsOf(p.board, s.kinds()));
    const canMove = () => p.board.field !== null;
    const accepts = () => dragging()?.projectKey === key() && canMove();

    return (
      <>
        <Show when={!canMove()}>
          <p class="muted small board__message">{t("kanban.noField")}</p>
        </Show>
        <div class="columns">
          <Index each={columns()}>
            {(column) => {
              const overKey = () => `${key()}|${columnKey(column())}`;
              return (
                <div
                  class="column"
                  classList={{ "column--over": accepts() && over() === overKey() }}
                  role="group"
                  aria-label={columnName(p.board, column())}
                  onDragOver={(e) => {
                    if (!accepts()) return;
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                    setOver(overKey());
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over() === overKey()) setOver(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const d = accepts() ? dragging() : null;
                    endDrag();
                    const item = d ? p.board.items.find((i) => i.id === d.itemId) : undefined;
                    if (item) moveTo(p.board, item, column().option?.id ?? null);
                  }}
                >
                  <div class="column__head" title={column().option?.description ?? undefined}>
                    <span class="swatch" data-color={column().option?.color ?? "GRAY"} aria-hidden="true" />
                    <span class="column__name">{columnName(p.board, column())}</span>
                    <span class="column__count">{i18n.number(column().items.length)}</span>
                  </div>
                  <ul class="column__items">
                    <For each={column().items}>{(item) => <Card board={p.board} item={item} canMove={canMove()} />}</For>
                  </ul>
                </div>
              );
            }}
          </Index>
        </div>
      </>
    );
  }

  function Card(p: { board: Board; item: ProjectItem; canMove: boolean }) {
    const project = () => p.board.project;
    const movable = () => p.canMove && !s.isMoving(project(), p.item.id);
    const stateClass = () => (p.item.kind === "draft" ? "draft" : (p.item.state ?? "unknown"));

    return (
      <li
        id={cardId(project(), p.item.id)}
        class="card"
        classList={{
          "card--moving": s.isMoving(project(), p.item.id),
          "card--dragging": dragging()?.itemId === p.item.id && dragging()?.projectKey === projectKey(project()),
        }}
        draggable={movable()}
        tabIndex={p.canMove ? 0 : undefined}
        aria-keyshortcuts={p.canMove ? "ArrowLeft ArrowRight" : undefined}
        onDragStart={(e) => {
          if (!movable()) return e.preventDefault();
          e.dataTransfer?.setData("text/plain", String(p.item.id));
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          setDragging({ projectKey: projectKey(project()), itemId: p.item.id });
        }}
        onDragEnd={endDrag}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || !movable()) return;
          const next = adjacentStatus(p.board, p.item, e.key === "ArrowLeft" ? -1 : 1);
          if (next === undefined) return;
          e.preventDefault();
          const id = cardId(project(), p.item.id);
          moveTo(p.board, p.item, next);
          // 列が変わるとカードが作り直されるので、フォーカスを移し直す
          queueMicrotask(() => document.getElementById(id)?.focus());
        }}
      >
        <div class="card__meta small">
          <span class={`kind kind--${stateClass()}`} aria-hidden="true" />
          <Show when={p.item.repo} fallback={<span>{t("kanban.draft")}</span>}>
            {(repo) => (
              <span class="mono">
                {repo().owner}/{repo().name}
                <Show when={p.item.number !== null}>#{p.item.number}</Show>
              </span>
            )}
          </Show>
        </div>
        <Show when={p.item.htmlUrl} fallback={<span class="card__title">{p.item.title ?? t("kanban.noAccess")}</span>}>
          {(url) => (
            <a class="card__title" href={url()} target="_blank" rel="noreferrer" draggable={false}>
              {p.item.title ?? t("kanban.noAccess")}
            </a>
          )}
        </Show>
        <Show when={p.item.labels.length > 0 || p.item.assignees.length > 0}>
          <div class="card__foot">
            <span class="card__labels">
              <For each={p.item.labels}>
                {(label) => (
                  <span
                    class="label"
                    style={label.color ? { background: `#${label.color}`, color: labelTextColor(label.color) } : undefined}
                  >
                    {label.name}
                  </span>
                )}
              </For>
            </span>
            <span class="card__assignees">
              <For each={p.item.assignees}>
                {(a) => (
                  <span title={a.login}>
                    <Avatar src={a.avatarUrl} login={a.login} size={18} />
                  </span>
                )}
              </For>
            </span>
          </div>
        </Show>
      </li>
    );
  }
}

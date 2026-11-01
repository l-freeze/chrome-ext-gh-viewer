// カンバンの状態。プロジェクトの一覧は所有者ごと、項目はプロジェクトごとに取得して覚えておく。
// - 項目は全種類をまとめて取得するので、表示する種類を切り替えても取得し直さない
// - 折りたたんだプロジェクトの項目は、開くまで取得しない
// - 取得し直すのは、再読み込みと作業範囲が変わったときだけ

import { batch, createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { withItemStatus, type Board } from "../../../features/projects/board";
import { projectKey, type ItemKind, type Project } from "../../../features/projects/project";
import { DEFAULT_BOARD_PREFERENCES, type BoardPreferences, type OwnerProjects } from "../../../features/projects/ports";
import { settleEach } from "../../../lib/concurrency";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { isAborted } from "../../errors";

export type BoardEntry = { status: "loading" } | { status: "ready"; board: Board } | { status: "error"; error: unknown };

export interface MoveFailure {
  title: string;
  error: unknown;
}

const BOARD_CONCURRENCY = 4;

export function createKanbanState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const ops = deps.manager.projects;
  // キーは所有者（小文字）
  const [owners, setOwners] = createSignal<ReadonlyMap<string, OwnerProjects>>(new Map());
  // キーは projectKey
  const [boards, setBoards] = createSignal<ReadonlyMap<string, BoardEntry>>(new Map());
  const [prefs, setPrefs] = createSignal<BoardPreferences | null>(null);
  const [moving, setMoving] = createSignal<ReadonlySet<string>>(new Set());
  const [moveFailure, setMoveFailure] = createSignal<MoveFailure | null>(null);
  const [tasks, setTasks] = createSignal({ done: 0, total: 0 });

  void ops.loadPreferences().then(setPrefs, () => setPrefs(DEFAULT_BOARD_PREFERENCES));

  let generation = new AbortController();
  const loadingOwners = new Set<string>();

  /** 読み込みの進み具合。全部終わったら数え直す */
  async function track<T>(work: Promise<T>): Promise<T> {
    const started = generation;
    setTasks((t) => ({ ...t, total: t.total + 1 }));
    try {
      return await work;
    } finally {
      if (started === generation) setTasks((t) => (t.done + 1 >= t.total ? { done: 0, total: 0 } : { ...t, done: t.done + 1 }));
    }
  }

  const setBoard = (key: string, entry: BoardEntry) => setBoards((prev) => new Map(prev).set(key, entry));

  const kinds = createMemo(() => new Set<ItemKind>(prefs()?.kinds ?? DEFAULT_BOARD_PREFERENCES.kinds));
  const collapsed = createMemo(() => new Set(prefs()?.collapsed ?? []));

  const ownerResults = createMemo(() =>
    ws
      .selectedOwners()
      .map((o) => owners().get(o.owner.login.toLowerCase()))
      .filter((r): r is OwnerProjects => r !== undefined),
  );
  const projects = createMemo(() => ownerResults().flatMap((r) => r.projects));

  async function loadOwners() {
    const missing = ws
      .selectedOwners()
      .map((o) => o.owner)
      .filter((o) => !owners().has(o.login.toLowerCase()) && !loadingOwners.has(o.login.toLowerCase()));
    if (missing.length === 0) return;
    const { signal } = generation;
    for (const o of missing) loadingOwners.add(o.login.toLowerCase());
    try {
      await track(
        ops.listProjects(missing, {
          signal,
          onOwnerDone: (result) => {
            if (!signal.aborted) setOwners((prev) => new Map(prev).set(result.owner.login.toLowerCase(), result));
          },
        }),
      );
    } catch (e) {
      if (!isAborted(e)) throw e;
    } finally {
      if (!signal.aborted) for (const o of missing) loadingOwners.delete(o.login.toLowerCase());
    }
  }

  /** 開いているプロジェクトのうち、まだ取得していないものの項目を取得する */
  async function loadBoards() {
    const targets = projects().filter((p) => !collapsed().has(projectKey(p)) && !boards().has(projectKey(p)));
    if (targets.length === 0) return;
    const { signal } = generation;
    batch(() => targets.forEach((p) => setBoard(projectKey(p), { status: "loading" })));
    try {
      await settleEach(targets, (p, s) => track(ops.loadBoard(p, s)), {
        concurrency: BOARD_CONCURRENCY,
        signal,
        onProgress: (_, r) => {
          if (signal.aborted) return;
          setBoard(projectKey(r.item), r.ok ? { status: "ready", board: r.value } : { status: "error", error: r.error });
        },
      });
    } catch (e) {
      if (!isAborted(e)) throw e;
    }
  }

  function reset() {
    generation.abort();
    generation = new AbortController();
    loadingOwners.clear();
    batch(() => {
      setOwners(new Map());
      setBoards(new Map());
      setTasks({ done: 0, total: 0 });
      setMoveFailure(null);
    });
  }

  // カンバンを開いているときだけ取得する。作業範囲を取り直したときは先に覚えていた結果を捨てる
  let lastWorkspace: unknown;
  createEffect(
    on([ws.workspace, active, ws.selectedOwners, owners, prefs], ([workspace, isActive, , , preferences]) => {
      if (workspace !== lastWorkspace) {
        lastWorkspace = workspace;
        reset();
      }
      if (!workspace || !isActive || !preferences) return;
      void loadOwners();
      void loadBoards();
    }),
  );

  function savePrefs(next: BoardPreferences) {
    setPrefs(next);
    void ops.savePreferences(next).catch(() => undefined);
  }

  /** 項目を別の列へ動かす。先に画面で動かし、失敗したら元に戻す */
  async function move(project: Project, itemId: number, statusId: string | null) {
    const key = projectKey(project);
    const entry = boards().get(key);
    if (entry?.status !== "ready") return;
    const board = entry.board;
    const item = board.items.find((i) => i.id === itemId);
    const movingKey = `${key}:${itemId}`;
    if (!item || item.statusId === statusId || moving().has(movingKey)) return;

    const before = item.statusId;
    batch(() => {
      setBoard(key, { status: "ready", board: withItemStatus(board, itemId, statusId) });
      setMoving((prev) => new Set(prev).add(movingKey));
      setMoveFailure(null);
    });
    try {
      await ops.moveItem(board, itemId, statusId);
    } catch (error) {
      const current = boards().get(key);
      batch(() => {
        if (current?.status === "ready" && current.board.items.find((i) => i.id === itemId)?.statusId === statusId) {
          setBoard(key, { status: "ready", board: withItemStatus(current.board, itemId, before) });
        }
        setMoveFailure({ title: item.title ?? `#${itemId}`, error });
      });
    } finally {
      setMoving((prev) => {
        const next = new Set(prev);
        next.delete(movingKey);
        return next;
      });
    }
  }

  return {
    projects,
    kinds,
    toggleKind(kind: ItemKind) {
      const current = prefs() ?? DEFAULT_BOARD_PREFERENCES;
      const next = current.kinds.includes(kind) ? current.kinds.filter((k) => k !== kind) : [...current.kinds, kind];
      savePrefs({ ...current, kinds: next });
    },
    isCollapsed: (project: Project) => collapsed().has(projectKey(project)),
    toggleCollapsed(project: Project) {
      const current = prefs() ?? DEFAULT_BOARD_PREFERENCES;
      const key = projectKey(project);
      const next = current.collapsed.includes(key) ? current.collapsed.filter((k) => k !== key) : [...current.collapsed, key];
      savePrefs({ ...current, collapsed: next });
    },
    board: (project: Project) => boards().get(projectKey(project)),
    isMoving: (project: Project, itemId: number) => moving().has(`${projectKey(project)}:${itemId}`),
    move,
    moveFailure,
    dismissMoveFailure: () => setMoveFailure(null),
    failures: createMemo(() => ownerResults().filter((r) => r.error !== null)),
    /** 選んだ所有者のプロジェクトの一覧を、すべて取得し終えたか */
    ownersLoaded: createMemo(() => ownerResults().length === ws.selectedOwners().length),
    progress: createMemo(() => (tasks().total > 0 ? tasks() : null)),
    /** 覚えていた結果を捨てる。開いていれば、それを受けて取得し直す */
    refresh: reset,
  };
}

export type KanbanState = ReturnType<typeof createKanbanState>;

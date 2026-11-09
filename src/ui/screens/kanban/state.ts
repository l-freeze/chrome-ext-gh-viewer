// カンバンの状態。プロジェクトの一覧は所有者ごと、項目はプロジェクトごとに取得して覚えておく。
// - 項目は全種類をまとめて取得するので、表示する種類を切り替えても取得し直さない
// - 折りたたんだプロジェクトの項目は、開くまで取得しない
// - 取得し直すのは、再読み込み・自動更新・作業範囲が変わったとき。自動更新では表示を消さずに、変わったところだけ差し替える

import { batch, createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import { withItem, withItemStatus, withoutItem, type Board } from "../../../features/projects/board";
import { projectKey, type ItemKind, type Project } from "../../../features/projects/project";
import { DEFAULT_BOARD_PREFERENCES, type BoardPreferences, type OwnerProjects } from "../../../features/projects/ports";
import { settleEach } from "../../../lib/concurrency";
import { reuseUnchanged, sameValue } from "../../../lib/reuse";
import type { UiDeps } from "../../app/context";
import type { WorkspaceState } from "../../app/workspace";
import { isAborted } from "../../errors";

export type BoardEntry = { status: "loading" } | { status: "ready"; board: Board } | { status: "error"; error: unknown };

export interface MoveFailure {
  title: string;
  error: unknown;
  /** 動かそうとしたプロジェクトの持ち主（権限の案内を出し分けるため） */
  owner: Project["owner"];
}

const BOARD_CONCURRENCY = 4;

/** 別のプロジェクトへ移す前の確認に出す内容 */
export interface PendingTransfer {
  from: Project;
  to: Project;
  itemId: number;
  title: string;
  statusId: string | null;
  /** 落とした列の名前 */
  column: string;
}

/** 取り直した盤面のうち、変わっていない部分は前のオブジェクトを使う（カードを作り直さないため） */
function refreshed(old: Board, fresh: Board): Board {
  if (sameValue(old, fresh)) return old;
  return {
    project: sameValue(old.project, fresh.project) ? old.project : fresh.project,
    field: sameValue(old.field, fresh.field) ? old.field : fresh.field,
    items: reuseUnchanged(old.items, fresh.items, (i) => i.id),
  };
}

export function createKanbanState(deps: UiDeps, ws: WorkspaceState, active: Accessor<boolean>) {
  const ops = deps.manager.projects;
  // キーは所有者（小文字）
  const [owners, setOwners] = createSignal<ReadonlyMap<string, OwnerProjects>>(new Map());
  // キーは projectKey
  const [boards, setBoards] = createSignal<ReadonlyMap<string, BoardEntry>>(new Map());
  const [prefs, setPrefs] = createSignal<BoardPreferences | null>(null);
  const [moving, setMoving] = createSignal<ReadonlySet<string>>(new Set());
  const [moveFailure, setMoveFailure] = createSignal<MoveFailure | null>(null);
  const [pendingTransfer, setPendingTransfer] = createSignal<PendingTransfer | null>(null);
  const [tasks, setTasks] = createSignal({ done: 0, total: 0 });

  void ops.loadPreferences().then(setPrefs, () => setPrefs(DEFAULT_BOARD_PREFERENCES));

  let generation = new AbortController();
  const loadingOwners = new Set<string>();
  // プロジェクトごとの、最後に項目を動かした順番。自動更新の途中で動かした盤面には、古い結果を当てない
  let moveCount = 0;
  const lastMove = new Map<string, number>();

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
    lastMove.set(key, ++moveCount);
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
        setMoveFailure({ title: item.title ?? `#${itemId}`, error, owner: project.owner });
      });
    } finally {
      setMoving((prev) => {
        const next = new Set(prev);
        next.delete(movingKey);
        return next;
      });
    }
  }

  /** 確認のあとで、別のプロジェクトへ移す。成功したら両方の盤面を書き換える（取り直さない） */
  async function confirmTransfer() {
    const p = pendingTransfer();
    setPendingTransfer(null);
    if (!p) return;
    const fromKey = projectKey(p.from);
    const toKey = projectKey(p.to);
    const from = boards().get(fromKey);
    const to = boards().get(toKey);
    const movingKey = `${fromKey}:${p.itemId}`;
    if (from?.status !== "ready" || to?.status !== "ready" || moving().has(movingKey)) return;
    lastMove.set(fromKey, ++moveCount);
    lastMove.set(toKey, moveCount);
    batch(() => {
      setMoving((prev) => new Set(prev).add(movingKey));
      setMoveFailure(null);
    });
    try {
      const moved = await ops.moveToProject(from.board, p.itemId, to.board, p.statusId);
      batch(() => {
        const currentFrom = boards().get(fromKey);
        const currentTo = boards().get(toKey);
        if (currentFrom?.status === "ready") setBoard(fromKey, { status: "ready", board: withoutItem(currentFrom.board, p.itemId) });
        if (currentTo?.status === "ready") setBoard(toKey, { status: "ready", board: withItem(currentTo.board, moved) });
      });
    } catch (error) {
      setMoveFailure({ title: p.title, error, owner: p.to.owner });
    } finally {
      setMoving((prev) => {
        const next = new Set(prev);
        next.delete(movingKey);
        return next;
      });
    }
  }

  /** 自動更新: 取得済みの所有者のプロジェクトと、表示しているプロジェクトの項目を取り直す。読み込み中や移動中は何もしない */
  async function poll() {
    if (tasks().total > 0 || moving().size > 0) return;
    const loaded = ws
      .selectedOwners()
      .map((o) => o.owner)
      .filter((o) => owners().has(o.login.toLowerCase()));
    if (loaded.length === 0) return;
    const { signal } = generation;
    const startedAt = moveCount;
    try {
      await ops.listProjects(loaded, {
        signal,
        onOwnerDone: (result) => {
          const key = result.owner.login.toLowerCase();
          const prev = owners().get(key);
          if (signal.aborted || !prev || (result.error !== null && prev.error === null) || sameValue(prev, result)) return;
          setOwners((m) => new Map(m).set(key, { ...result, projects: reuseUnchanged(prev.projects, result.projects, projectKey) }));
        },
      });
      const targets = projects().filter((p) => {
        const status = boards().get(projectKey(p))?.status;
        return !collapsed().has(projectKey(p)) && (status === "ready" || status === "error");
      });
      await settleEach(targets, (p, s) => ops.loadBoard(p, s), {
        concurrency: BOARD_CONCURRENCY,
        signal,
        onProgress: (_, r) => {
          const key = projectKey(r.item);
          const current = boards().get(key);
          if (signal.aborted || !r.ok || (lastMove.get(key) ?? 0) > startedAt) return;
          if (current?.status !== "ready") return setBoard(key, { status: "ready", board: r.value });
          const next = refreshed(current.board, r.value);
          if (next !== current.board) setBoard(key, { status: "ready", board: next });
        },
      });
    } catch (e) {
      if (!isAborted(e)) throw e;
    }
  }

  return {
    poll,
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
    pendingTransfer,
    /** 別のプロジェクトへ落としたとき。すぐには移さず、確認を出す */
    requestTransfer: (transfer: PendingTransfer) => setPendingTransfer(transfer),
    cancelTransfer: () => setPendingTransfer(null),
    confirmTransfer,
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

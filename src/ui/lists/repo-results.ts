// リポジトリごとに取得した結果のキャッシュ。所有者の選択を切り替えても、取得済みのリポジトリは取り直さない。

import { batch, createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import type { Repository } from "../../features/workspace/repository";
import type { Settled, SettleOptions } from "../../lib/concurrency";
import { sameValue } from "../../lib/reuse";
import { isAborted } from "../errors";
import type { WorkspaceState } from "../app/workspace";

export type Fetch<T> = (repos: readonly Repository[], options: SettleOptions<Repository, T>) => Promise<Settled<Repository, T>[]>;

export interface RepoResults<T> {
  progress: Accessor<{ done: number; total: number } | null>;
  /** 最後に取得を始めた時刻（日数の計算に使う） */
  now: Accessor<number>;
  /** 選択中の所有者のリポジトリの成功した結果 */
  values: Accessor<Array<{ repo: Repository; value: T }>>;
  failures: Accessor<Array<{ repo: Repository; error: unknown }>>;
  refresh(): void;
  /** 自動更新: 取得済みのリポジトリを、表示を消さずに取り直す。読み込み中や paused の間は何もしない */
  poll(): Promise<void>;
  /** 指定したリポジトリだけ取り直す */
  reload(repos: readonly Repository[]): void;
  /** 取得済みの結果を書き換える（削除した項目を外すなど） */
  update(fn: (repo: Repository, value: T) => T): void;
}

const keyOf = (r: Repository) => r.fullName.toLowerCase();

/**
 * active を渡すと、そのタブを開いているときだけ取得する（渡さなければ常に取得する）。
 * 作業範囲を取り直したとき（認証情報の変更など）は先にキャッシュを捨てる
 */
export function createRepoResults<T>(options: {
  ws: WorkspaceState;
  fetch: Fetch<T>;
  now: () => number;
  active?: Accessor<boolean>;
  onReset?: () => void;
  /** 削除の確認中など、取り直すと困る間は真にする */
  paused?: Accessor<boolean>;
  /** 取り直した値と前の値の合わせ方。既定は、同じなら前の値を使う */
  merge?: (prev: T, next: T) => T;
}): RepoResults<T> {
  const { ws } = options;
  const [results, setResults] = createSignal<ReadonlyMap<string, Settled<Repository, T>>>(new Map());
  const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
  const [now, setNow] = createSignal(options.now());
  let abort: AbortController | null = null;
  // update で書き換えた回数。自動更新の途中で書き換えたら、その回の結果は当てない（消した項目が戻らないように）
  let version = 0;
  const merge = options.merge ?? ((prev: T, next: T) => (sameValue(prev, next) ? prev : next));

  async function poll() {
    if (abort || !ws.workspace() || options.paused?.()) return;
    const repos = ws
      .selectedRepos()
      .map((r) => r.repo)
      .filter((r) => results().has(keyOf(r)));
    if (repos.length === 0) return;
    const controller = new AbortController();
    abort = controller;
    const startedAt = version;
    try {
      await options.fetch(repos, {
        signal: controller.signal,
        onProgress: (_, result) => {
          if (controller.signal.aborted || version !== startedAt) return;
          const key = keyOf(result.item);
          const prev = results().get(key);
          // 一時的な失敗では、前に取れた結果を残す
          if (!result.ok && prev?.ok) return;
          const next = result.ok && prev?.ok ? { ...result, value: merge(prev.value, result.value) } : result;
          if (prev && next.ok && prev.ok && next.value === prev.value) return;
          if (prev && !next.ok && !prev.ok && sameValue(prev.error, next.error)) return;
          setResults((m) => new Map(m).set(key, next));
        },
      });
      if (!controller.signal.aborted) setNow(options.now());
    } catch (e) {
      if (!isAborted(e)) throw e;
    } finally {
      if (abort === controller) abort = null;
    }
  }

  async function load(repos: readonly Repository[], force: boolean) {
    if (!ws.workspace()) return;
    const cache = force ? new Map<string, Settled<Repository, T>>() : new Map(results());
    if (force) setResults(cache);
    const missing = repos.filter((r) => !cache.has(keyOf(r)));
    if (missing.length === 0) return;

    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    setNow(options.now());
    setProgress({ done: 0, total: missing.length });
    try {
      await options.fetch(missing, {
        signal: controller.signal,
        onProgress: (p, result) => {
          if (controller.signal.aborted) return;
          batch(() => {
            setResults((prev) => new Map(prev).set(keyOf(result.item), result));
            setProgress(p);
          });
        },
      });
    } catch (e) {
      if (!isAborted(e)) throw e;
    } finally {
      if (abort === controller) {
        abort = null;
        setProgress(null);
      }
    }
  }

  let lastWorkspace: unknown;
  createEffect(
    on([ws.workspace, options.active ?? (() => true), ws.selectedRepos], ([workspace, isActive]) => {
      if (workspace !== lastWorkspace) {
        lastWorkspace = workspace;
        abort?.abort();
        setResults(new Map());
        options.onReset?.();
      }
      if (isActive) void load(ws.selectedRepos().map((r) => r.repo), false);
    }),
  );

  const selected = createMemo(() =>
    ws
      .selectedRepos()
      .map((r) => results().get(keyOf(r.repo)))
      .filter((r): r is Settled<Repository, T> => r !== undefined),
  );

  return {
    progress,
    now,
    values: createMemo(() => selected().flatMap((r) => (r.ok ? [{ repo: r.item, value: r.value }] : []))),
    failures: createMemo(() => selected().flatMap((r) => (r.ok ? [] : [{ repo: r.item, error: r.error }]))),
    refresh: () => void load(ws.selectedRepos().map((r) => r.repo), true),
    poll,
    reload(repos) {
      setResults((prev) => {
        const next = new Map(prev);
        for (const r of repos) next.delete(keyOf(r));
        return next;
      });
      void load(repos, false);
    },
    update(fn) {
      version++;
      setResults((prev) => {
        const next = new Map(prev);
        for (const [key, r] of next) if (r.ok) next.set(key, { ...r, value: fn(r.item, r.value) });
        return next;
      });
    },
  };
}

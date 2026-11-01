// リポジトリごとに取得した結果のキャッシュ。所有者の選択を切り替えても、取得済みのリポジトリは取り直さない。

import { batch, createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import type { Repository } from "../../features/workspace/repository";
import type { Settled, SettleOptions } from "../../lib/concurrency";
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
}): RepoResults<T> {
  const { ws } = options;
  const [results, setResults] = createSignal<ReadonlyMap<string, Settled<Repository, T>>>(new Map());
  const [progress, setProgress] = createSignal<{ done: number; total: number } | null>(null);
  const [now, setNow] = createSignal(options.now());
  let abort: AbortController | null = null;

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
    reload(repos) {
      setResults((prev) => {
        const next = new Map(prev);
        for (const r of repos) next.delete(keyOf(r));
        return next;
      });
      void load(repos, false);
    },
    update(fn) {
      setResults((prev) => {
        const next = new Map(prev);
        for (const [key, r] of next) if (r.ok) next.set(key, { ...r, value: fn(r.item, r.value) });
        return next;
      });
    },
  };
}

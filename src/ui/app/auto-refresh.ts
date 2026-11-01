// 自動更新: 開いている画面の情報を一定の間隔で取り直す。オン・オフは端末に保存する。
// - 画面を開いていて、ページが見えている間だけ取り直す
// - 別の画面やタブから戻ったとき、前回から間隔以上たっていればすぐに取り直す
// - 再読み込みボタンは、オン・オフに関係なくいつでも使える

import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js";
import { DEFAULT_DISPLAY_PREFERENCES } from "../../features/preferences/ports";
import type { UiDeps } from "./context";

export function createAutoRefreshSetting(deps: UiDeps) {
  const ops = deps.manager.preferences;
  const [enabled, setEnabled] = createSignal(DEFAULT_DISPLAY_PREFERENCES.autoRefresh);
  void ops.load().then(
    (p) => setEnabled(p.autoRefresh),
    () => undefined,
  );
  return {
    enabled,
    toggle() {
      const next = !enabled();
      setEnabled(next);
      void ops.save({ autoRefresh: next }).catch(() => undefined);
    },
  };
}

export type AutoRefreshSetting = ReturnType<typeof createAutoRefreshSetting>;

const MINUTE_MS = 60_000;
/** 自動更新で使ってよい 1 時間あたりの呼び出し数。通常の API の上限（5,000 回/時）の 1 割 */
export const HOURLY_REQUEST_BUDGET = 500;
/** 呼び出し数から決める間隔の最短 */
export const MIN_BUDGETED_INTERVAL_MS = 5 * MINUTE_MS;

/**
 * 1 回の更新で requestsPerRefresh 回呼ぶ画面の間隔。1 時間あたりの呼び出しが HOURLY_REQUEST_BUDGET に収まるように、
 * 分単位で切り上げる（最短 5 分）
 */
export function intervalForRequests(requestsPerRefresh: number): number {
  const minutes = Math.ceil((requestsPerRefresh * 60) / HOURLY_REQUEST_BUDGET);
  return Math.max(MIN_BUDGETED_INTERVAL_MS, minutes * MINUTE_MS);
}

/**
 * when が真の間、intervalMs ごとに run を呼ぶ。run が終わってから次を数える。
 * run は、取り直すものがなければ何もしない作りにしておく（初めての読み込みは各画面が行う）
 */
export function createPolling(options: {
  when: Accessor<boolean>;
  intervalMs: number | Accessor<number>;
  run: () => Promise<unknown>;
  now?: () => number;
}) {
  const now = options.now ?? (() => Date.now());
  const interval = typeof options.intervalMs === "number" ? () => options.intervalMs as number : options.intervalMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let started = false;
  let last = now();

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const allowed = () => options.when() && document.visibilityState === "visible";

  async function tick() {
    clear();
    if (!allowed() || running) return;
    running = true;
    try {
      await options.run();
    } catch {
      // 一時的な失敗は次の回に任せる（表示はそのまま）
    } finally {
      running = false;
      last = now();
      schedule();
    }
  }

  function schedule() {
    clear();
    if (!allowed() || running) return;
    const wait = interval() - (now() - last);
    if (wait <= 0) void tick();
    else timer = setTimeout(() => void tick(), wait);
  }

  createEffect(
    on([options.when, interval], ([isOn]) => {
      // 初めて開いたときは各画面が読み込むので、そこから数える
      if (isOn && !started) {
        started = true;
        last = now();
      }
      schedule();
    }),
  );
  const onVisibility = () => schedule();
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => {
    clear();
    document.removeEventListener("visibilitychange", onVisibility);
  });
}

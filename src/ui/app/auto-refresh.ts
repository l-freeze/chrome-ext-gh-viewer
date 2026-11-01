// 自動更新: 開いている画面の情報を一定の間隔で取り直す。オン・オフは端末に保存する。
// - 画面を開いていて、ページが見えている間だけ取り直す
// - 別の画面やタブから戻ったとき、前回から間隔以上たっていればすぐに取り直す

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

/**
 * when が真の間、intervalMs ごとに run を呼ぶ。run が終わってから次を数える。
 * run は、取り直すものがなければ何もしない作りにしておく（初めての読み込みは各画面が行う）
 */
export function createPolling(options: {
  when: Accessor<boolean>;
  intervalMs: number;
  run: () => Promise<unknown>;
  now?: () => number;
}) {
  const now = options.now ?? (() => Date.now());
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
    const wait = options.intervalMs - (now() - last);
    if (wait <= 0) void tick();
    else timer = setTimeout(() => void tick(), wait);
  }

  createEffect(
    on(options.when, (isOn) => {
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

// 設定タブの状態: 接続方法、認証情報、GitHub でログイン（コード表示 → 承認待ち）、PAT の追加。

import { createMemo, createSignal } from "solid-js";
import { activeCredentials, type AuthMethod, type AuthSettings, type DeviceCode } from "../../../features/settings/credential";
import type { UiDeps } from "../../app/context";
import { isAborted } from "../../errors";

export type OAuthPhase =
  | { phase: "idle" }
  | { phase: "requesting" }
  | { phase: "waiting"; code: DeviceCode }
  | { phase: "error"; error: unknown };

export type PatPhase = { phase: "idle" } | { phase: "checking" } | { phase: "error"; error: unknown };

export function createSettingsState(deps: UiDeps) {
  const ops = deps.manager.settings;
  const [ready, setReady] = createSignal(false);
  const [settings, setSettings] = createSignal<AuthSettings>({ method: ops.signIn ? "oauth" : "pat", credentials: [] });
  const [oauth, setOAuth] = createSignal<OAuthPhase>({ phase: "idle" });
  const [pat, setPat] = createSignal<PatPhase>({ phase: "idle" });
  let oauthAbort: AbortController | null = null;

  void ops.load().then(
    (s) => (setSettings(s), setReady(true)),
    () => setReady(true),
  );

  return {
    ready,
    settings,
    /** 選んでいる接続方法の認証情報。中身が同じなら更新を伝えない（作業範囲の取り直しを防ぐ） */
    active: createMemo(() => activeCredentials(settings()), [], {
      equals: (a, b) => a.length === b.length && a.every((c, i) => c.id === b[i]?.id),
    }),
    oauthAvailable: ops.signIn !== null,
    oauth,
    pat,
    async setMethod(method: AuthMethod) {
      setSettings(await ops.setMethod(method));
    },
    async startOAuth() {
      const signIn = ops.signIn;
      if (!signIn) return;
      oauthAbort?.abort();
      const abort = new AbortController();
      oauthAbort = abort;
      setOAuth({ phase: "requesting" });
      try {
        const code = await signIn.start(abort.signal);
        setOAuth({ phase: "waiting", code });
        setSettings(await signIn.finish(code, abort.signal));
        setOAuth({ phase: "idle" });
      } catch (error) {
        if (abort.signal.aborted || isAborted(error)) return;
        setOAuth({ phase: "error", error });
      }
    },
    cancelOAuth() {
      oauthAbort?.abort();
      oauthAbort = null;
      setOAuth({ phase: "idle" });
    },
    /** 追加できたら true */
    async addPat(raw: string): Promise<boolean> {
      setPat({ phase: "checking" });
      try {
        setSettings(await ops.addToken(raw));
        setPat({ phase: "idle" });
        return true;
      } catch (error) {
        setPat({ phase: "error", error });
        return false;
      }
    },
    async remove(id: string) {
      setSettings(await ops.remove(id));
    },
  };
}

export type SettingsState = ReturnType<typeof createSettingsState>;

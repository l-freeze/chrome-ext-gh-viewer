// 接続方法と認証情報の状態。OAuth の Device Flow もここで進める。

import { createMemo, createSignal, type Accessor } from "solid-js";
import { GitHubApiError } from "../../api/errors";
import { DeviceFlowError } from "../../api/deviceFlow";
import type { DeviceCode } from "../../api/types";
import {
  activeCredentials,
  inspectCredential,
  loadAuthSettings,
  saveAuthSettings,
  type AuthMethod,
  type AuthSettings,
  type Credential,
} from "../../services/credentials";
import type { AppDeps } from "./context";

export type OAuthPhase =
  | { phase: "idle" }
  | { phase: "requesting" }
  | { phase: "waiting"; code: DeviceCode }
  | { phase: "error"; error: DeviceFlowError | GitHubApiError };

export type PatPhase = { phase: "idle" } | { phase: "checking" } | { phase: "error"; error: GitHubApiError | "duplicate" };

export interface AuthState {
  ready: Accessor<boolean>;
  settings: Accessor<AuthSettings>;
  active: Accessor<Credential[]>;
  oauthAvailable: boolean;
  oauth: Accessor<OAuthPhase>;
  pat: Accessor<PatPhase>;
  setMethod(method: AuthMethod): Promise<void>;
  startOAuth(): Promise<void>;
  cancelOAuth(): void;
  addPat(token: string): Promise<boolean>;
  removeCredential(id: string): Promise<void>;
}

export function createAuthState(deps: AppDeps): AuthState {
  const oauthAvailable = deps.createDeviceFlow !== null;
  const [ready, setReady] = createSignal(false);
  const [settings, setSettings] = createSignal<AuthSettings>({ method: oauthAvailable ? "oauth" : "pat", credentials: [] });
  const [oauth, setOAuth] = createSignal<OAuthPhase>({ phase: "idle" });
  const [pat, setPat] = createSignal<PatPhase>({ phase: "idle" });
  let oauthAbort: AbortController | null = null;

  void loadAuthSettings(deps.store, oauthAvailable).then((s) => {
    setSettings(s);
    setReady(true);
  });

  const update = async (next: AuthSettings) => {
    setSettings(next);
    await saveAuthSettings(deps.store, next);
  };

  const active = createMemo(() => activeCredentials(settings()), [], {
    // 中身が同じなら再計算を伝えない（作業範囲の取り直しを防ぐ）
    equals: (a, b) => a.length === b.length && a.every((c, i) => c.id === b[i]?.id),
  });

  return {
    ready,
    settings,
    active,
    oauthAvailable,
    oauth,
    pat,

    setMethod: (method) => update({ ...settings(), method }),

    async startOAuth() {
      const createFlow = deps.createDeviceFlow;
      if (!createFlow) return;
      oauthAbort?.abort();
      const abort = new AbortController();
      oauthAbort = abort;
      const flow = createFlow();
      setOAuth({ phase: "requesting" });
      try {
        const code = await flow.requestCode(undefined, abort.signal);
        setOAuth({ phase: "waiting", code });
        const token = await flow.pollToken(code, abort.signal);
        const credential = await inspectCredential(token.accessToken, "oauth", deps.createClient(token.accessToken));
        // OAuth の認証情報は 1 つだけ持つ
        const others = settings().credentials.filter((c) => c.source !== "oauth");
        await update({ method: "oauth", credentials: [...others, credential] });
        setOAuth({ phase: "idle" });
      } catch (e) {
        if (abort.signal.aborted) return;
        const error =
          e instanceof DeviceFlowError || e instanceof GitHubApiError
            ? e
            : new DeviceFlowError("unexpected", String(e));
        setOAuth({ phase: "error", error });
      }
    },

    cancelOAuth() {
      oauthAbort?.abort();
      oauthAbort = null;
      setOAuth({ phase: "idle" });
    },

    async addPat(raw) {
      const token = raw.trim();
      if (!token) return false;
      if (settings().credentials.some((c) => c.token === token)) {
        setPat({ phase: "error", error: "duplicate" });
        return false;
      }
      setPat({ phase: "checking" });
      try {
        const credential = await inspectCredential(token, "pat", deps.createClient(token));
        await update({ method: "pat", credentials: [...settings().credentials, credential] });
        setPat({ phase: "idle" });
        return true;
      } catch (e) {
        setPat({
          phase: "error",
          error: e instanceof GitHubApiError ? e : new GitHubApiError({ kind: "unexpected", message: String(e) }),
        });
        return false;
      }
    },

    removeCredential: (id) => update({ ...settings(), credentials: settings().credentials.filter((c) => c.id !== id) }),
  };
}

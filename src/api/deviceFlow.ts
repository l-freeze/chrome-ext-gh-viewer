// OAuth Device Flow（Client Secret 不要）。
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

import { decodeAccessTokenResponse, decodeDeviceCode } from "./decode";
import { DecodeError } from "./errors";
import { defaultSleep, type Sleep } from "./http";
import type { AccessToken, DeviceCode } from "./types";

export const DEFAULT_OAUTH_BASE_URL = "https://github.com";
export const DEFAULT_SCOPES = ["repo", "read:org"];

export type DeviceFlowErrorKind =
  /** コードの有効期限切れ。最初からやり直す */
  | "expired"
  /** 利用者が承認画面でキャンセルした */
  | "access_denied"
  /** OAuth App で Device Flow が有効になっていない */
  | "disabled"
  | "aborted"
  | "network"
  | "unexpected";

export class DeviceFlowError extends Error {
  override readonly name = "DeviceFlowError";
  constructor(
    readonly kind: DeviceFlowErrorKind,
    message: string,
    /** GitHub が返した error コード */
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

export interface DeviceFlowOptions {
  clientId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: Sleep;
  now?: () => number;
}

export class DeviceFlow {
  private readonly clientId: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: Sleep;
  private readonly now: () => number;

  constructor(options: DeviceFlowOptions) {
    this.clientId = options.clientId;
    this.baseUrl = (options.baseUrl ?? DEFAULT_OAUTH_BASE_URL).replace(/\/+$/, "");
    const f = options.fetch ?? globalThis.fetch;
    this.fetchFn = (input, init) => f(input, init);
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  /** 利用者に表示するコード（userCode）と、確認ページの URL を取得する */
  async requestCode(scopes: readonly string[] = DEFAULT_SCOPES, signal?: AbortSignal): Promise<DeviceCode> {
    const data = await this.post("/login/device/code", { client_id: this.clientId, scope: scopes.join(" ") }, signal);
    throwIfErrorBody(data);
    try {
      return decodeDeviceCode(data);
    } catch (e) {
      throw new DeviceFlowError("unexpected", e instanceof DecodeError ? e.message : String(e));
    }
  }

  /** 利用者が承認するまでポーリングし、アクセストークンを返す */
  async pollToken(code: DeviceCode, signal?: AbortSignal): Promise<AccessToken> {
    const deadline = this.now() + code.expiresIn * 1000;
    let interval = code.interval;

    for (;;) {
      await this.sleepOrAbort(interval * 1000, signal);
      if (this.now() >= deadline) throw new DeviceFlowError("expired", "The device code has expired", "expired_token");

      const data = await this.post(
        "/login/oauth/access_token",
        {
          client_id: this.clientId,
          device_code: code.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        },
        signal,
      );
      let res;
      try {
        res = decodeAccessTokenResponse(data);
      } catch (e) {
        throw new DeviceFlowError("unexpected", e instanceof DecodeError ? e.message : String(e));
      }
      if (res.ok) return res.token;

      switch (res.error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          // 新しい間隔が返らなければ仕様どおり 5 秒延ばす
          interval = res.interval ?? interval + 5;
          continue;
        default:
          throw toDeviceFlowError(res.error, res.description);
      }
    }
  }

  private async sleepOrAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
    try {
      await this.sleep(ms, signal);
    } catch (e) {
      if (signal?.aborted) throw new DeviceFlowError("aborted", "Device flow aborted");
      throw e;
    }
  }

  private async post(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) throw new DeviceFlowError("aborted", "Device flow aborted");
    let res: Response;
    try {
      res = await this.fetchFn(this.baseUrl + path, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if (signal?.aborted) throw new DeviceFlowError("aborted", "Device flow aborted");
      throw new DeviceFlowError("network", `Network error: ${String(e)}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new DeviceFlowError("unexpected", `HTTP ${res.status}: response is not JSON`);
    }
    // エラーでも JSON の error フィールドで理由が返るので、ステータスより本文を優先する
    if (!res.ok && !(typeof body === "object" && body !== null && "error" in body)) {
      throw new DeviceFlowError("unexpected", `HTTP ${res.status}`);
    }
    return body;
  }
}

function throwIfErrorBody(data: unknown): void {
  if (typeof data === "object" && data !== null && "error" in data) {
    const o = data as Record<string, unknown>;
    const desc = typeof o["error_description"] === "string" ? o["error_description"] : null;
    throw toDeviceFlowError(String(o["error"]), desc);
  }
}

function toDeviceFlowError(code: string, description: string | null): DeviceFlowError {
  const message = description ?? code;
  switch (code) {
    case "expired_token":
      return new DeviceFlowError("expired", message, code);
    case "access_denied":
      return new DeviceFlowError("access_denied", message, code);
    case "device_flow_disabled":
      return new DeviceFlowError("disabled", message, code);
    default:
      return new DeviceFlowError("unexpected", message, code);
  }
}

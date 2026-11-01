// OAuth Device Flow（Client Secret 不要）。github.com に対して行う。
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

import { createHttpClient, TransportError, type HttpClient } from "../../infrastructure/http";
import { sleep as defaultSleep, type Sleep } from "../../lib/time";
import { num, obj, optNum, optStr, str, ValidationError } from "../../lib/validation";
import { splitScopes } from "./user";

export const DEFAULT_OAUTH_BASE_URL = "https://github.com";
export const DEFAULT_SCOPES = ["repo", "read:org"];

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface AccessToken {
  accessToken: string;
  tokenType: string;
  scopes: string[];
}

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
  client?: HttpClient;
  fetch?: typeof fetch;
  sleep?: Sleep;
  now?: () => number;
}

export function readDeviceCode(v: unknown): DeviceCode {
  const o = obj(v, "device_code");
  return {
    deviceCode: str(o, "device_code", "device_code"),
    userCode: str(o, "user_code", "device_code"),
    verificationUri: str(o, "verification_uri", "device_code"),
    expiresIn: num(o, "expires_in", "device_code"),
    interval: num(o, "interval", "device_code"),
  };
}

export type AccessTokenPollResult =
  | { ok: true; token: AccessToken }
  | { ok: false; error: string; description: string | null; interval: number | null };

export function readAccessTokenResponse(v: unknown): AccessTokenPollResult {
  const o = obj(v, "access_token");
  if (typeof o["access_token"] === "string") {
    return {
      ok: true,
      token: {
        accessToken: o["access_token"],
        tokenType: str(o, "token_type", "access_token"),
        scopes: splitScopes(optStr(o, "scope", "access_token") ?? ""),
      },
    };
  }
  return {
    ok: false,
    error: str(o, "error", "access_token"),
    description: optStr(o, "error_description", "access_token"),
    interval: optNum(o, "interval", "access_token"),
  };
}

export class DeviceFlow {
  private readonly clientId: string;
  private readonly baseUrl: string;
  private readonly client: HttpClient;
  private readonly sleep: Sleep;
  private readonly now: () => number;

  constructor(options: DeviceFlowOptions) {
    this.clientId = options.clientId;
    this.baseUrl = (options.baseUrl ?? DEFAULT_OAUTH_BASE_URL).replace(/\/+$/, "");
    this.client = options.client ?? createHttpClient(options.fetch ? { fetch: options.fetch } : {});
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  /** 利用者に表示するコード（userCode）と、確認ページの URL を取得する */
  async requestCode(scopes: readonly string[] = DEFAULT_SCOPES, signal?: AbortSignal): Promise<DeviceCode> {
    const data = await this.post("/login/device/code", { client_id: this.clientId, scope: scopes.join(" ") }, signal);
    throwIfErrorBody(data);
    return parsed(() => readDeviceCode(data));
  }

  /** 利用者が承認するまでポーリングし、アクセストークンを返す */
  async pollToken(code: DeviceCode, signal?: AbortSignal): Promise<AccessToken> {
    const deadline = this.now() + code.expiresIn * 1000;
    let interval = code.interval;

    for (;;) {
      try {
        await this.sleep(interval * 1000, signal);
      } catch (e) {
        if (signal?.aborted) throw new DeviceFlowError("aborted", "Device flow aborted");
        throw e;
      }
      if (this.now() >= deadline) throw new DeviceFlowError("expired", "The device code has expired", "expired_token");

      const data = await this.post(
        "/login/oauth/access_token",
        { client_id: this.clientId, device_code: code.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" },
        signal,
      );
      const res = parsed(() => readAccessTokenResponse(data));
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

  private async post(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await this.client.send({
        url: this.baseUrl + path,
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if (e instanceof TransportError && e.kind === "aborted") throw new DeviceFlowError("aborted", "Device flow aborted");
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

function parsed<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new DeviceFlowError("unexpected", e instanceof ValidationError ? e.message : String(e));
  }
}

function throwIfErrorBody(data: unknown): void {
  if (typeof data === "object" && data !== null && "error" in data) {
    const o = data as Record<string, unknown>;
    throw toDeviceFlowError(String(o["error"]), typeof o["error_description"] === "string" ? o["error_description"] : null);
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

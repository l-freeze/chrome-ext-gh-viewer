import type { AuthMethod, AuthSettings, Credential, DeviceCode } from "./credential";

/** 画面から呼ぶ操作 */
export interface SettingsOperations {
  load(): Promise<AuthSettings>;
  setMethod(method: AuthMethod): Promise<AuthSettings>;
  /** 貼り付けられた PAT を確認して追加する（入力は検証してから使う） */
  addToken(raw: unknown): Promise<AuthSettings>;
  remove(id: string): Promise<AuthSettings>;
  /** GitHub でログイン。OAuth App の Client ID がないビルドでは null */
  signIn: {
    /** 利用者に見せるコードを取得する */
    start(signal?: AbortSignal): Promise<DeviceCode>;
    /** 承認を待ってトークンを受け取り、保存する */
    finish(code: DeviceCode, signal?: AbortSignal): Promise<AuthSettings>;
  } | null;
}

export interface CredentialRepository {
  load(): Promise<AuthSettings | null>;
  save(settings: AuthSettings): Promise<void>;
}

export type InspectedToken = Pick<Credential, "kind" | "login" | "avatarUrl" | "scopes" | "expiresAt">;

export interface TokenInspector {
  inspect(token: string): Promise<InspectedToken>;
}

export interface DeviceAuthorizer {
  requestCode(signal?: AbortSignal): Promise<DeviceCode>;
  /** 承認されたらアクセストークンを返す */
  pollToken(code: DeviceCode, signal?: AbortSignal): Promise<string>;
}

// エラーを利用者向けの文にする。
// GitHub のエラーの分類を読むため、表示に限って integrations/github のエラー型に依存する。

import { DuplicateTokenError } from "../features/settings/credential";
import { DeviceFlowError } from "../integrations/github/device-flow";
import { GitHubApiError } from "../integrations/github/errors";
import { isAbort } from "../lib/concurrency";
import { ValidationError } from "../lib/validation";
import type { Translate } from "./i18n";

/** 中断による失敗か（利用者に知らせる必要はない） */
export function isAborted(e: unknown): boolean {
  return isAbort(e) || (e instanceof GitHubApiError && e.kind === "aborted") || (e instanceof DeviceFlowError && e.kind === "aborted");
}

export function errorText(t: Translate, error: unknown, nowMs = Date.now()): string {
  if (error instanceof DeviceFlowError) {
    switch (error.kind) {
      case "expired":
        return t("settings.oauth.expired");
      case "access_denied":
        return t("settings.oauth.denied");
      case "disabled":
        return t("settings.oauth.disabled");
      case "network":
        return t("error.network");
      case "aborted":
        return t("error.aborted");
      default:
        return t("settings.oauth.failed", { message: error.message });
    }
  }
  if (error instanceof GitHubApiError) {
    switch (error.kind) {
      case "rate_limited": {
        const sec = error.retryAfterSec ?? (error.rateLimit ? error.rateLimit.reset - nowMs / 1000 : 60);
        return t("error.rate_limited", { minutes: Math.max(1, Math.ceil(sec / 60)) });
      }
      case "unexpected":
        return t("error.unexpected", { message: error.message });
      default:
        return t(`error.${error.kind}`);
    }
  }
  if (error instanceof DuplicateTokenError) return t("settings.pat.duplicate");
  if (error instanceof ValidationError) return error.message;
  if (isAbort(error)) return t("error.aborted");
  return t("error.unexpected", { message: String(error) });
}

/** トークンが無効・失効しているという失敗か */
export function isUnauthorized(e: unknown): boolean {
  return e instanceof GitHubApiError && e.kind === "unauthorized";
}

/** SSO の承認ページがあれば返す */
export function ssoUrlOf(error: unknown): string | null {
  return error instanceof GitHubApiError ? (error.ssoUrl ?? null) : null;
}

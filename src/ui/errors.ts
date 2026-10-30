import { DeviceFlowError } from "../api/deviceFlow";
import { GitHubApiError } from "../api/errors";
import type { Translate } from "../i18n";

/** エラーを利用者向けの文に変える */
export function errorText(t: Translate, error: GitHubApiError | DeviceFlowError, nowMs = Date.now()): string {
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

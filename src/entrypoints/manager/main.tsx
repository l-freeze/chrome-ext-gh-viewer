import { render } from "solid-js/web";
import { browser } from "wxt/browser";
import { GitHubClient } from "../../api/client";
import { DeviceFlow } from "../../api/deviceFlow";
import { createI18n, resolveLocale } from "../../i18n";
import { browserDownloader } from "../../platform/downloads";
import { browserLocalStore } from "../../platform/storage";
import { OAUTH_CLIENT_ID } from "../../services/config";
import { App } from "../../ui/App";
import type { AppDeps } from "../../ui/state/context";
import "../../ui/styles.css";

const i18n = createI18n(resolveLocale(browser.i18n.getUILanguage()));
document.documentElement.lang = i18n.locale;

const deps: AppDeps = {
  i18n,
  store: browserLocalStore(),
  downloader: browserDownloader(),
  createClient: (token) => new GitHubClient({ token }),
  createDeviceFlow: OAUTH_CLIENT_ID ? () => new DeviceFlow({ clientId: OAUTH_CLIENT_ID! }) : null,
  copyText: (text) => navigator.clipboard.writeText(text),
  now: () => Date.now(),
};

render(() => <App deps={deps} />, document.getElementById("root")!);

// 基本のスタイルを最初に読み込み、各画面のスタイルがその上に重なるようにする
import "../../ui/styles/tokens.css";
import "../../ui/styles/base.css";
import { render } from "solid-js/web";
import { browser } from "wxt/browser";
import { createManager } from "../../composition/manager";
import { chromeDownloads } from "../../infrastructure/downloads";
import { chromeLocalDriver } from "../../infrastructure/storage/drivers/chrome";
import { App } from "../../ui/app/App";
import { createI18n, resolveLocale } from "../../ui/i18n";

// OAuth App の Client ID はビルド時に WXT_GITHUB_CLIENT_ID で埋め込む（秘密情報ではない）
const clientId: unknown = import.meta.env.WXT_GITHUB_CLIENT_ID;

const manager = createManager({
  storage: chromeLocalDriver(),
  downloads: chromeDownloads(),
  oauthClientId: typeof clientId === "string" && clientId.trim() ? clientId.trim() : null,
});
const i18n = createI18n(resolveLocale(browser.i18n.getUILanguage()));
document.documentElement.lang = i18n.locale;

render(
  () => <App deps={{ manager, i18n, copyText: (text) => navigator.clipboard.writeText(text) }} />,
  document.getElementById("root")!,
);

import { defineConfig } from "wxt";

// 拡張機能のページから通信してよい宛先。トークンを付けるのは api.github.com と github.com だけ
const CONNECT_SRC = ["https://api.github.com", "https://github.com"];
// ダウンロードの転送先（アーティファクトと Release の添付ファイルの保存先）。署名つきの URL を得るために読むだけで、
// トークンは送らない（fetch が別のオリジンへの転送で Authorization を外す）
const DOWNLOAD_STORAGE = ["https://*.blob.core.windows.net", "https://release-assets.githubusercontent.com", "https://objects.githubusercontent.com"];

export default defineConfig({
  srcDir: "src",
  publicDir: "public",
  modules: ["@wxt-dev/module-solid"],
  imports: false,
  manifest: ({ command }) => ({
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    // 別のオリジンへの転送で Authorization を外す fetch に頼るため、その動きを確かめた版（Chromium 153）を下限にする
    minimum_chrome_version: "153",
    permissions: ["storage", "downloads"],
    host_permissions: CONNECT_SRC.map((origin) => `${origin}/*`),
    action: { default_title: "__MSG_extName__" },
    // 開発サーバーは localhost と通信するため、CSP はビルド時だけ付ける
    ...(command === "build"
      ? {
          content_security_policy: {
            extension_pages: [
              "script-src 'self'",
              "object-src 'none'",
              `connect-src ${[...CONNECT_SRC, ...DOWNLOAD_STORAGE].join(" ")}`,
              "img-src 'self' data: https://avatars.githubusercontent.com",
            ].join("; "),
          },
        }
      : {}),
  }),
});

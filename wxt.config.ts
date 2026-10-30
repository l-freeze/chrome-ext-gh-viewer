import { defineConfig } from "wxt";

// 拡張機能のページから通信してよい宛先。トークンを GitHub 以外へ送らないことを CSP でも保証する
const CONNECT_SRC = ["https://api.github.com", "https://github.com"];

export default defineConfig({
  srcDir: "src",
  publicDir: "public",
  modules: ["@wxt-dev/module-solid"],
  imports: false,
  manifest: ({ command }) => ({
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    permissions: ["storage", "downloads"],
    host_permissions: CONNECT_SRC.map((origin) => `${origin}/*`),
    action: { default_title: "__MSG_extName__" },
    // 開発サーバーは localhost と通信するため、CSP はビルド時だけ付ける
    ...(command === "build"
      ? {
          content_security_policy: {
            extension_pages: [
              "script-src 'self'",
              "object-src 'self'",
              `connect-src ${CONNECT_SRC.join(" ")}`,
              "img-src 'self' data: https://avatars.githubusercontent.com",
            ].join("; "),
          },
        }
      : {}),
  }),
});

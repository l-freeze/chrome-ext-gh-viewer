import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  // 拡張機能と同じブラウザ用の Solid を使う（Node 向けの版は状態の変化を追わない）。
  // Node に任せると Node 向けの版が選ばれるので、Vite に解決させる
  resolve: { conditions: ["browser"] },
  ssr: { resolve: { conditions: ["browser"] } },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    server: { deps: { inline: [/solid-js/] } },
  },
});

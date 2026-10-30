# Artifact & Issue Manager for GitHub

アクセスできる全リポジトリの GitHub Actions アーティファクトを一覧・ダウンロード・削除し、Issue を Projects に関係なく横断表示する Chrome 拡張機能です。

- 所有者（自分のアカウント・Organization）をチェックで選び、そのリポジトリだけを対象にできます
- 古い・大きいアーティファクトを絞り込み、まとめて削除またはダウンロードできます（削除は確認つき）
- Issue は所有者ごとに検索し、リポジトリ単位でまとめて表示します（現在は表示のみ）
- 画面は英語と日本語。ブラウザの言語に合わせ、どちらでもなければ英語になります

## 接続方法

| 方式 | 内容 |
|---|---|
| GitHub でログイン（OAuth Device Flow） | github.com でコードを入力して承認します。ビルド時に OAuth App の Client ID が必要です |
| Personal Access Token | Classic（`repo`, `read:org`）または Fine-grained（Actions: Read and write、Issues: Read、Members: Read）。Fine-grained は所有者ごとに 1 つ追加します |

トークンは `chrome.storage.local` にだけ保存され、`github.com` と `api.github.com` 以外には送信されません。拡張機能のページには `connect-src https://api.github.com https://github.com` の CSP を設定しています。

## 開発

```bash
npm install
```

```bash
npm run dev
```

OAuth を使う場合は、GitHub で OAuth App を登録して Device Flow を有効にし、`.env.local` に Client ID を書きます（Client Secret は不要です）。

```bash
echo "WXT_GITHUB_CLIENT_ID=<your client id>" > .env.local
```

| コマンド | 内容 |
|---|---|
| `npm run build` | `.output/chrome-mv3/` にビルド。`chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」で読み込めます |
| `npm run zip` | Chrome Web Store 提出用の ZIP を作成 |
| `npm run typecheck` | 型チェック |
| `npm test` | 単体テスト（Vitest） |
| `npm run e2e` | ビルドした拡張機能を Chromium に読み込み、GitHub API を偽の応答に差し替えて画面を操作するテスト（Playwright が必要） |

## 構成

```
src/
  api/          GitHub REST API の型・検証・呼び出し・エラー分類・Device Flow（画面に依存しない）
  domain/       絞り込み・並べ替え・集計・表示用の整形（純粋な関数）
  services/     認証情報の保存、トークンごとのリポジトリ把握と呼び出し先の振り分け
  platform/     chrome.storage / chrome.downloads との接続
  i18n/         英語・日本語の文言
  ui/           Solid の画面と状態
  entrypoints/  拡張機能の入口（background と管理画面）
test/           単体テスト
e2e/            拡張機能を読み込んだ E2E テスト
```

Issue への操作（クローズ、ラベル変更など）は、`api/client.ts` に呼び出しを、`ui/state/issues.ts` に結果を一覧へ反映する処理を足して追加する想定です。

## ライセンス

MIT

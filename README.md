# Artifact & Issue Manager for GitHub

アクセスできる全リポジトリの GitHub Actions アーティファクトを一覧・ダウンロード・削除し、Issue を Projects に関係なく横断表示する Chrome 拡張機能です。

- 所有者（自分のアカウント・Organization）をチェックで選び、そのリポジトリだけを対象にできます
- 古い・大きいアーティファクトを絞り込み、まとめて削除またはダウンロードできます（削除は確認つき）
- ワークフローの一覧と最新の実行を表示し、手動実行（`workflow_dispatch`）できます。入力項目はワークフローの定義に合わせて入力欄・プルダウン・チェックボックスになり、実行の前に必ず確認の画面を挟みます
- Issue は所有者ごとに検索し、リポジトリ単位でまとめて表示します（現在は表示のみ）
- 画面は英語と日本語。ブラウザの言語に合わせ、どちらでもなければ英語になります

## 手動インストール

Chrome ウェブストアには未公開のため、GitHub Actions がビルドした ZIP を手動で読み込みます。

1. このリポジトリの Releases から `master build`（タグ `master-build`）を開き、`chrome-extension.zip` をダウンロードします。`master` に push されるたびに最新のビルドに差し替わります。
2. ZIP を展開し、できたフォルダを消さない場所に置きます。Chrome はこのフォルダから拡張機能を読み込み続けます。
3. Chrome で `chrome://extensions` を開き、右上の「デベロッパー モード」をオンにします。
4. 「パッケージ化されていない拡張機能を読み込む」を押し、展開したフォルダ（`manifest.json` が入っているフォルダ）を選びます。
5. ツールバーの拡張機能アイコンを押すと管理画面が開きます。必要ならピン留めしてください。

このビルドには OAuth App の Client ID が入っていないため、接続方法は Personal Access Token だけです。

### 更新

新しい `chrome-extension.zip` をダウンロードし、手順 2 のフォルダの中身を置き換えてから、`chrome://extensions` で拡張機能の再読み込みボタン（円形の矢印）を押します。

同じフォルダから読み込む限り、設定と登録したトークンは引き継がれます。別のフォルダから読み込むと別の拡張機能として扱われ、設定とトークンは引き継がれません。

## 接続方法

| 方式 | 内容 |
|---|---|
| GitHub でログイン（OAuth Device Flow） | github.com でコードを入力して承認します。ビルド時に OAuth App の Client ID が必要です |
| Personal Access Token | Classic（`repo`, `read:org`）または Fine-grained（Actions: Read and write、Contents: Read、Issues: Read、Members: Read、Environments: Read）。Fine-grained は所有者ごとに 1 つ追加します |

Fine-grained の Contents: Read はワークフローの定義とブランチを読むため、Environments: Read は `environment` 型の入力を選択肢で出すために使います。Environments を読めない場合は自由入力になります。

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
| `npm run zip` | `.output/` に配布用の ZIP を作成（CI はこれを Release に置きます） |
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

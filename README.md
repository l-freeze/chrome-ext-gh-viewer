# Artifact & Issue Manager for GitHub

アクセスできる全リポジトリの GitHub Actions アーティファクトを一覧・ダウンロード・削除し、Issue を Projects に関係なく横断表示する Chrome 拡張機能です。

- 所有者（自分のアカウント・Organization）をチェックで選び、そのリポジトリだけを対象にできます
- 古い・大きいアーティファクトを絞り込み、まとめて削除またはダウンロードできます（削除は確認つき）
- Actions のキャッシュを全リポジトリ横断で一覧し、PR のキャッシュや使われていないキャッシュをまとめて削除できます（削除は確認つき）
- 古い実行履歴を、作成日・結果・ワークフロー名で全リポジトリから検索し、リポジトリ単位で選んでまとめて削除できます（ログとアーティファクトも削除されます。削除は確認つき）
- ワークフローの一覧と最新の実行を表示し、手動実行（`workflow_dispatch`）できます。入力項目はワークフローの定義に合わせて入力欄・プルダウン・チェックボックスになり、実行の前に必ず確認の画面を挟みます
- Issue は所有者ごとに検索し、リポジトリ単位でまとめて表示します（List。Issue の操作はまだありません）
- Projects の項目をプロジェクトごとのカンバンで表示し、カードをドラッグ＆ドロップするかキーボードの ← → で Status を変えられます（Kanban。Issue タブにマウスを合わせると List と Kanban を選べます）。PR とドラフトを表示するかはチェックで切り替えられます。プロジェクトに入っていない Issue は List にだけ表示されます
- Issue タブ（List と Kanban）は、開いている間、自動で取り直します（List は 1 分ごと、Kanban は 2 分ごと）。ページが見えていない間は止まり、戻ったときに間隔以上たっていればすぐに取り直します。上部の「自動更新」で切り替えられ、既定はオンです
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
| Personal Access Token | Classic（`repo`, `read:org`, `project`）または Fine-grained（Actions: Read and write、Contents: Read、Issues: Read、Members: Read、Environments: Read、Organization の Projects: Read and write）。Fine-grained は所有者ごとに 1 つ追加します |

Fine-grained の Contents: Read はワークフローの定義とブランチを読むため、Environments: Read は `environment` 型の入力を選択肢で出すために使います。Environments を読めない場合は自由入力になります。

カンバンには `project` スコープ（Fine-grained では Organization の Projects 権限）が必要です。このスコープを追加する前に GitHub でログインした場合は、一度ログアウトしてログインし直してください。個人アカウントのプロジェクトを Fine-grained PAT で扱えるかは確認できていません。

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
  features/      業務の機能（workspace / settings / artifacts / caches / actions / issues / projects）
  integrations/  GitHub という外部サービスとの接続
  infrastructure/ 汎用の技術基盤（HTTP 送信・保存先・ダウンロード）
  lib/           仕組みだけの道具（検証・同時実行・並べ替え・時間）
  composition/   具体的な実装を選んで機能をつなぐ
  ui/            Solid の画面
  entrypoints/   拡張機能の入口（background と管理画面）
tests/           単体テスト（持ち主ごと）
e2e/             拡張機能を読み込んだ E2E テスト
```

境界と依存の向き、機能を足すときの判断は [docs/architecture.md](docs/architecture.md) にまとめています。

## ライセンス

MIT

# アーキテクチャと境界

## ディレクトリを分ける基準

まず「誰が持つか」で分け、機能の中は役割で分けます。
ファイル名は、親ディレクトリで分かる文脈を繰り返さず、その中で何を担当するかを表します。

```text
src/
├── features/                 業務の機能。タブとは一対一でなくてよい（下の「機能と画面」）
│   ├── workspace/            所有者とリポジトリ（全タブが使う共通の語彙）
│   ├── settings/             接続方法と認証情報（OAuth Device Flow・PAT）
│   ├── artifacts/            アーティファクト
│   ├── caches/               Actions のキャッシュ
│   ├── actions/              ワークフロー一覧・手動実行・実行履歴の整理
│   ├── issues/               Issue の横断検索（Issue タブの List）
│   ├── preferences/          画面をまたぐ表示の好み（自動更新のオン・オフ）
│   └── projects/             Projects のカンバンと、項目の Status の変更（Issue タブの Kanban）
├── integrations/github/      GitHub という外部サービスの約束ごと
├── infrastructure/           汎用の技術基盤（HTTP 送信、保存先、ダウンロード）
├── lib/                      仕組みだけの道具（検証、同時実行、並べ替え、時間）
├── composition/              具体的な実装を選んで機能をつなぐ
├── ui/                       Solid の画面
└── entrypoints/              WXT が決める入口（background と管理画面）
```

### 機能の中の役割

```text
features/artifacts/
├── artifact.ts        モデル（Artifact）と、期限の判定などモデル自体の規則
├── listing.ts         一覧の絞り込み・並べ替え・集計
├── ports.ts           画面から呼ぶ操作（ArtifactOperations）と、外への約束（ArtifactSource など）
├── use-cases/         ポートを順に呼ぶ処理（list / remove / download）
├── gateways/github.ts ポートの実装。GitHub の形をモデルに変換する
└── compose.ts         use-case と controller をつないで操作を作る
```

`controllers/` は、人が入力した値を受け取る操作にだけ置きます（`settings` の PAT の貼り付け、`actions` の手動実行の入力）。
それ以外の操作は画面から型付きで呼ばれるので、use-case に直接つなぎます。

## 依存の向き

- モデル・ポート・use-case は、gateway・integrations・infrastructure・ui に依存しない。
- gateway はポートを実装し、integrations と infrastructure を使う。
- integrations は機能を知らない。infrastructure は機能も外部サービスも知らない。lib は何も知らない。
- 画面は各機能の `ports.ts` の操作とモデルだけを使い、use-case や gateway を直接呼ばない。
- composition だけが、すべてを知って具体的な実装を選ぶ。

### 例外として認めているもの

| 例外 | 理由 |
| --- | --- |
| ほかの機能が `features/workspace/repository.ts` を読む | 所有者とリポジトリは全機能の共通の語彙で、どの機能にも属さないため。ほかの機能同士は読み合わない |
| `ui/errors.ts` と `ui/components/PermissionHint.tsx` が `integrations/github` のエラー型と権限の表を読む | GitHub のエラーの分類と、必要なトークンの権限を利用者に示すため。表示に限る |
| `ui/screens/actions` が `features/actions/dispatch.ts` の `WorkflowParseError` を読む | 定義を読めなかった理由を画面で区別するため |

`settings` と `workspace` は直接依存しません。画面（`ui/app/workspace.ts`）が設定の認証情報を `Identity` に変えて、作業範囲の取得に渡します。

## 外部とのやり取り

### HTTP

| 置き場所 | 持つもの |
| --- | --- |
| `infrastructure/http.ts` | 送信、タイムアウト、中断、通信エラーの区別、再試行の仕組み（いつ・どれだけ待つかは呼び出し側が決める）、`Link`・`Retry-After` の読み取り |
| `integrations/github/http.ts` | 送り先を `api.github.com` に限る制限、認証ヘッダー、レート制限を見た待ち時間の判断、ページ送り、エラーの分類 |
| `integrations/github/<分野>.ts` | その分野の JSON の型・形の検証・呼び出し（GitHub の項目名のまま返す） |
| `features/<機能>/gateways/github.ts` | GitHub の形を機能のモデルに変換する。削除で 404 を成功とみなすなど、機能としての扱いもここで決める |

どのリポジトリ・所有者をどのトークンで呼ぶかは `composition/github-access.ts` が決めます。
画面は、認証情報と作業範囲が変わるたびに `manager.access.update` で知らせます。

### 保存

`infrastructure/storage` の `typedStore` は、保存する値と読み出す値の検証を両方必須にします。
保存形式（キー・形）は各機能の `gateways/storage.ts` が持ちます。

## 画面

```text
ui/
├── app/          全体の枠（App、ヘッダー、作業範囲の状態、画面に渡す依存）
├── screens/      タブごとの画面と、その表示の状態（タブと一対一）
├── lists/        一覧の共通部品（リポジトリごとの取得結果、選択、確認つき一括削除、帯・見出しなど）
├── components/   小さな共通部品
├── i18n/         英語・日本語の文言
└── styles/       色などの変数と基本のスタイル（入口で最初に読み込む）
```

`screens/*/state.ts` には、絞り込み・選択・確認の段階・通知だけを置き、取得や削除は機能の操作を呼びます。

### 機能と画面

画面（タブ）を増やすときに機能を増やすかは、新しいデータや操作が必要かで決めます。

- 新しいモデルや GitHub API の新しい分野を扱う → `features/` に機能を足し、`screens/` に画面を足す
- 既存の機能を組み合わせて見せるだけ → `screens/` に画面だけを足す

例: Issue タブの Kanban は、Projects という新しい API の分野とモデル（プロジェクト・列・項目）を扱うため、`features/projects` と `screens/kanban` を足しています。List（`features/issues` と `screens/issues`）とは独立しています。

### 自動更新

- オン・オフは `features/preferences` が保存する
- いつ取り直すか（画面を開いていてページが見えている間、間隔、呼び出し数からの間隔の計算）は `ui/app/auto-refresh.ts`
- どの画面をどの間隔で取り直すかは `ui/app/App.tsx` にまとめる
- 何を取り直すかは各画面の状態の `poll()`。表示は消さず、変わったところだけ差し替える（`lib/reuse.ts`）。リポジトリごとに取得する一覧は `ui/lists/repo-results.ts` の `poll()` を使う

### ドラッグ＆ドロップ

- カードを掴む・運ぶ・落とす位置の判定と、キーボードでの移動は、画面だけの処理として `screens/kanban/KanbanScreen.tsx` に置く
- 落とした先の列（選択肢）を使って Status を変えるのは `features/projects` の `moveItem`
- 先に画面で動かし、失敗したら元の列へ戻す処理は `screens/kanban/state.ts` に置く
- 人が文字を入力する操作ではないので controller は置かない。移動先が選択肢にあるかは use-case で確かめる
- 画面を持たない機能（バックグラウンドの通知など） → `features/` だけを足す

## テスト

```text
tests/
├── lib/  infrastructure/          仕組みの入出力
├── integrations/github/           JSON の検証、HTTP の扱い、エラー分類、分野ごとの呼び出し
├── features/                      モデルの規則、偽のポートを渡した use-case、gateway の扱い
└── ui/                            文言と表示用の整形
e2e/                               ビルドした拡張機能を Chromium に読み込み、偽の GitHub で画面を操作する
```

内部の呼び出し順は確かめません。ただし GitHub へのリクエストの数と内容は、レート制限と実際の操作に直結する外から見える結果なので確かめます（例: ワークフローのないリポジトリでは実行履歴を取りにいかない、確認の前には削除や実行を送らない）。

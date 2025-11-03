# ReacLog

Slack や Git/GitHub のアクティビティを収集し、日次ログとして要約するための開発用ツール群です。Chrome DevTools Protocol (CDP) を介して Slack デスクトップアプリからメッセージやリアクションを取得し、将来的には Git/GitHub ソースも統合することを目指しています。

## 主な機能
- Slack デスクトップ (app.slack.com) への CDP 接続とイベント抽出
- メッセージ詳細の正規化・キャッシュ処理 (`src/index.ts`)
- CDP ポートフォワードや Slack 起動を補助するシェルスクリプト群 (`hack/`)
- アーキテクチャ仕様書 (`docs/spec.md`) に基づくログパイプライン構想

## ディレクトリ構成
```
├── src/              # TypeScript エントリポイント
├── docs/             # 仕様・設計ドキュメント
├── hack/             # WSL⇔Windows 連携や CDP 用スクリプト
├── package.json      # スクリプト定義・依存関係
└── AGENTS.md         # コントリビューションガイド
```

## 前提条件
- Node.js 18+（開発は LTS を推奨）
- pnpm 8 以上（`npm install -g pnpm` などで導入）
- Slack デスクトップアプリと Chrome/Edge がローカルで稼働
- CDP が有効な Slack セッション（`CDP_HOST`/`CDP_PORT` を環境変数で指定可能）

## セットアップ
```bash
git clone <this-repo>
cd reaclog
pnpm install
```

## 開発コマンド
```bash
pnpm start         # tsx 経由で Slack 収集プロセスを起動
pnpm run typecheck # TypeScript 型チェック
pnpm run lint      # ESLint による静的解析
pnpm run format    # Prettier でフォーマット検証
pnpm run qa        # typecheck + lint + format を連続実行
```

## Slack/CDP セットアップ
`hack/` ディレクトリのスクリプトを利用すると、WSL から Windows で動く Slack へのポートプロキシやブラウザ起動を整備できます。Slack を起動後、`chrome-remote-interface list` などで `app.slack.com` ターゲットが表示されることを確認してください。必要に応じて `CDP_HOST`/`CDP_PORT` を `.env` ではなくシェル環境からエクスポートし、トークンやクッキー等の資格情報は絶対にリポジトリへコミットしないでください。

## 仕様と今後の開発
データモデルや日次要約の詳細は `docs/spec.md` を参照してください。GitHub やローカル Git のアダプタ追加、JSONL 保存、LLM 要約機能はロードマップに含まれています。新しいモジュールやテストを追加する際は `AGENTS.md` に記載のコーディング規約と PR ガイドラインを遵守してください。

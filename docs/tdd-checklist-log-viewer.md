# SvelteKit ログビューア TDD TODO

## 0. ワークスペース準備

- [x] (RED) `apps/browser` 向けの最初の失敗テストを用意できるよう、`pnpm-workspace.yaml` にパッケージを追加するテストを作成する
- [x] (GREEN) `apps/browser` ディレクトリと `package.json`/SvelteKit 初期ファイルを追加しテストを成功させる
- [x] (REFACTOR) 共有 ESLint/TSConfig 設定を再利用できるよう設定ファイルを整理する

## 1. データ読み込みラッパ (`src/lib/server/data.ts`)

- [x] (RED) `vitest` で JSONL/Markdown を読み出す失敗テストを追加し、存在しない `readDailyEvents`/`readDailySummary` を呼び出す
- [x] (GREEN) `dataDir` 設定読み出しとファイル入出力を実装しテストを通す（タイムゾーンとソートを最小実装）
- [x] (REFACTOR) 例外処理とキャッシュ層を整理し、型定義を `types.ts` に切り出す

## 2. ルート `/`（ダッシュボード）

- [x] (RED) `+page.server.test.ts` で最新7日分のサマリカード読み込み失敗テストを追加
- [x] (GREEN) `+page.server.ts` と `+page.svelte` を実装し、件数メタと CDP ステータスを表示してテストを成功させる
- [x] (REFACTOR) ローカライズ済み日付フォーマッタとコンポーネント分割を行う

## 3. ルート `/day/[date]`

- [x] (RED) 日付別タイムラインとソースフィルタのロードテストを追加
- [x] (GREEN) `load` フックで JSONL を読み取り、タイムライン表示コンポーネントを実装する
- [x] (REFACTOR) フィルタ状態を URL クエリと同期させつつストアを導入する

## 4. ルート `/day/[date]/raw`

- [x] (RED) 生 JSONL 表示のテストを追加（存在しない日付で 404 になることも確認）
- [x] (GREEN) JSONL を行単位で表示するページを実装しテストを通す
- [ ] (REFACTOR) 行数が多い場合のバーチャルスクロール/遅延レンダリングを検討する

## 5. Markdown サマリ表示

- [x] (RED) サマリファイルの有無に応じて表示/非表示が切り替わるテストを追加
- [x] (GREEN) `/day/[date]` ページ右カラムでマークダウンをレンダリングする
- [x] (REFACTOR) 共通の Markdown レンダラを `lib/components` に抽出する

## 6. CDP ヘルスステータス

- [x] (RED) モックエンドポイントからステータスを取得する失敗テストを追加
- [x] (GREEN) `load` でヘルス API を叩き、UI に接続状態/更新時刻/Slack 収集オンオフを表示する
- [ ] (REFACTOR) ポーリング/リアルタイム更新のための `load` + `sse`/`websocket` 下準備を整える

## 7. エンドツーエンド風テスト

- [x] (RED) `pnpm --filter browser test` で `dataDir` を tmp に向けた統合テストを追加
- [x] (GREEN) 仮想データセットからルートの SSR 出力を検証しテストを通す
- [ ] (REFACTOR) CI 用に `pnpm run qa` へテストを連結し、不要なモックを削除する

## 8. ドキュメント整備

- [ ] (RED) README のブラウザアプリ起動手順を更新するテスト（Check 確認用スクリプト）を検討する
- [x] (GREEN) `docs/spec.md` の SvelteKit セクションと整合するよう README・仕様を更新する
- [ ] (REFACTOR) スクリーンショット/操作ガイドを追加し、将来の拡張 TODO を整理する

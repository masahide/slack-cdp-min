# Slackイベント→JSONL 出力 TDD チェックリスト

`docs/spec.md` の Slack 収集アダプタ要件に沿って、`slack` ソースのイベントを `events.jsonl` へ追記可能にするまでの TDD サイクルを分割した TODO リストです。各項目は「テスト作成 → 実装 → リファクタ」の1サイクルで完了させ、必要ならより細かい粒度へ再分割してください。

## 1. 正規化ロジックの基盤
- [ ] `normalizeSlackMessage`（chat.postMessage 相当）に対する失敗するテストを追加（`uid`/`kind`/`actor`/`subject`/`detail.slack` を検証）
- [ ] テストを通す最小実装を追加し、`fromBlocks` 等のユーティリティを活用
- [ ] リファクタ：重複ロジックを整理し、型定義 (`NormalizedEvent`) を共有化
- [ ] `normalizeSlackReaction` の失敗テストを追加（`action` や `meta.emoji` 相当の扱いを検証）
- [ ] リアクション正規化を実装し、共通の `uid` 生成規則と冪等性を確認
- [ ] 共通フォーマッタで `logged_at` 付与や JST 変換をカバーするリファクタリング

## 2. 取り込みアダプタの抽象化
- [ ] CDP 依存をモック化した `SlackAdapter` 用のインタフェース契約テストを追加（`start`/`emit` の呼び出し順を検証）
- [ ] `Fetch.requestPaused` と `Network.webSocketFrameReceived` のイベントを仮想入力するテストで、正規化関数が呼ばれることを確認
- [ ] 実装：テストで利用したモックに合わせたイベントハンドラを追加し、`emit` コールに `NormalizedEvent` を渡す
- [ ] リファクタ：例外処理と冪等キャッシュ (`uid` 去重) を共通化するヘルパを導入

## 3. JSONL ライタ層
- [ ] `JsonlWriter`（日付ディレクトリ生成 + append-only）に対するテストを追加（`YYYY/MM/DD/slack/events.jsonl` の生成と追記を検証）
- [ ] 実装：`fs.promises` を用いた最低限の追記処理を追加し、テストを通す
- [ ] リファクタ：パス生成と IO をユーティリティへ切り出し、エラー時のリトライ戦略を設計
- [ ] `emit` の統合テストを追加し、アダプタ経由で `JsonlWriter` が呼ばれることをモックで確認

## 4. 統合パイプラインの検証
- [ ] Slack アダプタと JSONL ライタを結合したエンドツーエンドテストを追加（仮想イベント入力 → JSONL 1行出力を検証）
- [ ] 実装：既存 `src/index.ts` からテスタブルなエントリポイントを切り出し、テスト環境で利用できるようにする
- [ ] リファクタ：ログ出力や構成値 (`CDP_HOST`/`dataDir`) を設定オブジェクトに集約し、テスト用のモック設定を可能にする

## 5. 品質ゲートとリグレッション防止
- [ ] Lint/Typecheck/Format を CI 的にまとめたテスト（`pnpm run qa`）を GitHub Actions などへ追加するテストまたは設定検証
- [ ] `events.jsonl` のスキーマ破壊を検知するスナップショット or スキーマ検証テストを追加
- [ ] 主要シナリオ（投稿・スレッド・リアクション）について回帰用フィクスチャを整備し、テストに組み込む

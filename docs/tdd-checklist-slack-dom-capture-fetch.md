# Slack DOMキャプチャ Fetch トリガー TDD TODO

## 0. テスト基盤準備

- [x] (RED) `tests/slack/adapter.reactions.test.ts` を新規作成し、擬似 Slack クライアントで `/api/reactions.add` POST を処理した際に DOM キャプチャ用の `Runtime.evaluate` が呼ばれることを期待する失敗テストを書く
- [x] (GREEN) 共有モック（`tests/mockSlackClient.ts`）を利用しつつ `pnpm run test:slack` で局所テストを走らせるスクリプトを追加

## 1. Fetch リクエスト由来の DOM キャプチャ

- [x] (RED) `handleRequest` の `/api/reactions.*` 分岐で DOM キャプチャが走らない状態を示す失敗テストを追加し、`Runtime.evaluate` が呼ばれないことを検証
- [x] (GREEN) Fetch 分岐内で DOM キャプチャ候補を生成し `captureDomCandidate` を await する実装を追加してテストを通す
- [x] (REFACTOR) `buildReactionDomCandidate` を再利用できるよう更新し、Fetch 分岐でも共通ロジックを使用

## 2. 自分のユーザー ID でのフィルタリング (保留)

- [ ] (NOTE) JSONL への記録が自分の `/api/reactions.*` POST に限定されることを確認済み。追加フィルタは当面見送るが、仕様変更時に再検討する

## 3. WebSocket ルートの調整

- [x] (RED) WebSocket フレーム由来で他人リアクションでも DOM キャプチャが走ることを示す失敗テストを追加
- [x] (GREEN) WebSocket 経路での DOM キャプチャを停止し、他人リアクションでも発火しないよう修正
- [x] (REFACTOR) WebSocket 専用の DOM キャプチャ補助関数を削除し、`REACTION_PAYLOAD_KEYS` の利用箇所を整理

## 4. エンドツーエンド確認

- [x] (CHECK) `pnpm run qa` を実行し、新テストを含めた全タスクが成功することを確認
- [x] (GREEN) DOM キャプチャが Fetch 経由のみで発火することを説明し、手動検証手順を `docs/spec.md` に追記
- [x] (REFACTOR) README のデバッグセクションに Fetch トリガー仕様と手動検証手順を追加

## 5. クリーンアップ

- [x] (REVIEW) テスト内のユーザー ID をダミー値へ統一し、機密情報が含まれないことを確認
- [x] (REVIEW) `pnpm run qa` を再実行し、`git status` で差分を確認
- [ ] (DONE) Conventional Commit 形式（例: `feat: limit dom capture to own reactions`）でコミットし、TODO チェックリストのステータスを更新する

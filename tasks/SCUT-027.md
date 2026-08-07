# SCUT-027 operation・settings・project 型の適正化

## 目的

共通 lifecycle を維持しながら、mode や operation kind に存在しない値を型で許可しないようにする。

## 変更範囲

- `gui/electron/project-schema.ts`
- operation runner/coordinator とテスト
- API設定入力型
- project base/adapters とテスト

## 禁止事項

- 永続化 schema version と保存JSON形式を変更しない。
- 既存 sidecar の読み込み互換処理を追加・削除しない。
- API endpoint や request payload を変更しない。

## 完了条件

- [x] persistent operation が kind ごとの discriminated union になる。
- [x] operation kind と永続化 task slot の不一致を TypeScript が拒否する。
- [x] Cut transcription と Sub lyrics analysis のAPI入力型が必要な設定だけを要求する。
- [x] project base の Cut 固有 selection が Cut adapter に移る。
- [x] project/operation/settings 関連テストと typecheck が成功する。

## テスト方法

- Unit: GUI全テスト
- Static: GUI typecheck
- Regression: project sidecar round-trip、operation lifecycle

## 停止条件

- 保存形式変更または migration が必要になった場合。

## 実施証跡

- `ProjectOperationRecord` を kind 判別共用体にし、transcription だけが再開用 `settings` / `pending_segment_ids` を保持する型へ縮小した。runtime validator は既存sidecar互換のため変更していない。
- `OperationIdentity` で永続task slotとoperation kindを対応付け、不一致とSub operationへのtranscription設定混入をcompile-time testで固定した。
- transcription / lyrics-analysis APIの設定入力を、実際のrequest payloadで参照するfieldだけに分割した。endpointとpayloadは変更していない。
- `selectedSegmentId` をproject base compose/hydrate型から外し、Cut adapterだけが`view_state.selected_segment_id`を受け渡す。Subは従来どおり`null`を保存する。
- `npm run typecheck` 成功。
- 対象Vitest: 3 files / 22 tests 成功。全Vitest: 45 files / 274 tests 成功。
- `git diff --check` 成功（既存のLF→CRLF警告のみ）。

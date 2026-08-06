# SCUT-025 Panel 入力境界の統一

## 開始前確認

- ブランチ: `codex/sub-mode`
- HEAD: `9974472a7e92e031db3a8b3afb5c37f9f41b8af6`
- 既存変更: `assets/docs-image-source.pptx`、`docs/USAGE*.md`、`docs/image/*`、未追跡 `AGETNTS.md`。すべて対象外として保持する。
- 依存タスク: なし
- 参照: `AGENTS.md`、`CODEX.md`、`docs/GUI_FOCUS_POLICY.ja.md`
- 既存変更との重複: 対象ソースとテストには確認時点で重複なし

## 目的

Cut/Sub Panel を同じレイヤー境界へそろえ、Panel が Application・Platform 層の具体物を直接操作しないようにする。

## 変更範囲

- `gui/src/App.tsx`
- `gui/src/components/CutModePanel.tsx`
- `gui/src/components/SubModePanel.tsx`
- Panel 用 view/action 型と関連テスト

## 禁止事項

- UIの操作順、文言、focus契約を変更しない。
- Cut/Sub のドメイン state を一つの型へ統合しない。
- 新規パッケージや状態管理ライブラリを追加しない。
- 既存の未コミット変更を編集しない。

## 完了条件

- [x] 両 Panel が `ModePanelViewModel` を共通 view として受ける。
- [x] 両 Panel が `ModeController`、Cut/Sub operation coordinator を受け取らない。
- [x] 両 Panel から `window.songcut` と `window.confirm` の直接呼び出しがなくなる。
- [x] Sub の analyze/export/model preparation は Panel 外の callback へ移る。
- [x] GUI unit test と TypeScript typecheck が成功する。

## テスト方法

- Unit: `pnpm test`
- Regression: commonization contract、mode session、Sub operation 関連テスト
- Static: `pnpm run typecheck`
- 実環境確認: UI仕様を変更しないため本タスクでは必須としない

## 停止条件

- 公開 IPC/schema の変更が必要になった場合。
- 既存変更と対象ファイルが競合した場合。

## 完了証拠（2026-08-05）

- `modePanelContract.ts`へSub Panel用のcapability、operation view、intent actionを定義した。
- `SubModePanel.tsx`から`ModeController`、`SubOperationCoordinator`、`WhisperSettings`、`window.songcut`、`window.confirm`への依存を削除した。
- Demucs→Whisper→必要時MMSの準備、出力先選択、font列挙、削除確認をAppのcomposition境界へ移した。
- `selectedSubtitleSegment`をoperation moduleからsubtitle domainへ移し、Panelからoperation moduleへのruntime依存を削除した。
- 新契約へ先に更新したbaseline testは2件失敗／269件成功。実装後はGUI Vitest 45 files／271 tests成功、`pnpm run typecheck`成功、対象`git diff --check`成功。
- UI、IPC、永続化schema、focus primitiveは変更していない。既存の利用者変更は対象外として保持した。

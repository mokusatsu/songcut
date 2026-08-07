# SCUT-001 Cut/Sub 現行契約のテスト固定

- 目的: 共通化中に意図的差分を壊さないため、現行の境界、sidecar、viewport、保存契約を先に固定する。
- 変更範囲: `gui/src/lib/*.test.ts`、`gui/electron/*.test.ts`。production codeは変更しない。
- 禁止事項: 既知の不整合を正しい期待値として固定しない。Appやcomponentの構造変更を混ぜない。
- 完了条件:
  - Cutの秒単位自由境界とSubの拍スナップ／lane非重複が別policyとして観測可能なテストで表現される。
  - `.songcut`／`.sub.songcut`、revision駆動autosave、共通viewport計算の契約がテスト化される。
  - GUI typecheckと全Vitestが成功する。
- テスト: `pnpm run typecheck`、`pnpm test`。
- 停止条件: 現行仕様同士の矛盾、production変更がないとテスト可能にできない契約を検出した場合。
- 完了証拠 (2026-08-05):
  - Cutの小数秒境界、Subの拍スナップ付きnudgeとlane非重複、Cut/Sub sidecar分離、両modeのrevision autosave、共通viewport follow policyを6テストファイルで固定した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 25 files / 160 tests passed。
  - `git diff --check`: exit 0。

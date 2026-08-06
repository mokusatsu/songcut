# SCUT-008 Mode controller／capability の導入

- 目的: 選択、追加、削除、隣接移動、境界再生、nudgeをmode adapterで統一する。
- 変更範囲: 新規mode controller、`App.tsx`、両panel、menu state。
- 禁止事項: domain model統合、mode固有UIの共通化強制。
- 完了条件: UI/menu/keyboardがactive controllerを利用し、散在する主要`mode ===` command分岐がなくなる。
- テスト: controller unit、menu capability、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - `modeController.ts`へ選択、追加／削除、隣接移動、境界jump／preview／nudgeとavailability snapshotを集約した。
  - Appのeditor executor、menu state、Cut/Sub transportとSub追加／削除／選択をcontrollerへ接続し、editor-action内のmode分岐を除去した。
  - 不要になったSubの旧callback propsをレビューで削除し、controller経路を必須化した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 30 files / 188 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。

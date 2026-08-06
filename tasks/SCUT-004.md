# SCUT-004 Editor command dispatch の一本化

- 目的: menuとkeyboardの重複switchを廃止し、mode capabilityを一箇所で強制する。
- 変更範囲: `App.tsx`、`shortcuts.ts`、新規dispatcher/helper、関連テスト。
- 禁止事項: shortcut割当変更、Electron menu label変更。
- 完了条件: 両入口が同じdispatcherを呼び、Cut専用export/segment管理がSubでno-opとなり、共通操作は同じadapterへ到達する。
- テスト: dispatcher unit、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - menu/keyboard入力を`editorCommands.ts`で正規化し、App内の単一executorへ配線した。menu固有のload/open/save/relink/settingsは既存経路に維持した。
  - SubでCut専用の一括segment管理、export、診断を拒否し、両mode共通の追加／選択削除は維持した。
  - 実装レビューでSubの追加／削除が誤って無効化される回帰を検出・修正した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 27 files / 173 tests passed。
  - `git diff --check`: exit 0。

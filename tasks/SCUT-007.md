# SCUT-007 CutModePanel の抽出

- 目的: Appを共通session ownerにし、Cut/Sub workspaceの責任境界を対称にする。
- 変更範囲: 新規`CutModePanel.tsx`、`App.tsx`、関連component。
- 禁止事項: state ownershipを同時に全面変更、Cut機能削除、Sub変更。
- 完了条件: Cut toolbar/guide/timeline/listがpanelへ移り、Appはmedia/session/dialog/controller配線を担当する。
- テスト: 全Vitest、typecheck、build、Cut smoke重点確認。
- 完了証拠 (2026-08-05):
  - `CutModePanel.tsx`へtoolbar、guide、Cut timeline、segment listとCut-local表示helperを移し、SubModePanelと対称なworkspace境界を作った。
  - Appはmedia/session/project/persistence/jobs/dialog/command callbackのownerとして維持し、既存DOM class・i18n・ARIAを保持した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 29 files / 185 tests passed。
  - `cd gui; pnpm run build`: exit 0。
  - `git diff --check`: exit 0。CutブラウザsmokeはSCUT-015へ送る。

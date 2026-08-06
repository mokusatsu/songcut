# SCUT-005 境界ドラッグ lifecycle の共通化

- 目的: Cut/Subで異なるpointer処理と保存単位を一つにする。
- 変更範囲: 新規Hook/component、`App.tsx`、`SubModePanel.tsx`、component/unit test。
- 禁止事項: 見た目、snap policy、min durationの変更。
- 完了条件: pointer/mouse drag、cancel、listener cleanup、preview更新、release時1回commitを両モードが同じ実装で行う。
- テスト: drag event test、revision/commit count test、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - `useBoundaryDrag.ts`でpointer/mouseのglobal listener、preview、release時single commit、cancel/dispose、cleanupを共通化し、Cut/Sub両方へ配線した。
  - Subはfunctional state previewのみをmove中に行い、releaseでrevisionを1回更新、cancel/disposeで開始snapshotを復元する。Cutの0.1秒clampとcancel commit互換は維持した。
  - optional fallbackをレビューで削除し、Subのsingle-commit契約を必須propsとして型で強制した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 28 files / 180 tests passed。
  - `git diff --check`: exit 0。

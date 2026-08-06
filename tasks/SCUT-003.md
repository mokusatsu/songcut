# SCUT-003 AppMode と TimedEntity／BoundaryPolicy の共通化

- 目的: モード固有metadataを統合せず、共通する時間範囲操作だけを共有する。
- 変更範囲: 新規`lib/modes.ts`、`lib/timeRange.ts`、`boundaries.ts`、`segmentTiming.ts`、`subtitles.ts`とテスト。
- 禁止事項: `Segment`と`LyricsSegment`の統合、API payload変更。
- 完了条件: `AppMode`がsubtitle domainから独立し、Cut/Sub policyがmin duration、snap、neighbor constraint、nudgeを表現し、既存挙動を保持する。
- テスト: pure unit、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - `modes.ts`へ`AppMode`を移し、`timeRange.ts`とdomain-neutralな`BoundaryPolicy`を追加した。
  - Cutの自由小数秒＋0.1秒minimum、Subの拍snap＋厳密neighbor制約＋nudgeをpolicyで表現し、Sub既存関数を共通resolver経由へ移した。
  - epsilon二重適用をレビューで検出・修正し、単一epsilon互換テストを追加した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 26 files / 170 tests passed。
  - `git diff --check`: exit 0。

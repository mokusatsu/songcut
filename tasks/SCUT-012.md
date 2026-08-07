# SCUT-012 設定の保存スコープ明確化

- 目的: app共通、mode別、project別の設定を型と保存処理で区別する。
- 変更範囲: settings types、project compose/hydrate、localStorage helper、SettingsDialog tests。
- 禁止事項: 利用者設定値のリセット、schema version bump、UI項目削除。
- 完了条件: 各設定のscope表がcode/testで表現され、mode切替後の期待値が自動テストで固定される。
- テスト: preferences/project tests、全Vitest、typecheck。
- 完了根拠（2026-08-05）:
  - `settingsScopes.ts`にapp／mode／projectの型、所有matrix、既存keyを保持したtyped storage helperを追加した。
  - app共通はscratch、boundary preview、layout、locale、Cut mode設定はnudge/refinement/create-folder/amplitude、Cut/Sub別waveform、Sub mode設定はstyle presetとして分離した。
  - project-ownedはanalysis device、Whisper/alignment、filename template、subtitle stateをschema v3のままcompose/hydrateする型境界へ接続した。
  - Appのinline localStorage read/writeをtyped helperへ移し、mode切替／project hydrateで別scopeの値を上書きしないようにした。
  - SettingsDialogのcontrol/tab scope表をコード化し、DOM不要のpure testを追加した。
  - exact key互換、malformed／storage例外fallback、Cut/Sub isolation、project抽出／round-tripをテストした。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 34 files / 218 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。

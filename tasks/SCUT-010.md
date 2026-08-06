# SCUT-010 Project schema のmode別不変条件整理

- 目的: schema v3 serializationを維持しながら、Cut/Sub固有fieldの混在を型とruntimeで検出する。
- 変更範囲: `project-schema.ts`、`project.ts`、project tests。
- 禁止事項: schema version bump、既存v3 sidecarの破壊的migration。
- 完了条件: internal discriminated typeまたはmode別assertが導入され、既存の正当なCut/Sub v3文書がround-tripする。
- テスト: legacy/current fixtures、store round-trip、全Vitest、typecheck。
- 完了根拠（2026-08-05）:
  - Cut/Sub operation kindとmode別document viewを型で分離し、`normalizeProjectDocument`でlegacyのmode省略Cutを非破壊のstrict viewへ変換できるようにした。
  - runtime validatorでCutへのsubtitle混入、SubへのCut analysis/segments/export candidates混入、modeとoperation kindの不一致を具体的エラーで拒否する。
  - parse/loadは入力objectを変更せず、schema version 3とmode省略Cutのround-trip互換を維持した。
  - 正当なCut/Sub atomic round-trip、legacy mode省略、Sub compose、mode別operation、mixed payload拒否をテストした。
  - リポジトリ内の実sidecar 11件を新validatorでparse成功。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 31 files / 202 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。

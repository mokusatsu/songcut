# SCUT-024 P4/P5 contract testと配布版回帰確認

- 開始証拠 (2026-08-05):
  - SCUT-023完了後、同一branch `codex/sub-mode`で順次開始した。SCUT-018～023の未commit変更は完了証拠付きの前提差分として保持する。
  - 開始時baselineは全Python pytest 382件成功／2件skip／36 subtests成功、GUI Vitest 44 files／262 tests、typecheck、production／portable build、Cut `E2E_OK`、Sub `SUB_E2E_OK`成功である。
- 目的: 追加共通化後の責務境界と意図的差分を自動テスト・実アプリで固定し、文書の完了状態を実配線と一致させる。
- 変更範囲: contract tests、E2E scriptsの必要最小限、task list証拠。
- 禁止事項: 既存E2E成功条件削除、テスト都合の仕様弱体化、Cut/Sub固有pipelineの統合。
- 完了条件:
  - App／panelが禁止された生API・runner importを持たないことをcontract検査できる。
  - Cut 0.1秒drag／0.001秒dialog、Sub rhythm／non-overlap、mode別sidecar、全operation lifecycleが成功する。
  - typecheck、全Vitest、pytest、build、再build済みCut/Sub E2E、`git diff --check`が成功する。
  - 実行不能な実環境検証がある場合は`実環境検証待ち`として理由と範囲を記録する。
- 停止条件: model、fixture、対話desktop不足時はローカル検証済みまで進め、実環境成功を推測しない。
- 完了証拠 (2026-08-05):
  - Appから生runner／mode coordinator hookを除去し、新規`useModeOperations`が共通runnerを一度生成してCut/Sub coordinatorへ注入するcomposition境界へ移した。両panelは共通`ModePanelViewModel`とmode coordinatorだけを受け取る。
  - GUI横断contractでApp／panelの禁止依存、共通runner注入、mode別sidecar、5種の永続operation lifecycle、`subtitle-render`の非永続task lifecycleを固定した。既存boundary／dialog testでCut 0.1秒drag・0.001秒dialogとSub rhythm／non-overlapも維持した。Python横断contractでWhisper 3 callerの共通sessionとcaller固有offset、Cut/Sub FFmpeg共通runnerと固有progress／validationを固定した。
  - 最終検証はGUI Vitest 45 files／271 tests、typecheck、Python pytest 385 passed／2 skipped／36 subtests passed、production build、`git diff --check`が成功した。
  - portable版1.1.58を再buildした。Cut通常E2Eは343.6秒で`E2E_OK`（menu、shortcut、autosave、0.001秒dialog、background転写chunk、clip／TS export）、Sub実データE2Eは603.8秒で`SUB_E2E_OK`（39字幕、rhythm／non-overlap、PNG cache、overlay、2 laneのSRT／style、394.378秒の字幕動画）まで成功した。

# SCUT-023 FFmpeg process runner の共通化

- 開始証拠 (2026-08-05):
  - SCUT-022完了後、同一branch `codex/sub-mode`で順次開始した。SCUT-018～022の未commit変更は完了証拠付きの前提差分として保持する。
  - 開始時baselineは全Python pytest 374件成功／2件skip／36 subtests成功、GUI Vitest 44 files／262 tests、typecheck、production／portable build、Cut `E2E_OK`、Sub `SUB_E2E_OK`成功である。
- 目的: Cut smart exportとSub subtitle exportに分散したprocess起動、stderr保持、return code、progress解析を共通primitiveへ移す。
- 変更範囲: `ffmpeg_tools.py`または新規process module、`smart_export.py`、`subtitle_export.py`、関連pytest。
- 禁止事項: smart render計画とsubtitle filter commandの統合、encoder設定変更、出力形式変更。
- 完了条件:
  - 共通runnerがWindows no-window、stdout／stderr、tail、終了判定、任意progress callbackを扱う。
  - Cut/Subはcommand生成と進捗配分だけを固有に保持する。
  - failure messageに既存以上の診断情報が残る。
- テスト: fake process、非0終了、progress protocol、UTF-8 replacement、出力検証、既存smart export／subtitle export pytest。
- 停止条件: smart exportの同期実行契約とsubtitle exportのstreaming契約を同じAPIへ押し込む必要がある場合は、共通low-level primitiveを二つのwrapperから使う形に限定する。
- 完了証拠 (2026-08-05):
  - 新規`ffmpeg_process.py`へ同期／streaming runnerを分けて追加し、Windows no-window、UTF-8 replacement、stdout／stderr、bounded tail、return code、任意line callbackを共通化した。
  - smart exportは同期runner、subtitle burnはstreaming runner、字幕PNG生成とASS filter probeは同期runnerへ配線した。command生成、Subのprogress protocol／0.15～0.96配分、Cut/Sub固有の出力検証は各callerに維持した。
  - fake process、非0終了、UTF-8 replacement、tail、progress配線、smart no-video、Sub出力存在／size／durationのテストを追加した。対象pytestは35 passed、全pytestは382 passed／2 skipped／36 subtests passed、`compileall`と`git diff --check`も成功した。

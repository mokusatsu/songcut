# SCUT-022 Whisper execution session の共通化

- 開始証拠 (2026-08-05):
  - SCUT-021完了後、同一branch `codex/sub-mode`で順次開始した。SCUT-018～021の未commit変更は完了証拠付きの前提差分として保持する。
  - 開始時baselineは全Vitest 44 files／262 tests、typecheck、production／portable build、Cut `E2E_OK`、Sub `SUB_E2E_OK`成功である。
- 目的: Cut転写、Sub標準align、Uta-Alignに分散したWhisper model読込、runtime選択、CPU fallback、generate、chunk正規化を共通sessionへ集約する。
- 変更範囲: `transcription.py`、`lyrics_alignment.py`、`uta_alignment.py`、新規Whisper execution module、関連pytest。
- 禁止事項: alignment algorithm統合、chunk利用方法の統一、model選択仕様変更、strict device指定時の暗黙fallback追加。
- 完了条件:
  - 3経路が同じpipeline factoryとdevice fallback契約を使う。
  - Cutはsegment単位、Subはactive interval単位、Utaはrequest単位という入力分割を維持する。
  - timestampの絶対化とdomain result生成は各callerに残す。
- テスト: pipeline fakeによるdevice選択、auto CPU fallback、strict failure、language token、chunk timestamp、既存transcription／alignment pytest。
- 停止条件: Uta-Align backendのpipeline lifetimeが共通sessionと互換でない場合は、factoryとfallbackだけを共有し、request APIは固有に残す。
- 完了証拠 (2026-08-05):
  - 新規`whisper_execution.py`へOpenVINO pipeline factory、constructor／generateのauto時CPU fallback、strict device時のfallback禁止、language token付与、相対chunk／word timestamp正規化を集約した。
  - Cutはsegment、Sub標準alignはactive interval、Uta-Alignはrequest内active intervalという入力分割を維持し、media絶対offset、丸め、domain result生成は各callerに残した。
  - pipeline fakeでdevice選択、constructor／generate fallback、strict failure、language token、chunk sentinel、word属性を固定した。Main側の全`pytest -q`は374 passed／2 skipped／36 subtests passed、`compileall`と`git diff --check`も成功した。

# SCUT-013 Job progress dialog shell の共通化

- 目的: Cut/Subで重複するpending/running/completed/failed表示を共通部品へ移す。
- 変更範囲: 新規共通dialog、App、SubModePanel、CSS、tests。
- 禁止事項: task lifecycleや文言意味の変更。
- 完了条件: operation固有title/description/close policyをpropsで渡し、同型markupが重複しない。
- テスト: component state matrix、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - `JobProgressDialog.tsx`へqueued/running/completed/failed/cancelledの表示状態、進捗率clamp、message/error、close actionの共通shellを抽出した。
  - Subの歌詞解析／字幕export、Cut export、Whisper／Demucs／MMS model downloadの4系統を共通dialogへ移した。
  - operation固有の説明、互換性summary、転送byte表示、補足文、close label/policyはpropsとslotで保持した。
  - cancel時を含む既存の「隠す」／「閉じる」契約を維持し、状態matrix 10 testsで固定した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 35 files / 228 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。

# SCUT-009 Operation runner とSub operation永続化

- 目的: task registry、poll、成功／失敗、projectOperation、quit interruptionを共通化する。
- 変更範囲: 新規`useOperationRunner.ts`、App/Sub job orchestration、関連tests。backend endpointは維持する。
- 禁止事項: Cut/Sub解析pipeline統合、job REST契約変更、未定義resume実装。
- 完了条件: Cut/Sub foreground jobが共通runnerを通り、Subもrunning/clear/interruptedを文書へ記録し、失敗時task情報を保持する。
- テスト: fake job lifecycle、project persistence、全Vitest、typecheck、Python API test。
- 完了根拠（2026-08-05）:
  - `gui/src/lib/useOperationRunner.ts`にpending/start/poll/progress/success/failure、operationのrunning/clear/interrupted、foreground二重開始防止を集約した。
  - Cutのanalysis/transcription/exportとSubのlyrics-analysis/subtitle-exportを同じrunnerへ接続し、固有API・payload・結果反映は各callerのcallbackに残した。
  - transcriptionの部分失敗は成功callbackから`interrupted`と失敗segment IDを返し、既存resume契約を維持した。
  - runner単体テストで成功clear、progress反映、失敗task保持、interrupted、同一／別slotの二重開始防止、部分失敗operation保持を確認した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 31 files / 193 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。
  - Python API testはCodex同梱Pythonに`pytest`がなく実行不可（`No module named pytest`）。backend endpoint／schemaは変更していない。

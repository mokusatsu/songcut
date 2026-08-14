# SCUT-043 10秒遅延の行再解析と手動表示素保護

## 目的

歌詞本文または行境界の確定変更から10秒後に対象行だけを再解析し、同一行の旧taskを取消しながらmanual表示素を破壊せず更新する。

## 変更範囲

- 行ID別LineReanalysisCoordinator、10秒debounce、editing／drag／composition抑止
- line-job API、単一worker queue、queued／running協調cancel、AbortSignal polling
- revision／epoch guard、同一行置換、別行非干渉
- grapheme LCSとmanual element reconciliation、競合診断
- cache hit局所MMS／cache miss vocals自動再生成

## 禁止事項

- onChange、IME中、pointer move中、無効入力で再解析を予約しない
- 別行のtaskを同一行への再入で取消さない
- stale／cancelled結果をprojectへ適用しない
- manual境界・merge・blankを自動値で上書きまたは削除しない
- 全曲Whisper／MMSを通常の行再解析で再実行しない

## 完了条件

- eligible commit後9,999msでは未発火、10,000msで1回だけ発火する
- 同一行への再入で旧timer／polling／queuedまたはrunning jobが取消される
- 別行taskと単なるselection／mode変更は維持される
- text／timing／dragの途中状態から発火せず、cancel／Escapeはsnapshotを復元する
- manual表示素がLCS対応またはorphaned conflictとして保持される
- cache hitでは局所MMSだけ、missではvocals再生成後に対象行だけ解析される

## テスト方法

- GUI fake timers、IME、blur／Enter dedupe、drag lifecycle、別行非干渉
- API cancel、queued Future、running Event、status上書き防止、revision conflict
- reconciliation unit: unchanged、insert、delete、replace、manual orphan、blank
- integration: project switch／line delete／source change cleanup、cache hit／miss

## 停止条件

- running inferenceを取消結果から隔離できない場合
- manual constraintと新しい行範囲が矛盾し、ユーザー値を変更せず解決できない場合
- cache再生成に全歌詞解析が不可避な場合

## 実施証跡

- 2026-08-12: SCUT-042のGUI typecheck、全Vitest327件、本番build、変更E2E構文確認後に開始。branch `main`, HEAD `6bf1074`、SCUT-040〜042の未commit差分を継続保持
- 2026-08-12: backendへ`POST /lyrics-analysis/line-jobs`、冪等`DELETE /lyrics-analysis/line-jobs/{job_id}`、`cancelling`／`cancelled`状態、行scope別の旧job原子取消、単一worker queue、queued `Future.cancel()`、running cancel eventを実装した。取消後のprogress／completed／failed／cache mutationをguardした
- 2026-08-12: cache hitは保存済みvocalsから対象windowだけを局所MMS解析し、Demucs／Whisper／全曲MMSを再実行しない経路を実装。cache missはvocalsを再生成してartifactへ保存した後、同じ対象行だけを解析する
- 2026-08-12: GUIへ行ID別`LineReanalysisCoordinator`を実装。確定変更から固定10,000ms、9,999ms未発火、同一行のtimer／polling／jobだけを置換し、別行とselection／mode変更を維持する。結果適用はProject epoch、行ID、行／表示素revision、再解析epochでguardした
- 2026-08-12: 本文focus、行／表示素境界pointer-downを再入として同一行の旧taskを取消し、onChange、IME、数値途中入力、drag previewでは予約しない。blur／非IME Enter、成功したpointer-upだけをcommitし、Escape／pointer-cancel／無効dropはsnapshotへ復元する契約をunitで固定した
- 2026-08-12: grapheme LCS reconciliationを実装し、manual境界、merge、追加blank、stable IDを保持。対応不能なmanual要素は削除せず`orphaned_manual`／`text_conflict`として残し、manual要素を包含しない新行境界は確定前に拒否する
- 2026-08-13: 全Python test `472 passed, 2 skipped`、GUI typecheck、全Vitest `55 files / 344 tests`、本番build、最新Cut／Sub E2Eスクリプトの構文確認が成功した
- 2026-08-13: Windows portable版Cut E2Eは`E2E_OK`、Sub E2Eは`SUB_E2E_OK`で完走。実解析、表示素編集、Style／Effect、project autosave、SRT／ASS／焼き込み動画出力まで確認した
- 2026-08-13: 1060x720／1440x960で右panelとtoolbarの実画面を確認し、クリック不能な操作と横overflowが0であることを確認した
- 2026-08-13: `docs/code-map`を現在の未commit差分から更新し、244 files／2,895 nodes／10,153 edges、parse errors 0、`maintain.ok=true`、`validate.ok=true`を確認した
- 2026-08-13: `.ck/`、`.ckignore`、`third_party/kiritan_singing`、`out/benchmarks`がGit除外され、DB本体・歌詞・label・派生reportが追跡対象に入っていないことを確認した
- 状態判断: 完了。10秒debounce、同一行だけの旧task取消、編集途中抑止、manual保護、cache hit／miss、stale guardをunit／API／portable E2Eで確認した

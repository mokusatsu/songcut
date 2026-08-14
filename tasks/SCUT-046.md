# SCUT-046 Cut境界プレビュー停止と配布E2Eの安定化

## 目的

Cutの開始／終了境界プレビューが設定秒数で確実に停止することを実環境で確認し、配布E2Eが一時的な再生状態やタイマー競合に依存せず同じ契約を検証できるようにする。

## 変更範囲

- Cutの開始／終了境界プレビュー開始、停止タイマー、scratch audio、media stateの調査
- `packaging/e2e_dist_smoke.js`の境界プレビュー検証
- 必要なunit／integration testの追加

## 禁止事項

- SCUT-045のヘッダーやガイド確認Dialogを巻き戻さない
- 停止を検証せず、timeout延長やassert削除だけでE2Eを通さない
- Subの境界再生契約を暗黙に変更しない

## 完了条件

- Cutの開始／終了境界プレビューが設定秒数で停止する
- DOM clickと物理clickの双方で同じ結果になる
- 配布E2Eの境界プレビュー検証が連続3回成功する
- GUI typecheck、対象Vitest、`node --check packaging/e2e_dist_smoke.js`、`git diff --check`が成功する

## テスト方法

- wall-clock timeoutを停止判定に使わず、media時刻とgenerationを扱うpure state testで遅延pause、範囲置換、停止、loopを固定する
- 通常ビルドに対してCut配布E2Eの境界プレビュー区間を反復する

## 停止条件

- OS／Electron media backend固有の再現条件があり、製品仕様として許容範囲の判断が必要になる場合

## 実施証跡

- 2026-08-13: SCUT-045のCut配布E2Eで、再生開始はDOM click／物理clickとも確認できる一方、開始境界previewの停止待ちが2回連続timeout。SCUT-045の変更対象後に発生する独立課題として登録
- 2026-08-13: SCUT-047のローカル検証完了後に進行中へ遷移。branch `main`, HEAD `6bf1074`、SCUT-040〜047を含む既存dirty worktreeを保持して調査開始
- 2026-08-13: `App.tsx`の遅延`pause`イベントが新しい`playFrom`で設定したstopAtを無条件に消し、`onPlay`が選択segment終端へ再設定し得る競合を原因候補として確認。独立timerを増やさずgeneration付きrange playback primitiveへ集約する
- 2026-08-13: `gui/src/lib/playbackRange.ts`へgeneration付きrange playback stateを追加し、開始・停止・loop・明示取消をpure decisionとして分離。`App.tsx`のvideo timeupdate／play／pause／ended、seek、scratch、境界previewを同じrange sessionへ集約し、遅延pauseでは新sessionを消さない契約へ変更
- 2026-08-13: `playbackRange.test.ts`、`appComposition.test.ts`、`commonizationContracts.test.ts`の3 files / 22 tests成功。GUI typecheck、`node --check packaging/e2e_dist_smoke.js`、`git diff --check`成功
- 2026-08-13: 通常ビルド `packaging/build_dist.ps1` 成功（version 1.1.76）。`dist/songcut-win-x64/songcut.exe`、runtime、app/dist、app/dist-electron、electron/songcut-electron.exe、README.txtを確認
- 2026-08-13: 配布E2Eの固定0〜2秒期待値を、実際のprimary選択segment境界から算出する検証へ修正。選択中`guide-002`（2〜4秒）、設定1秒に対し、DOM click／物理clickとも開始previewは3.000秒、終了previewは4.000秒へ停止する境界ブロックが3回連続成功。3回目は`SONGCUT_E2E_BOUNDARY_PLAYBACK_ONLY=1`で対象ブロック完了後に正常終了
- 2026-08-13: 最初の2反復は境界ブロック成功後、別契約であるWhisper backend完了表示の既存10秒待機で失敗。境界再生の成否とは分離し、最終全体E2E時に再確認する
- 状態判断: 完了

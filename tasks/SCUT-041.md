# SCUT-041 Standard Align表示素タイミング検出

## 目的

Standard Alignの最終行区間を固定したままMMS/CTCの局所証拠から表示素タイミングを生成し、品質不足時も単調で連続したpartitionを返す。

## 変更範囲

- 原文grapheme／日本語表示素分割、発音、MMS token対応
- MMS token span、局所CTC、品質判定、部分補間、行比例fallback
- Standard Align API結果とGUI model／schema v3 optional field
- 再起動後の局所解析に使うvocals artifact cache
- きりたん歌唱DBをローカル入力とする非再頒布benchmark runner

## 禁止事項

- Uta Alignへ表示素生成を追加しない
- 行境界や周辺行を表示素解析から変更しない
- 表示素へbeat snapを適用しない
- MMS全曲logitsを永続化しない
- kiritan_singingのWAV、歌詞、label、派生timingをGitへ追加しない

## 完了条件

- Standard Align結果が表示素と品質診断を返す
- 表示素が行全体をblank込みで隙間・重複なく覆う
- token evidenceが不十分な部分だけ補間され、全体失敗時は発音量比例fallbackになる
- 既存opening補正と行timingの回帰が無い
- vocals cacheがfingerprint／model／preprocessで検証され、24時間・2GiB LRUで管理される
- kiritan benchmarkが指定対象・行分割・精度指標を再現可能に計算する

## テスト方法

- Python unit: segmentation、pronunciation map、token span、quality gates、fallback、cache
- API test: Standard結果のelements、schema互換、artifact metadata
- GUI unit: analysis result変換、project roundtrip、旧v3欠落field
- 合成CTC fixtureによる通常test
- ローカルkiritan benchmark: 8曲以上、24行以上、内部境界200件以上

## 停止条件

- 既存MMS runnerからtoken evidenceを安全に取得できない場合
- kiritan利用条件に反する追跡／配布が必要になる場合
- 実音源の合格基準を満たすため行timingを変更する必要が生じた場合

## 実施証跡

- 2026-08-12: SCUT-040の型検査、GUI全テスト、本番build、変更E2E構文確認成功後に開始。branch `main`, HEAD `6bf1074`、SCUT-040までの未commit差分を継続保持
- 2026-08-12: 表示素分割、文脈発音対応、MMS token span、局所CTC、品質gate、部分補間／行比例fallback、VAD由来blank、連続partitionを実装。Standard Alignは既存全曲emissionsを共有し、最終行境界を変更せず詳細境界を生成する
- 2026-08-12: vocals artifact cacheを24時間・2GiB LRU、source fingerprint／model／preprocess検証、atomic manifestで実装。MMS logitsは保存せず、API cache hit試験でDemucsの再実行がないことを確認
- 2026-08-12: schema v3へoptional表示素／revision／diagnostics／artifact fieldを追加し、field欠落の旧v3 roundtripを維持。GUI typecheck成功、対象Vitest 28件成功
- 2026-08-12: Python対象テスト `80 passed, 1 skipped`、変更E2E `node --check packaging/e2e_sub_mode.js`、`git diff --check`成功
- 2026-08-12: ローカル限定きりたん歌唱DB（©SSS、Ogawa & Morise (2021)）で08／29を除外し、8曲・24行・381内部境界を評価。中央値28.5ms、P90 108.9ms、順序／包含／partition違反0で合格。blank件数差は不足5／余分6として独立記録。詳細reportはignoredな`out/benchmarks/kiritan_prediction_8x3_final.json`
- 2026-08-13: 現コードからきりたん歌唱DBの局所MMS推論を再実行（CPU、39.5秒）。8曲・24行・381内部境界、中央値28.5317ms、P90 108.8587ms、順序／包含／partition違反0、08／29自動除外で再度合格した。生予測とsummaryはignoredな`out/benchmarks/kiritan_prediction_8x3_final_recheck.json`へ保存した
- 2026-08-13: 全Python test `472 passed, 2 skipped`、GUI schema v3旧field欠落roundtripを含む全Vitest `55 files / 344 tests`、typecheck、本番build、Cut／Sub portable E2Eが成功した
- 状態判断: 完了。Standard Align限定の表示素検出、artifact cache、schema v3互換、ローカル実音声benchmarkを含む完了条件を満たした

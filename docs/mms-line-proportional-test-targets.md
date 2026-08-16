# MMS `line-proportional` テスト対象一覧

## 目的

この文書は、現行のStandard Align表示素タイミング経路でMMS/CTCの行が
`line-proportional`へfallbackした、間違えやすいテスト対象を固定するための一覧である。
アルゴリズムの候補一覧ではなく、実音声benchmarkで再確認すべき歌詞行と、
fallbackを誤って見逃しやすいfixtureを記録する。

## 現行snapshotでの対象

根拠にしたのは、リポジトリ内にある最新の8曲×各3行のMMS出力
`out/benchmarks/kiritan_prediction_8x3_final_recheck.json` である。
`algorithm` は `Standard Align MMS local CTC`、`device_requested` は `cpu`。
`line_index` は0始まりである。

このsnapshotでは24行中7行が、行内の全表示素の `source` が
`line-proportional` になっている。全7行とも `coverage=1.0` なので、
音素数が揃っていても品質gateで不採用になるケースとして扱う。

| 曲ID | 行 | 歌詞 | 主な `rejection_reasons` | 間違えやすい診断値・特徴 |
|---|---:|---|---|---|
| `02` | 1 | `あることしんじているいつまでも` | `star_ratio` | `star_ratio=0.6888`、speed=`4.1543` |
| `03` | 2 | `のを` | `star_ratio` | `star_ratio=0.9543`、`boundary_conflict=true`、`overflow_before=0.0004305` |
| `04` | 0 | `あいどろいどやけにまじっぽいぞ` | `isolated_first_token` | `isolated_first_token=true`、`star_ratio=0.3835` |
| `05` | 2 | `みらいえと` | `star_ratio` | `star_ratio=0.9534`、`window_edge_concentration=0.625`、`boundary_conflict=true`、speed=`10.2564` |
| `06` | 2 | `ひみつなの` | `star_ratio` | `star_ratio=0.8408`、`next_anchor_displacement=0.3011`、speed=`9.0164` |
| `07` | 2 | `いつだってすすめあばんちゅる` | `star_ratio` | `star_ratio=0.5778`、speed=`9.5238` |
| `09` | 2 | `ひとりじゃすすめないのです` | `star_ratio` | `star_ratio=0.5897`、`low_confidence=0.1984`、speed=`5.6373` |

## SCUT-067 test-only probe（2026-08-16）

上表の7行について、`tools/probe_omniasr_ctc_targets.py`でローカルの
`omniASR-CTC-300M-openvino-fp16`をCPU実行した。MMSの結果や本体の表示素を変更せず、
行target＋次行3文字のCTC強制整列だけを行った比較である。境界誤差は、現行snapshotの
`line-proportional`結果と、probeのblank=0候補を、同じGTの表示素終端で比較した。

| 曲/行 | 現行中央値 / P90 (秒) | omni候補中央値 / P90 (秒) | 判定 |
|---|---:|---:|---|
| `02/1` | `1.0244 / 1.4870` | `0.3709 / 0.9502` | 明確な改善候補 |
| `03/2` | `0.5136 / 0.9245` | `1.3318 / 2.1441` | 悪化 |
| `04/0` | `0.5756 / 0.8574` | `0.3160 / 0.5177` | 境界は改善、品質根拠不足 |
| `05/2` | `0.8034 / 0.9275` | `0.1608 / 0.9737` | 中央値のみ改善、P90悪化 |
| `06/2` | `0.0768 / 0.2392` | `0.2185 / 0.3927` | 悪化 |
| `07/2` | `0.0646 / 0.1291` | `0.1417 / 0.2632` | 悪化 |
| `09/2` | `0.1580 / 0.5205` | `0.2824 / 0.3577` | 中央値悪化、P90のみ改善 |

公式`omniASR_tokenizer.model`を取得し、`tokens.txt`の9812 pieceと全ID一致することを確認した。
CTC blankは公式fairseq2の`ctc_loss`既定値に合わせてID 0（piece `<s>`）とした。frame mappingも
現行IRの`[1,16000]`→`[1,49,9812]`で320 samples（0.02秒）を確認し、manifestへ固定した。
`manifest.json`とApache-2.0の`LICENSE`はartifactへ追加したが、公式モデルリポジトリには別個の
`NOTICE`はない。また、既存OpenVINO変換のconverter revisionは記録されていない。したがって、
02/1と04/0を含む候補結果だけでomniASR採用を決めず、上表の7対象を引き続き回帰対象とする。

## SCUT-071 修正後の4系列比較（2026-08-16）

SCUT-067の旧結果は、`ctc_token_end`を表示素の終了境界として採点し、固定値
`0.02秒/frame`で絶対時刻へ換算していたため、下表の採用性能比較から除外する。
修正後は、各表示素のonsetを取得し、内部境界を「GT表示素の終端から次表示素の
予測onset」へ統一した。最終表示素の行末は内部境界に含めず、最終partitionは
既存の`align_display_elements`で生成した。

| 曲/行 | Standard Align final median / P90 (秒) | `line-proportional` median / P90 (秒) | Everyric2準拠 omni median / P90 (秒) | SCUT-067局所＋anchor median / P90 (秒) |
|---|---:|---:|---:|---:|
| `02/1` | `N/E`（境界数不一致） | `N/E`（境界数不一致） | `0.0364 / 0.2204` | `N/E`（先頭blank追加で境界数不一致） |
| `03/2` | `1.0273 / 1.0273` | `1.0273 / 1.0273` | `1.0273 / 1.0273` | `1.0273 / 1.0273` |
| `04/0` | `0.5964 / 0.8606` | `0.5964 / 0.8606` | `0.5428 / 0.6886` | `0.5428 / 0.6886` |
| `05/2` | `0.8341 / 0.9380` | `0.8341 / 0.9380` | `0.6982 / 0.9978` | `0.6982 / 0.9978` |
| `06/2` | `0.1446 / 0.2437` | `0.1446 / 0.2437` | `0.1446 / 0.2051` | `0.1446 / 0.2051` |
| `07/2` | `0.0778 / 0.1318` | `0.0778 / 0.1318` | `0.0169 / 0.0862` | `0.0169 / 0.0862` |
| `09/2` | `0.1925 / 0.5217` | `0.1925 / 0.5217` | `0.3042 / 0.6355` | `0.3042 / 0.6355` |

集約値は、Standard Align finalが`46/62`境界評価可能、median=`0.2347`、P90=`0.8514`、
`line-proportional`も同じ値、Everyric2準拠omniASRが`62/62`、median=`0.1213`、
P90=`0.6804`、SCUT-067局所＋anchorが`46/62`、median=`0.2021`、P90=`0.6870`だった。
4系列ともordering／containment／partition違反は0件である。`N/E`は短い側へ
`zip`せず、境界数不一致を明示した結果であり、改善値へ補完していない。
onsetのみの集約はEveryric2が`52`件、MAE=`0.0334`、median=`0.0279`、P90=`0.0630`、
SCUT-067局所＋anchorが`52`件、MAE=`0.0311`、median=`0.0276`、P90=`0.0597`で、
いずれも1行は予測onset欠落のため`not_evaluable`となった。したがって、onset誤差と
最終partition境界誤差を混ぜずに解釈する。

Everyric2系列は同一曲を30秒chunk・5秒overlapで推論し、chunkごとの入力samples・
出力frames・frame-to-time比と、overlap中央所有方式を結果JSONへ保存した。行ごとの
再推論はせず、曲単位emissionから行前後0.2秒を切り出して現行行targetだけを強制整列した。
SCUT-067系列は比較対象として次行のtokenized先頭3 tokenをanchorへ使い、anchor所有範囲と
`anchor_start_error_seconds`を診断値へ分離した。

実行結果は`.codex-temp/omniasr-target-probe-scut071-final-20260816.json`、schemaは
`scut-071.onset-first.v1`である。対象は7行、Everyric2 chunk数は順に`12, 10, 11, 13, 13, 9, 13`。
公式artifact manifest revisionは`8e35f0cc28fa6099e0c14d56db85ce0423baa691`、
OpenVINO IRは`model.xml`=`101a6f46a18d752307b96fa90b3f833f2cbc5c8056265a1670a8bbd859d0db66`、
`model.bin`=`8e902705be79bd9001dd802aebead7b82f9513d3bb59ae649b5dde3acbdf3427`、
tokenizerは`b954cc166b0c9e0271b953fa226fa27ca706a25b7029e84579fe2c60a2b451fe`である。
converter revision／変換元checkpointはartifactへ記録されておらず、独立参照logitsもないため、
OpenVINO変換一致検査は`not_comparable`として記録した。よって、集約値が改善しても
SCUT-067本体routerへ統合する根拠とはせず、SCUT-067の状態は`実環境検証待ち`に維持する。

### この一覧を使うときの注意

- 主因は `rejection_reasons` の値で判定する。`boundary_conflict`、window端集中、
  speed、次行anchor変位は、同じ行を調べるための補助診断であり、上表の主因とは区別する。
- `star_ratio` の採用閾値は `> 0.55`、速度の許容範囲は `0.40..20.0`。
  上表の `05` はwindow端集中が見えるが、`0.625`は単独の閾値超過ではない。
- `source` だけでなく `alignment_diagnostics.rejection_reasons` を保存・確認する。
  `line-proportional` は行全体を正時間長のpartitionとして生成するため、要素数、単調性、
  行端一致だけを検査するテストはfallbackを成功と誤認しやすい。
- `line-proportional` 要素は実装上 `confidence=1.0` になる。これはMMSの信頼度ではなく、
  音素根拠を使わない比例配置の固定値なので、信頼度だけで合格判定しない。
- 以前のsnapshot（`kiritan_prediction_01.json`、`kiritan_prediction_8x3.json`）にも別の
  fallback行が残っているが、今回の現行リストへ混ぜない。比較試験へ再利用する場合は、
  同じMMSモデル・同じ入力・同じCLI条件で再生成してから採用する。

## 既存unit/API fixtureとの区別

次のテストは、実音声MMSで上表の曲・行を再現するテストではない。fallbackの構造やAPI
roundtripを確認するため、入力または戻り値を意図的にmockしている。

- `tests/test_lyrics_elements.py::test_bad_ctc_falls_back_to_line_proportional_without_zero_duration`
  - token confidenceを `0.05` に固定し、品質不採用から比例配置へ落ちる基本経路を検証する。
- `tests/test_lyrics_elements.py::test_quality_gate_exposes_star_edge_and_first_token_diagnostics`
  - STAR率と孤立first tokenの診断を検証する。表示素生成までの実音声試験ではない。
- `tests/test_api.py::ApiJobTests::test_lyrics_analysis_returns_rhythm_grid_and_confidence_outliers`
  - `align_standard_display_elements`の戻り値をmockして、`line-proportional`結果のAPI搬送を検証する。
- `tests/test_api.py::ApiJobTests::test_standard_lyrics_analysis_persists_and_reuses_vocals_artifact`
  - `line-proportional`表示素をmockし、音声artifactの再利用と保存を検証する。

したがって、unit/APIテストが通過したことだけでは上表の実音声対象が改善したとは判断しない。
実音声の回帰では、少なくとも曲ID・行index・歌詞・`source`・`rejection_reasons`を併記する。

## 実装上の根拠

- `songcut/lyrics_elements.py:580-705` が coverage、confidence、STAR率、window端、speed、
  next-anchor、孤立first tokenなどの品質診断と採否を定義する。
- `songcut/lyrics_elements.py:911-1002` が品質不採用時に
  `_proportional_bounds()`を使い、`source="line-proportional"`へfallbackする。
- `songcut/mms_alignment.py:895-917` が短いwindowまたはCTC path不成立時に
  行局所MMS結果を空にして、同じfallback経路へ渡す。

## 更新手順

1. 同一条件でMMS prediction JSONを再生成する。
2. 各行の `display_elements[*].source` と `alignment_diagnostics` を集計する。
3. 現行snapshotとの差分を、曲ID・0始まり行index・歌詞単位で比較する。
4. 新しい対象を追加する場合は、raw audioやraw logitsを文書へコピーせず、診断値と出力JSONの
   パスだけを記録する。

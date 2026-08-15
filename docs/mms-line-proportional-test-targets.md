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

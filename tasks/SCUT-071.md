# SCUT-071: omniASR-CTCプローブの表示境界評価修正とEveryric2準拠アブレーション

## 目的

SCUT-067のtest-only probeが、CTCトークンの発火終了時刻を表示素の終了境界として評価している問題と、固定値`0.02秒/frame`で絶対時刻へ換算している問題を修正する。

omniASR-CTCを「MMSが失敗した局所だけを救済する第2エンジン」として採用できるかについて、Songcutの表示素境界の意味論とEveryric2の推定条件に整合した再現可能な比較結果を作る。本タスクは評価方法とtest-only probeの修正までを対象とし、Standard Align本体へのrouter、GUI、schema、portable packageへの統合は行わない。

## 背景と確認済みの問題

SCUT-067のprobeは、表示素の推定終了時刻を次の値から作っている。

> `"predicted_end": usable[-1]["end"]`

さらに、そのCTCトークン終了時刻をGT表示素の終了時刻と直接比較している。

> `abs(float(element["predicted_end"]) - float(element["ground_truth_end"]))`

しかし、SongcutではCTC状態を疎なonset証拠として扱い、通常の表示素は次のonsetまで継続させる。既存実装のコメントも次の前提を明記している。

> `a display element normally continues until the next onset.`

Everyric2もCTCセグメントを生成した後、セグメント終端を次セグメントの開始まで延長する。

> `세그 끝을 다음 세그 시작까지 늘린다`

このため、生のCTCトークン終端を表示素終端として採点すると、母音の持続区間やCTC blank区間を誤差として数えてしまう。

また、SCUT-067では`FRAME_SECONDS = 0.02`を固定している一方、実モデルの観測値は1秒・16000 samplesの入力に対して49 framesである。畳み込みの公称strideと、有限長入力に対する出力frame数から求める絶対時刻換算を混同しないこと。Everyric2と同じく、実入力時間を実出力frame数で割って時刻へ戻す必要がある。

## 依存関係

- SCUT-041: Standard Alignの表示素タイミング推定と不変条件
- SCUT-043: Kiritan表示素境界benchmark
- SCUT-067: omniASR-CTC局所救済エンジンのtest-only probe
- SCUT-067で追加された`tools/probe_omniasr_ctc_targets.py`
- SCUT-067で追加された`tests/test_omniasr_alignment.py`
- `docs/mms-line-proportional-test-targets.md`に固定された7対象行

## 変更範囲

### 1. frame-to-time換算の修正

- `FRAME_SECONDS = 0.02`を絶対時刻換算に使用しない。
- 推論窓ごとに、次式で`frame_seconds`を求める。

```python
audio_duration_seconds = len(local_audio) / sample_rate
frame_seconds = audio_duration_seconds / logits.shape[0]
```

- token spanの時刻は`window_start + frame_index * frame_seconds`から算出する。
- 入力samples、入力秒数、出力frames、算出した`frame_seconds`を結果JSONへ保存する。
- 16000 samplesから49 framesが出るfixtureで、窓の末端時刻が入力時間と一致することを単体テストする。
- モデルの公称strideである320 samplesはmetadataとして保持してよいが、絶対時刻換算の固定値には使用しない。

### 2. onset-first評価への変更

- `predicted_start`を表示素onset候補として保持する。
- 生のCTC token span終端は`ctc_token_end`など意味が分かる名称で診断情報として保持し、表示素の`predicted_end`には流用しない。
- 内部境界は、原則として次表示素のonsetから生成する。

```python
predicted_internal_boundary[i] = predicted_elements[i + 1].predicted_start
ground_truth_internal_boundary[i] = ground_truth_elements[i].end
```

- ただし、既存Songcut実装が無音区間を空白表示素として分離する場合は、独自処理を追加せず、SCUT-043のbenchmarkと同じ表示素partition／境界抽出処理を再利用する。
- 行末はCTC token終端で採点しない。内部境界benchmarkから除外し、必要な場合は行境界維持の構造検査として別集計する。
- GTと予測で比較対象の内部境界数が一致しない行は、暗黙に切り詰めずエラーまたは明示的な`not_evaluable`とする。
- onset MAEと、Songcutの最終partitionを通した表示終了境界MAEを別系列で出力する。

### 3. Everyric2準拠条件の追加

SCUT-067の局所推論＋次行anchor条件だけで採用可否を判断しない。次の条件を独立した候補として追加する。

- 音声を30秒chunk、5秒overlapでCTC推論する。
- 同一曲のemissionを行ごとに再推論せず再利用する。
- 行区間の前後0.2秒に相当するemissionを切り出す。
- forced alignmentのtargetには現行行だけを渡す。
- 各表示素のonsetを取得し、既存Songcutと同じpartition処理で表示終了境界を構成する。
- overlap部分の結合方法と、結合後のframe-to-time対応を結果JSONに記録する。

曲単位emission生成が現行probeから大きく独立する場合は、test-onlyのhelperへ分離する。本体providerやrouterへ先行実装しない。

### 4. 次行anchor条件の診断強化

SCUT-067の局所推論＋次行anchor方式は比較対象として残す。ただし、次を修正する。

- `next_line.text[:3]`による3文字抽出ではなく、tokenize後の先頭3 target tokensをanchorにする。
- 現行行tokensとanchor tokensの所有範囲を明示的に保持する。
- anchor先頭tokenの推定開始時刻と`next_line.start`の差を`anchor_start_error_seconds`として出力する。
- anchor tokenを表示素の境界集計へ混入させない。
- anchorが次行付近へ置かれたことを確認せず、現行行の結果を高品質候補として扱わない。
- anchor許容閾値は7対象行の結果を見て事後調整しない。閾値を採用する場合は、別の校正セットで決め、根拠と値をmanifestへ記録する。

### 5. 日本語target生成の分離

- Kiritanの7対象行がひらがな中心であることと、一般のSongcut入力が漢字・長音・英数字を含み得ることを分けて扱う。
- probe内で`line.text`を直接SentencePieceへ渡す処理を、表示文字列から発音targetとtoken ownershipを生成する明示的な関数へ分離する。
- 少なくとも、漢字を含む入力、長音`ー`、小書き文字、英字混在について単体テストを追加する。
- 読み変換器を本タスク内で確定できない場合は、未対応入力を黙って直接tokenizeせず`unsupported_target`として不採用にする。
- Kiritan再評価では、表示文字列、発音target、token IDs、各tokenの表示素ownerをJSONへ保存する。

### 6. 品質診断値の追加

各行・各候補について、少なくとも次を結果JSONへ保存する。

- greedy decode文字列またはtoken IDs
- greedy decodeとtargetの編集距離および正規化編集距離
- tokenごとの開始・終了frame、開始・終了秒、平均確率
- 表示素ごとの先頭token確率
- forced pathのtarget token部分だけで集計した平均対数確率
- 窓全体で集計した平均対数確率
- anchor使用時の`anchor_start_error_seconds`
- 入力samples、入力時間、出力frames、frame-to-time比
- missing／unsupported／not-evaluableの理由
- MMS、line-proportional、omniASR各候補の境界誤差

`missing_token_count == 0`だけを品質合格の根拠にしない。forced alignmentは低確率でもtarget全体を経路へ配置し得るため、greedy edit distance、token確率、anchor位置を別に確認する。

### 7. 比較条件と出力

固定7対象行について、少なくとも次の4系列を同じGT・同じ内部境界定義で比較する。

1. 現行Standard Alignの最終結果
2. 現行`line-proportional`候補
3. Everyric2準拠omniASR候補
4. SCUT-067方式の局所推論＋次行anchor候補

各系列について、行別と全対象集約の次を出力する。

- 評価対象内部境界数
- MAE
- median absolute error
- P90 absolute error
- 最大絶対誤差
- 100ms、200ms、500ms以内の割合
- ordering、containment、partition違反数
- 評価不能行と理由

旧SCUT-067結果は上書きせず、旧評価が`ctc_token_end`を採点した結果であることを明記する。修正後結果にはschema versionと実行条件を保存し、旧結果と混同できないファイル名を使用する。

### 8. OpenVINO変換一致検査

- 同一音声窓・同一前処理について、変換元または公式参照実装とOpenVINO IRの出力を比較する。
- 比較可能な場合は、logits shape、greedy token列、主要token peak frame、数値差を記録する。
- converter revisionまたは変換元checkpointを特定できず、厳密比較が不可能な場合は、その事実を証跡へ残す。推測した参照モデルとの一致を証明扱いにしない。
- 参照実装をportable packageへ同梱しない。

### 9. 文書とタスク状態の更新

- `docs/mms-line-proportional-test-targets.md`へ修正後の行別比較表、集約値、実行条件、判定を追記する。
- SCUT-067の旧結果について、表示境界の定義とframe換算に問題があったことを追記し、採用根拠として使用しないことを明示する。
- SCUT-067の状態は、修正後の品質ゲートと変換provenanceが満たされるまで`実環境検証待ち`から進めない。
- 本タスクの実施証跡へ、実行コマンド、対象件数、境界件数、テスト件数、生成JSON、model hash、HEAD、worktree状態を記録する。

## 禁止事項

- CTC token spanの終了時刻を表示素の終了境界として採点しない。
- `0.02秒/frame`または320 samples/frameを、実出力frame数を無視した絶対時刻換算に使用しない。
- 行末を内部境界の品質値へ混入させない。
- 欠落境界を配列の`zip`や短い側への切り詰めで隠さない。
- 4系列で異なるGT、境界抽出、対象行、集計方法を使用しない。
- 7対象行の結果を見ながら閾値を調整し、同じ7行を独立評価として扱わない。
- 一部の改善行だけを選び、事前定義された選択規則なしに全体改善と報告しない。
- 評価結果が改善したという理由だけで、SCUT-067のrouter、GUI、schema、provenance、portable package配線を実装しない。
- MMS合格行、行の開始・終了境界、手動表示素を変更しない。
- model artifact、tokenizer、GT、既存snapshotを無断で上書きしない。
- converter revisionが不明な状態を、公式tokenizerとtoken IDが一致したことだけで解消扱いにしない。
- 本タスクと無関係なdirty差分を変更、stage、削除しない。

## 完了条件

- 実入力時間÷実出力framesによるframe-to-time換算が実装され、16000 samples→49 framesを含む単体テストが成功する。
- 内部境界が次表示素onsetまたは既存Songcutのpartition処理から生成され、生のCTC token終端が表示終了境界として採点されないことを単体テストで確認できる。
- 最終表示素のCTC token終端を内部境界評価から除外するテストが成功する。
- 無音を含むfixtureで、既存Songcutと同じ空白表示素／partition結果になるテストが成功する。
- 同一tokenが連続するCTC target、anchorあり、anchorなし、target不成立、境界数不一致のテストが成功する。
- 漢字、長音、小書き文字、英字混在について、発音targetと表示素ownerのテストが成功する。対応できないケースは明示的に不採用となる。
- 固定7対象行について4系列を同条件で再評価し、行別・集約指標と構造違反数をJSONおよびMarkdownへ保存する。
- Everyric2準拠条件とSCUT-067 anchor条件が別系列として記録され、候補を混ぜたoracle値が採用性能として報告されていない。
- OpenVINO変換一致検査を実行するか、変換元を特定できず実行不能であることを証拠付きで記録する。
- 既存MMS／Kiritan回帰、追加focused tests、全pytest、`git diff --check`が成功する。
- SCUT-067の採用可否と、SCUT-071の評価実装修正の完了可否が別々に状態判断されている。

本タスクは、修正後のomniASR候補がbaselineを上回らなくても、評価方法、テスト、再現可能な結果、状態判断が上記を満たせば完了できる。その場合、SCUT-067は不採用または追加検証待ちのままとし、本体統合へ進めない。

## SCUT-067を進める品質ゲート

本タスクの完了条件とは別に、SCUT-067の本体統合へ進むには次をすべて満たすこと。

- 事前に固定した単一の候補選択規則で評価する。行ごとの結果を見て最良候補を選ぶoracle selectionは使用しない。
- 固定7対象行の全体集約で、現行Standard Alignに対してmedianとP90の両方が悪化しない。
- 各対象行でordering、containment、partition違反が0件である。
- MMS合格行、手動表示素、行境界に変更がない。
- 改善対象とは別の未追跡失敗セットで外部妥当性を確認する。SCUT-067が要求する曲数・行数を変更しない。
- 使用するOpenVINO artifactの変換provenanceを確定するか、再現可能な手順で再変換してhashを固定する。

固定7対象行のうち一部が悪化する場合は、採用ルーターの判定根拠を別の校正セットで定義し、未追跡セットで検証するまで本体統合しない。

## テスト方法

実際のリポジトリ構成とbundled runtimeに合わせてパスを調整し、実行した完全なコマンドを証跡へ残す。

```text
pytest -q tests/test_omniasr_alignment.py
pytest -q tests/test_mms_alignment.py
python tools/benchmark_kiritan_display_elements.py --generate-prediction --device cpu
python tools/probe_omniasr_ctc_targets.py --device CPU --output <new-schema-json>
pytest -q
git diff --check
```

追加テストでは、少なくとも次を検査する。

- 16000 samples、49 framesでの時刻換算
- 任意長入力で最終frame境界が入力窓末端と一致すること
- token endと次onsetが離れたfixtureで、次onsetが内部表示境界になること
- 行末token endを内部境界へ含めないこと
- 無音区間を含むpartition
- 連続同一tokenを含むCTC Viterbi
- anchor tokenの所有範囲と表示境界からの除外
- anchor位置誤差の算出
- 境界数不一致の明示的失敗
- greedy edit distanceとtoken-only path score
- 発音targetとdisplay ownerの対応
- 旧schemaと新schemaを誤って同一集計しないこと

## 停止条件

- 対象model artifact、公式tokenizer、Kiritan音声、GT、または現行baseline snapshotが取得できない場合。
- 7対象行の曲番号・行番号・歌詞が`docs/mms-line-proportional-test-targets.md`と一致しない場合。
- SCUT-043と同じ内部境界定義を特定できず、公平な比較条件を確定できない場合。
- 既存Songcutのpartition処理を再利用できず、互換性のない独自境界生成が必要になった場合。その設計変更を本タスクへ暗黙に追加しない。
- OpenVINO IRの入出力shape、tokenizer vocab、blank IDがSCUT-067のmanifestと一致しない場合。
- modelやGTのhashが既存証跡と一致せず、差異の由来を説明できない場合。
- 実音声を含む比較を実行せず、合成fixtureだけで精度判断する必要が生じた場合。
- 既存dirty差分と本タスク差分を安全に分離できない場合。

停止時は、本体統合や閾値調整へ進まず、確認できた事実、未確定事項、必要な入力を本briefの証跡へ記録する。

## 開始記録

- 2026-08-16: `main` / HEAD `2dcea33f5b63bb29970ec9068ca99f5ced8cc606`で開始。既存dirty差分（SCUT-064〜070、GUI、code-map、SCUT-067 probe/test等）は保持し、本タスクの変更範囲から除外する。
- 2026-08-16: SCUT-067の公式artifact manifest revision `8e35f0cc28fa6099e0c14d56db85ce0423baa691`、OpenVINO IR、tokenizer、Kiritan dataset／GT、旧probe JSONの存在を確認した。SCUT-067の旧結果は`ctc_token_end`を表示終了境界として採点しているため、新schemaへ分離して再評価する。

## 実施証跡

- 実行開始時は`main` / HEAD `2dcea33f5b63bb29970ec9068ca99f5ced8cc606`。既存のSCUT-064〜070、GUI、code-map、SCUT-067関連のdirty差分は保持し、本タスクの変更範囲から除外した。
- 公式artifactは`third_party/omniASR-fp16/omniASR-CTC-300M-openvino-fp16`を使用した。manifest revisionは`8e35f0cc28fa6099e0c14d56db85ce0423baa691`。`model.xml`=`101a6f46a18d752307b96fa90b3f833f2cbc5c8056265a1670a8bbd859d0db66`、`model.bin`=`8e902705be79bd9001dd802aebead7b82f9513d3bb59ae649b5dde3acbdf3427`、`omniASR_tokenizer.model`=`b954cc166b0c9e0271b953fa226fa27ca706a25b7029e84579fe2c60a2b451fe`、`tokens.txt`=`a7a044c52cb29cbe8b0dc1953e92cefd4ca16b0ed968177b6beab21f9a7d0b31`を確認した。tokenizer pieceと`tokens.txt`の9812 IDが一致し、IRの入力／出力は`[1,16000]`→`[1,49,9812]`である。
- 変更対象は`tools/probe_omniasr_ctc_targets.py`、`tests/test_omniasr_alignment.py`、`docs/mms-line-proportional-test-targets.md`、本brief、`tasks/task-list.md`。固定`0.02秒/frame`を廃止して推論窓のsample数とlogits frame数から換算し、CTC token endを診断値へ分離した。表示素のonset、次表示素onsetによる内部境界、最終partition、anchor誤差を別々に記録し、partitionは`songcut.lyrics_elements.align_display_elements`を再利用した。
- 実音声7対象の実行コマンドは次のとおり。生成物は`.codex-temp/omniasr-target-probe-scut071-final-20260816.json`で、旧SCUT-067結果`.codex-temp/omniasr-target-probe-final-20260816.json`は上書きしていない。

  ```powershell
  $py = 'C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
  $env:PYTHONPATH = 'src;.;.codex-temp\sentencepiece-runtime'
  & $py tools/probe_omniasr_ctc_targets.py `
    --model-dir third_party/omniASR-fp16/omniASR-CTC-300M-openvino-fp16 `
    --dataset-root third_party/kiritan_singing `
    --baseline out/benchmarks/kiritan_prediction_8x3_final_recheck.json `
    --output .codex-temp/omniasr-target-probe-scut071-final-20260816.json `
    --device CPU
  ```

- probe結果のschemaは`scut-071.onset-first.v1`。4系列は`standard_align_final`、`line_proportional`、`everyric2_omniasr`、`scut067_local_anchor`で、全系列のordering／containment／partition違反は0件だった。内部境界は62件で、Standard Align finalとline-proportionalは`46/62`、Everyric2準拠omniASRは`62/62`、SCUT-067局所＋anchorは`46/62`を評価した。集約median/P90は順に`0.2347/0.8514`秒、`0.2347/0.8514`秒、`0.1213/0.6804`秒、`0.2021/0.6870`秒。N/Eは境界数不一致を明示したもので、短い側へzipしていない。
- onset-only集約はEveryric2が52件、MAE=`0.0334`、median=`0.0279`、P90=`0.0630`秒、SCUT-067局所＋anchorが52件、MAE=`0.0311`、median=`0.0276`、P90=`0.0597`秒。Everyric2 chunkは対象順に`12, 10, 11, 13, 13, 9, 13`で、30秒chunk／5秒overlap、曲単位emission stitching、行前後0.2秒切り出しを記録した。
- `conversion_match`は`not_comparable`。artifactにconverter revision／変換元checkpointがなく、独立参照logitsも取得できないため、変換一致の証明は作成していない。
- focused testは`12 passed`、既存MMS／Kiritan／lyrics回帰は`49 passed, 1 skipped`。Numbaキャッシュ先を`.codex-temp\\numba-cache-scut071`へ明示した全pytestは、`354 collected`、`351 passed, 3 skipped, 1 subtests passed in 57.43s`で終了した。キャッシュ先未指定の初回全pytestはSCUT-069既知の`librosa.stft`初回Numba cache作成で1時間超無出力となったため中断し、書き込み可能なキャッシュ指定で再実行した。`python -m py_compile tools/probe_omniasr_ctc_targets.py`と`git diff --check`も成功した。
- 本タスクはtest-onlyの評価修正であり、Standard Align router、GUI、schema、portable buildへの統合は行っていない。通常ビルドは本タスクでは再実行していない。

## 状態判断

ローカル検証済み。SCUT-071の評価定義、probe実装、4系列比較、実音声7対象、focused／回帰／全pytest、文書更新は完了した。Everyric2準拠系列は評価可能境界の集約値で改善したが、baseline系列とは評価分母が異なる。また変換一致検査は`not_comparable`であるため、SCUT-067のomniASR採用判断や本体統合へは進めず、SCUT-067は`実環境検証待ち`のまま維持する。

## task-list追記

`tasks/task-list.md`の次の未使用IDを`SCUT-072`へ更新し、一覧へ次の行を追加する。依存関係欄は、実際のtask-listで使用されている表記へ合わせる。

```markdown
| SCUT-071 | AI・解析 | omniASR-CTCプローブの表示境界評価修正とEveryric2準拠アブレーション | ローカル検証済み | 高 | SCUT-041, SCUT-043, SCUT-067 | token終端評価と固定frame換算を修正し、onset-first境界とEveryric2準拠条件で局所救済候補を再評価する | [詳細・証拠](../tasks/SCUT-071.md) |
```

## 根拠資料

- SCUT-067 test-only probe差分: `SCUT-067.patch`
- [Songcut `lyrics_elements.py`](https://github.com/mokusatsu/songcut/blob/121470828e5e2d940c5b6b983c69a634a9fe953d/songcut/lyrics_elements.py)
- [Everyric2 `refine_window.py`](https://github.com/onpe5679/Everyric2/blob/b968a58655696e806d7abcb732e78ac9b4207963/everyric2/alignment/refine_window.py)
- [Everyric2 `omniasr_engine.py`](https://github.com/onpe5679/Everyric2/blob/b968a58655696e806d7abcb732e78ac9b4207963/everyric2/alignment/omniasr_engine.py)
- [Everyric2 `align_target.py`](https://github.com/onpe5679/Everyric2/blob/b968a58655696e806d7abcb732e78ac9b4207963/everyric2/text/align_target.py)

## 関連開発提案: 境界候補の由来追跡

将来omniASRを本体へ統合する場合、各表示素境界に`source`、`candidate_time`、`selected_time`、`confidence`、`rejection_reason`を持たせる。MMS、omniASR、比例配分、無音ゲートのどれが境界を決めたかを後から追跡できれば、集約指標が改善していても特定条件だけ悪化する問題を切り分けられる。ただし、このschema変更はSCUT-071の変更範囲には含めず、SCUT-067が品質ゲートを通過した後の別タスクとする。

# SCUT-068 表示素タイミングbenchmarkの複数歌唱DB対応

## 目的

`kiritan_singing` だけに固定されている表示素タイミングbenchmarkを、作業ツリーに追加済みの `OFUTON_P_UTAGOE_DB`、`no7singing`、`itako_singing` でも同じGT生成・MMS予測・精度評価の入口から使えるようにする。

## 変更範囲

- `tools/benchmark_kiritan_display_elements.py` の歌唱DB入力アダプター、CLI選択、帰属情報、音声パス
- MusicXML歌詞、mono labelの共通処理とDB固有の時刻単位・休止ラベル・ディレクトリ構造
- `tests/test_kiritan_display_benchmark.py` の共通処理・複数形式回帰テスト
- `docs/mms-line-proportional-test-targets.md` の実音声MMS fallback対象一覧とfixtureの区別
- このbriefと `tasks/task-list.md` の状態・証拠

## 禁止事項

- `third_party/` の歌唱音声、MusicXML、mono label、PDF、raw/派生timing本体を変更・コピー・Git追跡しない。検証に必要な曲ID・行・診断値の短い一覧は文書へ記録してよい
- 既存の `SCUT-064`〜`067` の変更を戻さない
- MMS本体、Standard Align API、GUIの仕様を変更しない
- ラベル不一致を根拠なく補正して正解値に見せない。不一致曲は理由を保持してskipする
- commit、push、PRを作成しない

## 完了条件

- `kiritan_singing` の既存CLI／unit testを維持したまま、4 DBを `--dataset` とrootから選択できる
- 各DBのMusicXML／mono labelの配置、ラベル時刻単位、`sil`／`pau`／`br`、カタカナ・稀な仮名を共通処理へ正しく変換できる
- 4 DBそれぞれで、ローカルGT summaryが既定の8曲・24行・200内部境界以上を満たす。入力不足・不一致はsummaryのskip理由で追跡できる
- 予測生成の音声パスが `wav`、No.7の`wav_PT`、OFUTONの曲フォルダ形式へ対応し、合成runner unit testが成功する
- 現行MMSで`line-proportional`へ落ちた実音声の曲ID・0始まり行index・歌詞・主な拒否理由を、mock fixtureと区別して文書化する
- 対象Python test、`git diff --check`、実DB4種のsummaryコマンド結果を証拠として記録する

## テスト方法

- `& $SONGCUT_PYTHON -m pytest tests/test_kiritan_display_benchmark.py -q`
- Codex同梱Pythonで4 DB各々に `--summary-only --min-songs 8 --min-lines 24 --min-boundaries 200` を実行
- `git diff --check`

## 停止条件

- 既存DBの利用条件に反する追跡・配布が必要になる場合
- ラベル不一致を除外しても既定coverageを満たせない場合
- 既存benchmarkの正解生成規則を変更しないと新DBを扱えず、SCUT-041の範囲を越える場合

## 実施証跡

- 2026-08-15: 開始時 branch `main`、HEAD `1214708`。既存の `tasks/task-list.md` 差分と未追跡 `SCUT-064`〜`067` を確認し、保持して作業開始
- 2026-08-15: `kiritan_singing` は `musicxml/`・`mono_label/`・`wav/`、OFUTONは曲フォルダ内の同名ファイル、No.7は `wav_PT/`、イタコは `wav/` の構造を確認。No.7・OFUTON・イタコのラベルは100ns単位、きりたんは秒単位
- 2026-08-15: `out/benchmarks/kiritan_prediction_8x3_final_recheck.json` を確認し、24行中7行の `line-proportional` 対象を `docs/mms-line-proportional-test-targets.md` に記録。主因は `star_ratio` 6行、`isolated_first_token` 1行。unit/APIのmock fixtureとは分離
- 2026-08-15: `tests/test_kiritan_display_benchmark.py` は14 passed、fallback/API関連の `tests/test_lyrics_elements.py tests/test_api.py` は49 passed。4 DB summaryはcoverage gateを通過し、`git diff --check` も成功
- 状態判断: 完了。リポジトリ全体のpytestは `out/`配下の既存生成物収集を避けるため `tests/`を指定して開始したが、長時間無出力のため中断。今回の変更範囲に対応する対象テスト・実DBsummary・差分検査は完了

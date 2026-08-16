# SCUT-064 ユーザー向けドキュメント更新

## 目的

現在のCut/Subの利用者導線を、初めて使う人が目的から選べる形に整理する。特にSubでは、字幕付き動画を作る`書き出し`と、選択したTimelineを一つの字幕ファイルへ統合する`Export Sub`の違いを明確にし、現行の情報・復旧導線を利用者向けに案内する。

## 変更範囲

- `README.md`の導入、配布物の選び方、利用者向け資料への入口
- `docs/INDEX.md`の「初めて使う」「Cut」「Sub」「ショートカット」による目的別導線
- `docs/USAGE.ja.md`と`docs/USAGE.md`のCut/Sub手順、情報Dialog、保存・復旧、Sub書き出し説明
- `書き出し`と`Export Sub`について、操作、用途、選べる出力形式、生成物の違いを利用者視点で説明する
- 現行portable packageで確認した画面だけを`docs/image/`へ追加または更新する
- `docs/KEYBOARD_SHORTCUTS.md`は、現行操作との差異が確認された場合だけ更新する

## 禁止事項

- 表示素編集、表示素プレビュー、ズーム編集、境界ロックを本文・画像・目次へ追加しない
- アプリケーションコード、GUI文言、API、保存形式、字幕出力の挙動を変更しない
- CLI、ビルド、設計、E2E、アルゴリズムなどの技術文書を利用者向け資料へ混在させない
- 開発経緯、内部実装、例外処理をユーザーガイドへ記載しない
- 通常build、Release ZIP、`dist/`、code-mapを更新しない
- commit、stage、push、PR作成を行わない

## 完了条件

- READMEと文書一覧から、利用者がCut、Sub、ショートカットの資料へ迷わず到達できる
- 日本語・英語の利用ガイドで、Cut/Subの基本手順と保存・復旧の案内が同じ意味で対応する
- Subの`書き出し`が字幕付き動画とTimeline別出力の経路であることを説明する
- Subの`Export Sub`がSRT、LRC、ASSから形式と対象Timelineを選び、一つの字幕ファイルへ統合する経路であることを説明する
- 情報Dialogからメディア準備状態と実行中・失敗した処理を確認できることを、必要最小限の利用者向け説明で案内する
- 表示素編集、表示素プレビュー、ズーム編集、境界ロックへの説明・画像・リンクが今回の差分に含まれない
- 追加・更新した画像が現行portable packageの画面と一致し、全相対Markdownリンクと画像参照が解決する
- `git diff --check`が成功する

## テスト方法

- 現行`dist/songcut-win-x64`で、Cutの基本導線、Subの`書き出し`、Subの`Export Sub`のボタン名・Dialog・出力形式・Timeline選択を確認する
- README、INDEX、日英USAGE、ショートカット資料の相対リンクと画像参照を検査する
- 日本語・英語で追加した見出し、操作名、出力形式、対象外項目を相互レビューする
- `git diff --check`を実行する

## 停止条件

- 現行portable packageとソースの操作名、出力形式、出力結果が一致せず、対象リリースの判断が必要になった場合
- 資料に載せるためにアプリの挙動変更、保存形式変更、互換性判断、または技術文書の大規模改編が必要になった場合
- 対象文書または画像に未確認の既存変更が入り、差分の所有者と調整が必要になった場合

## 実施証跡

- 2026-08-14: ユーザー指示により登録。登録時は`main`、HEAD `1214708`、作業ツリーはclean。ユーザー向け文書・画像・配布物はまだ変更していない。
- 2026-08-14: 表示素編集は、編集後の利用者向け活用経路が不足するため今回の変更対象から明示的に除外した。
- 2026-08-15: 初期登録・SCUT-068/069変更をコミットした`main`、HEAD `2dcea33`を開始基点としてSCUT-064を開始。開始時点で対象文書への未確認変更はなく、画像とportable packageは既存物を保持した。
- 2026-08-15: ソース実装とi18nを照合し、Subの`書き出し`は字幕付き動画＋Timeline別ファイル、`Export Sub`はSRT/LRC/ASSとTimeline選択による一つの字幕ファイル、`情報`はメディア準備・実行中／失敗タスクのDialogであることを確認した。
- 2026-08-15: `dist/songcut-win-x64`のportable版を起動し、Cut初期画面の`Information`と`Project information` Dialogで、Mode・Media preparation・Background tasksが表示されることを確認した。既存`out/e2e-sub-mode/e2e-sub-mode.log`のportable Sub E2Eは`SUB_E2E_OK`、字幕付き動画、2本のSRT／style、ASS出力を記録している。
- 2026-08-15: `gui/src/i18n.ts`と`SubtitleFileExportDialog.tsx`で、`Export Sub`の実ボタン名、SRT/LRC/ASS、Timeline選択、単一字幕ファイルDialogを照合した。portable package内に対応するdocs画像コピーはなく、画像は追加・更新せず既存参照を保持した。
- 2026-08-15: README、docs/INDEX、日英USAGEの目的別導線・書き出し分離・情報／保存／復旧説明を更新。5文書の相対Markdownリンク／画像参照検査は成功し、`git diff --check`も成功した。

## 状態判断

完了。ユーザー向け文書、目的別導線、Subの二つの書き出し経路、情報・保存・復旧の説明を日英で対応させ、表示素編集を変更せず、portable／既存E2E／ソース照合とリンク・差分検査の証拠を記録した。

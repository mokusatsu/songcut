# SCUT-049 選択Timelineを統合するSub字幕ファイル書き出し

## 目的

Subツールバーの既存`Export`の右に`Export Sub`を置き、利用者が選択したTimelineを一つに統合したSRT、表示素タイミング付きLRC、ASSを字幕ファイルとして書き出せるようにする。

## 変更範囲

- `Export Sub`ボタンと、形式／Timelineチェックボックスを持つSub専用Dialogを追加する
- 選択したTimelineだけを一つのSRT、LRC、ASSへ統合して既存の出力先フォルダへ保存する
- ASSは既存のstyle／effect／segment overrideを保った一つのASS documentとして出力する
- LRCは歌詞行開始の`[mm:ss.cc]`と各表示素開始／行終端の`<mm:ss.cc>`を出力する
- 表示素が未解析の歌詞行は、行本文を一つのLRC表示素として出力する
- 既存の字幕焼き込み`Export`、Project schema、解析結果、表示素編集は変更しない

## 禁止事項

- 既存の動画字幕焼き込みjobを置換または遅延させない
- Timelineごとに別ファイルを出力しない
- 表示素タイミングを再解析、補正、保存しない
- 新しい保存形式のためにProject schema migrationや互換層を追加しない

## 完了条件

- Subの`Export`直後に`Export Sub`が表示される
- DialogでSRT、`LRC (word/character timing)`、ASSのいずれかを選べる
- 有効なTimelineはcheckboxで選べ、選択なしでは書き出せない
- どの形式でも選択Timelineを一つのファイルに統合する
- SRTは時間順の字幕番号を持つ
- LRCは表示素ごとの角括弧タイムタグと行終端タイムタグを持つ
- ASSは一つのscript内に選択Timelineのstyleとeventを統合し、effectを維持する
- 保存先フォルダの選択取消では出力を開始しない

## テスト方法

- Python unitで統合SRTの順序、LRCの表示素・blank・fallback、ASS統合、保存ファイルを確認する
- API testでformat、選択lane、display element payloadを検証する
- GUI unitでDialogの形式／Timeline選択、無効条件、Export Subの配置を確認する
- GUI typecheckと対象Vitest、対象pytest、`git diff --check`を実行する

## 停止条件

- ASS effect出力を既存rendererで統合できず、出力仕様の判断が必要になる場合
- LRCの未解析行を出力する可否について利用者判断が必要になる場合

## 実施証跡

- 2026-08-13: SCUT-048を実環境検証待ちのまま保持し、通常ビルド／E2Eの反復を行わず開始
- 2026-08-13: 既存の字幕焼き込みjob、`render_ass_document`、出力先フォルダ選択IPC、表示素保持型を調査。既存ASS rendererとoutput directory選択を再利用する方針を確定
- 2026-08-13: 専用同期API`POST /subtitle-files/export`、統合SRT／LRC／ASS renderer、`Export Sub` Dialogを追加。既存の動画字幕焼き込みjobとProject schemaは変更していない
- 2026-08-13: `python -m pytest -q tests/test_subtitle_export.py -k "merged or lrc or export_subtitle_file"`（4 passed）、`python -m pytest -q tests/test_api.py -k subtitle_file_export`（1 passed）、GUI対象Vitest（4 files / 20 tests passed）、`pnpm exec tsc -p tsconfig.json --noEmit --pretty false`、対象`git diff --check`が成功
- 2026-08-13: 通常ポータブルビルド`packaging/build_dist.ps1`が成功。`dist/songcut-win-x64`をversion 1.1.76として更新し、Release ZIPは更新していない
- 2026-08-14: ASS v3最新版を含む環境で`tests/test_ass_lyric_effects_v3_integration.py`と`tests/test_subtitle_export.py`が38 passed、API対象が5 passedとなった。統合SRT／LRC／ASSの形式・順序・表示素・style/effect保持を回帰テストで確認した。
- 2026-08-14: 通常portable配布版のSub E2Eで`SUB_EXPORT_OK`と`SUB_E2E_OK`を確認した。選択Timelineの字幕書き出しと字幕焼き込み出力でASS、SRTおよびstyle sidecarが生成され、出力先・sidecar・codec確認まで成功した。
- 状態判断: 完了

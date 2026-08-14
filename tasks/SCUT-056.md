# SCUT-056: Subタイムライン下端ガターとローカルASS実装取り込み

## 目的

Subタイムラインで最下段の表示素・歌詞ラベルが横スクロールバーに覆われないよう、バー高ぶんの安全領域を確保する。同時に、指定された`C:\dev\ASS_Lyric_Effects40`の現在のPythonパッケージ実装を、不変のローカルwheel snapshotとしてSongcutへ取り込む。

## 変更範囲

- `gui/src/styles.css`の`.sub-timeline-content`に限定した下端ガター
- 表示素タイムラインの回帰テストおよび配布Sub E2Eの可視領域確認
- 指定ASS worktreeの`src/ass_lyric_effects`から生成するwheel snapshot、由来manifest、`pyproject.toml`の依存固定
- SongcutのASS統合テスト、通常portable build、配布runtimeのhash確認

## 禁止事項

- 共通`ScrollArea`、Cutタイムライン、表示素の時刻・選択・drag仕様を変更しない
- `C:\dev\ASS_Lyric_Effects40`への絶対パスをSongcutの依存定義へ残さない
- ASS側のpreview、docs、task-list、`.gitignore`、未関連の生成物をSongcutへコピーしない
- ASSの97 effect IDまたはparameter schemaが変わる場合に、互換性判断なしで取り込まない

## 完了条件

- 横スクロールバー表示時、最後の歌詞レーンの表示素・ラベル・handleがバーの上端より下へ重ならない
- 右端の縦スクロールバー／cornerと既存の横スクロール操作を維持する
- Songcut内のlocal wheel snapshotが指定ASS worktreeの実行パッケージを含み、`_natural36_engine.py`のhashが一致する
- `pyproject.toml`はwheel snapshotの相対参照とSHA256を保持し、再installとportable buildが同じwheelを使用する
- ASS catalogがschema `1.0`・97効果を維持し、SongcutのASS出力・統合契約が成功する

## テスト方法

- CSS／component testでSub専用の下端ガターと既存タイムライン契約を固定する
- 1060x720および1440x960の配布Sub E2Eで、最下段レーンと横バーの矩形非重複を確認する
- ASS worktreeでNatural36対象pytestを実行し、wheel展開後・install後・portable runtimeで対象module hashを比較する
- SongcutのASS統合pytest、GUI typecheck／Vitest、通常`packaging/build_dist.ps1`、`git diff --check`を実行する

## 停止条件

- 相対wheel参照を`pip install -e`と通常portable buildの両方で解決できず、別の依存配布方式が必要になる場合
- ローカルASS実装でeffect ID／parameter schemaの差異が見つかり、後方互換性の判断が必要になる場合
- 既存dirty差分と対象CSS、依存固定、packagingに競合変更が入った場合

## 開始記録

- 2026-08-14: `main`、HEAD `6bf1074`。SCUT-040以降を含む広範な未コミット差分を保持したまま開始。
- 2026-08-14: 提供画像で、最下段の歌詞ラベル／表示素が横スクロールバーの下に重なることを確認した。原因は`.sub-timeline-scroll`のabsolute・z-index 30横バーに対し、`.sub-timeline-content`に下端予約領域がないこと。
- 2026-08-14: 指定ASS worktreeはHEAD `4af57f7b8275e18b737c246fcb5d3fb67a625d54`に加え、`src/ass_lyric_effects/_natural36_engine.py`と対応testを含む未コミット実装差分を持つ。利用者の明示指示により、その実行パッケージ差分を取り込む。

## 実施証拠

- `.sub-timeline-content`へ`padding-bottom: var(--sub-scrollbar-size)`を追加した。共通`ScrollArea`やCutタイムラインは変更していない。
- `gui/src/components/SubTimelineEditor.test.ts`でSub専用の下端ガターを固定し、`packaging/e2e_sub_mode.js`は最終レーンの下端が横スクロールバーの上にあり、contentの下端ガター・CSS padding・実バー高が一致することを実測するよう更新した。
- 指定worktreeの`src/ass_lyric_effects`だけから生成した不変wheel snapshotを`third_party/ass_lyric_effects/ass_lyric_effects-3.0.0-py3-none-any.whl`へ格納した。wheel SHA256は`c9ec21d353543215aaaed7424b775732714c344d05356b5ec9eeef20fc212fed`、取り込んだ`_natural36_engine.py`のSHA256は`4846d93076bddc7fc6ab86342e8da2f0d7958b3bf377a461d365619dd2084a95`であり、由来・catalog schema 1.0・97 effectsは`LOCAL_SOURCE.json`に記録した。
- `pyproject.toml`は相対wheel参照＋SHA256を使用し、`packaging/build_dist.ps1`はlocal site-packagesを`PYTHONPATH`の先頭に置いてからPyInstallerを実行し、終了時に元の環境変数を復元する。これにより既存環境にあるリモートwheelよりlocal snapshotが優先される。
- 通常portable build: `packaging/build_dist.ps1 -PackageName songcut-win-x64-scut056-localass` 成功。出力は`dist/songcut-win-x64-scut056-localass`。runtimeの`_natural36_engine.py`は上記SHA256、`direct_url.json`は同じlocal wheel SHA256と`file:///C:/dev/songcut/third_party/ass_lyric_effects/...`を記録することを確認した。
- 検証: GUI typecheck成功、Vitest `69 files / 442 tests`成功、local wheelを優先した`tests/test_ass_lyric_effects_v3_integration.py`＋`tests/test_subtitle_export.py`は`38 passed`、ASS source Natural36対象pytestは`10 passed / 148 subtests passed`、PowerShell parser・Node E2E syntax・対象差分のwhitespace checkも成功。
- 実配布Sub E2E: `SONGCUT_E2E_PACKAGE_ROOT=dist/songcut-win-x64-scut056-localass`で、要求`1060x720`（client `1047x659`）と要求`1440x960`（client `1427x791`）をそれぞれ実行し、双方`SUB_E2E_OK`。横スクロール有効、実歌詞解析、ASS sidecar、SRT/style、字幕焼き込み動画（音声Opus維持）まで成功した。

## 状態判断

2026-08-14: 完了。全完了条件を、ローカルwheelのhash・配布runtimeのhash・GUI/Pythonテスト・2画面サイズの実配布E2Eで確認した。既に起動中だった`dist/songcut-win-x64`は上書きせず、検証済みの別名portable packageを作成した。

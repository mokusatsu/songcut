# SCUT-062: 配布物third_partyをffmpegに限定

## 目的

`build_dist.ps1`が生成する配布物の`third_party`へ、実行時ツールであるffmpeg以外のソースツリー、補助リポジトリ、計画文書をコピーしない。

## 変更範囲

- `packaging/build_dist.ps1`の配布用`third_party`コピー
- タスク一覧と本brief

## 禁止事項

- 再ビルドを実行しない
- 既存の`dist/`配布物を直接削除・変更しない
- PyInstallerの入力パス、アプリ実行時のPythonモジュール解決、Electron設定を変更しない
- commit、push、Release ZIP作成を行わない

## 完了条件

- 汎用の`third_party`再帰コピーがビルドスクリプトからなくなる
- `third_party\\ffmpeg`が存在する場合だけ、配布先`third_party\\ffmpeg`へコピーされる
- 再ビルド不要というユーザー指示に従い、既存`dist/`を変更しない
- PowerShell構文検査と差分検査が成功する

## テスト方法

- `build_dist.ps1`のPowerShell AST構文検査
- ffmpeg専用コピーと汎用コピー不在の静的検査
- `git diff --check`
- 再ビルドはユーザー指示により実行しない

## 停止条件

- ffmpeg以外の`third_party`項目を配布物直下から実行時に参照していることが確認された場合
- ffmpegの配布先パスが既存ランタイム契約と両立しない場合

## 開始記録

- 2026-08-14: ユーザーが`dist`の`third_party`へffmpeg以外を入れないこと、および再ビルド不要を明示した。既存スクリプトはリポジトリ直下の`third_party`全体を再帰コピーしていた。

## 実施証拠

- 2026-08-14: 汎用の`$ThirdPartySource`再帰コピーを削除し、`third_party\\ffmpeg`だけを、存在する場合に配布先`third_party\\ffmpeg`へコピーするよう変更した。`ass_lyric_effects`と`uta_align`はビルド入力として既存の場所から参照し続け、配布先への生コピーは行わない。
- 2026-08-14: PowerShell AST構文検査が成功した。静的検査で汎用`$ThirdPartySource`の不在、ffmpeg専用ソースパス、ffmpeg専用`Copy-Item`を確認した。
- 2026-08-14: `git diff --check`が終了コード0で成功した。ユーザー指示どおり`packaging/build_dist.ps1`は実行せず、既存`dist/songcut-win-x64/third_party`も削除・変更していない。したがって既存配布物内の旧項目は、次回のビルドまで残る。

## 状態判断

2026-08-14: 完了。将来の`build_dist.ps1`実行では`third_party`へffmpegだけをコピーする。再ビルド不要という明示指示に従い、現行`dist/`成果物の内容を置き換える検証は実施していない。

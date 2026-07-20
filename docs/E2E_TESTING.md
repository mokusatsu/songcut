# Songcut E2Eテスト手順

この文書は、別の開発セッションやCodexチャットでもWindows向けE2Eテストを
同じ条件で再現できるようにするための手順書です。コマンドは特記がない限り
リポジトリルートからPowerShellで実行します。

## 最初に知っておくこと

- E2Eは開発サーバーではなく、`dist\songcut-win-x64` のポータブル版を起動します。
  ソースを変更しただけではE2Eに反映されないため、必ず先に再ビルドしてください。
- E2EはElectronをChrome DevTools Protocol（CDP）付きで起動し、実際の
  レンダラー、プリロード、バックエンド、ffmpeg出力、`.songcut`保存をまとめて
  検証します。
- 通常使用中のSongcutはすべて閉じてから実行してください。スモークテストが
  失敗した場合、後始末として `songcut.exe` と `songcut-electron.exe` を
  イメージ名で終了します。
- `out\e2e-*`、`out\e2e_input.mp4.songcut*`、専用ユーザーデータはテストごとに
  削除または上書きされます。手作業の成果物を `out\e2e-*` に置かないでください。
- 合成動画の生成には `third_party\ffmpeg\bin\ffmpeg.exe` が必要です。
- スクリーンショットも検証するため、通常は対話可能なWindowsデスクトップ
  セッションで実行します。

## 事前検証とポータブル版ビルド

通常の開発環境では、まず単体テストと型検査を実行します。

```powershell
python -m pytest

Push-Location gui
pnpm run typecheck
pnpm test
Pop-Location
```

配布版を起動している場合は閉じてからビルドします。

```powershell
.\packaging\build_dist.ps1
```

ツールがPATHにない場合は、`docs/BUILD.md` またはリポジトリルートの
`CODEX.md` に従い、`SONGCUT_PYTHON`、`SONGCUT_NODE`、`SONGCUT_PNPM`、
`SONGCUT_GIT` を設定するか、`build_dist.ps1` の引数で明示します。

Codex環境では、最初にワークスペース依存関係のロケーターを使って同梱Node.js、
Python、pnpm、Gitのパスを取得し、`CODEX.md` の注入ブロックを同じPowerShell
セッションで実行してください。`pnpm` が `node is not recognized` で失敗する場合は、
Node.jsのディレクトリが現在の `PATH` にないことが原因です。

E2Eスクリプトだけを変更した場合は、実行前に構文も確認します。

```powershell
node --check packaging\e2e_dist_smoke.js
node --check packaging\e2e_scratch_proxy.js
```

## 実行コマンド

### 配布版スモークE2E

```powershell
node packaging\e2e_dist_smoke.js
```

通常モードは、初期描画、設定の永続化、動画ロード、ロード時波形、解析、
プロジェクト自動保存、キーボード操作、タイムライン操作、Export Review、
ファイル名テンプレート、動画・TS出力まで通します。最後の成功マーカーは
`E2E_OK` です。

### Segment機能だけを重点確認するモード

```powershell
$env:SONGCUT_E2E_SEGMENT_MENU_ONLY = "1"
node packaging\e2e_dist_smoke.js
Remove-Item Env:SONGCUT_E2E_SEGMENT_MENU_ONLY
```

共通のロード・Settings・解析・自動保存確認を行った後、次を確認して早期終了します。

- Segmentメニューが、子メニューを持たない見出し付きの平坦構造であること
- New Segmentの挿入位置
- Before/After付きの開始時刻ソート確認
- Check All、Uncheck All、Invert Selection
- 単一削除と未チェック一括削除のレビュー
- 最終的なセグメントとExport候補が `.songcut` に自動保存されること

最後の成功マーカーは `E2E_SEGMENT_MENU_ONLY_PASS` です。

### 出力ファイル名設定だけを重点確認するモード

```powershell
$env:SONGCUT_E2E_EXPORT_NAMING_ONLY = "1"
node packaging\e2e_dist_smoke.js
Remove-Item Env:SONGCUT_E2E_EXPORT_NAMING_ONLY
```

SettingsとExport Reviewで変更したファイル名テンプレートがプロジェクト固有の
`.songcut`設定へ保存され、レンダラーのlocalStorageへ残らないことを確認して
早期終了します。最後の成功マーカーは `E2E_EXPORT_NAMING_ONLY_PASS` です。

短縮モードも共通セットアップ、Whisperモデル準備、動画ロード、解析までは実行します。
通常モードの代替ではないため、機能実装の仕上げでは通常モードも実行してください。
環境変数を残すと次回も短縮モードになるので、実行後は必ず削除します。

### スクラッチ音声プロキシE2E

```powershell
node packaging\e2e_scratch_proxy.js
```

このテストはAACとOpusの合成動画を作り、次を確認します。

- AACではプロキシを作らず元音声でスクラッチすること
- Opusプロキシ準備中は元音声を使うこと
- 準備完了後はプロキシ音声へ切り替わること
- 連続したドラッグで前のスクラッチを中断し、新しい位置へ移動すること
- 設定をOFFにするとOpusでもプロキシを作らないこと

既定ではCDPポート9231と9232を使います。最後の成功マーカーは
`SCRATCH_PROXY_E2E_OK` です。

## 実行環境の上書き

| 環境変数 | 既定値 | 用途 |
| --- | --- | --- |
| `SONGCUT_E2E_PACKAGE_ROOT` | `dist\songcut-win-x64` | 別の展開済みパッケージを検証する |
| `SONGCUT_E2E_DEBUG_PORT` | `9230` | スモークE2EのCDPポート |
| `SONGCUT_E2E_AAC_PORT` | `9231` | AACスクラッチE2EのCDPポート |
| `SONGCUT_E2E_OPUS_PORT` | `9232` | OpusスクラッチE2EのCDPポート |
| `SONGCUT_E2E_SEGMENT_MENU_ONLY` | 未設定 | Segment重点モードを有効にする |
| `SONGCUT_E2E_EXPORT_NAMING_ONLY` | 未設定 | ファイル名設定重点モードを有効にする |

例:

```powershell
$env:SONGCUT_E2E_PACKAGE_ROOT = (Resolve-Path "dist\custom-package").Path
$env:SONGCUT_E2E_DEBUG_PORT = "9330"
node packaging\e2e_dist_smoke.js
Remove-Item Env:SONGCUT_E2E_PACKAGE_ROOT
Remove-Item Env:SONGCUT_E2E_DEBUG_PORT
```

`SONGCUT_E2E_VIDEO`、`SONGCUT_E2E_OUTPUT_DIR`、`SONGCUT_E2E_USER_DATA_DIR` は
テストスクリプトが子プロセスへ渡す内部用変数です。通常の手動実行では設定しません。

## 成果物とログ

スモークE2Eは主に次を生成します。

```text
out\e2e-dist-smoke.log
out\e2e-initial-render.png
out\e2e-loaded-layout.png
out\e2e-export-review.png
out\e2e-final.png
out\e2e_input.mp4
out\e2e_input.mp4.songcut
out\e2e-export\
out\e2e-user-data\
```

コンソール出力と `out\e2e-dist-smoke.log` は同じチェックポイントを記録します。
末尾の `E2E_OK` または短縮モード固有の `*_PASS` だけでなく、失敗直前の
`*_OK` と `[app-err]` も確認してください。スクリーンショットはレイアウトや
ダイアログの崩れを調べるときの証拠になります。

スクラッチプロキシE2Eの入力、専用ユーザーデータ、プロキシ成果物は
`out\e2e-scratch-proxy\` 以下に作られます。

## Whisperモデルの注意

スモークE2EはSettings確認前にSmallモデルの準備APIを実際に呼びます。
ネットワークに依存しない再現テストにするには、ビルド前に
`.models\openvino\whisper-small` を用意し、ポータブル版の
`models\openvino\whisper-small` へ同梱してください。モデルが同梱済みまたは
ローカルキャッシュ済みでなければ、モデル取得が走り、時間やネットワーク状態に
影響される場合があります。

## E2Eを追加・修正するときのプラクティス

1. UI表示だけでなく、必要に応じてファイル、sidecar JSON、出力動画の長さまで
   検証します。自動保存は画面の `Saved` 表示だけで合格にせず、
   `waitForJsonFile` で期待するrevisionや内容を待ちます。
2. 非同期処理には固定時間の `sleep` だけを使わず、`waitFor` で観測可能な
   完了条件を待ちます。短い `sleep` は入力イベント直後の安定化に限定します。
3. セレクターはaria-label、role、安定したクラス、データ属性を優先します。
   表の行番号や画面座標だけに依存するテストは避けます。
4. 操作は可能な限りCDPの実入力イベントを使います。React stateを直接書き換える
   だけのテストでは、ショートカットやドラッグのイベント経路を検証できません。
5. ElectronのネイティブメニューなどCDPから操作しにくい機能だけ、E2E専用IPCを
   使います。プリロードとmain processの両側を
   `SONGCUT_E2E_USER_DATA_DIR` で保護し、任意のIPCを呼べないようコマンドを
   ホワイトリスト化してください。
6. 通常ランタイムにテストAPIを公開しないよう、E2E専用ブリッジは環境変数がある
   場合だけ `window.songcut` へ追加します。型は `gui/src/vite-env.d.ts` にも反映します。
7. 機能別の短縮モードを追加する場合も、通常モードの経路を壊さず、固有の
   `*_PASS` マーカーを出してから早期returnします。
8. E2Eスクリプトを変更したら `node --check`、TypeScriptやプリロードを変更したら
   `pnpm run typecheck`、パッケージ内容を変更したら再ビルド後のE2Eまで実行します。

## よくある失敗と切り分け

### `node is not recognized`

Codex同梱pnpmや別インストールのpnpmからNode.jsが見えていません。`CODEX.md` の
環境注入を現在のPowerShellでやり直すか、Node.jsの絶対パスでE2Eを起動します。

```powershell
& $env:SONGCUT_NODE packaging\e2e_dist_smoke.js
```

### ビルド時にdistを削除できない

前回のSongcutまたはE2EのElectron子プロセスが残っています。対象パスとPIDを
確認してから、テストで起動したプロセスだけを終了し、再ビルドします。

### `CDP page not found`

- パッケージが古い、または起動直後にクラッシュしていないか
- `out\e2e-dist-smoke.log` の `[app-err]`
- 9230、9231、9232を別プロセスが使用していないか
- `SONGCUT_E2E_PACKAGE_ROOT` が `songcut.exe` を含むディレクトリか

を確認します。ポート競合なら上書き用環境変数で別ポートを指定します。

### 合成動画を作れない、解析やExportが始まらない

`third_party\ffmpeg\bin\ffmpeg.exe` と `ffprobe.exe`、およびポータブル版へ
コピーされた `third_party` を確認します。`out\e2e_input.mp4` が古く破損している
疑いがある場合は削除し、テストに再生成させます。

### 重点モードでは成功するが通常モードで失敗する

重点モードは解析後に早期終了するため、後半のショートカット、ズーム、Export
Review、実ファイル出力は通りません。通常モードの最初の失敗マーカーと直前の
スクリーンショットから後半経路を切り分けます。

### テスト終了後もSongcutが残る

まずスクリプトの `finally` が実行されたかログを確認します。PIDと実行ファイルの
パスを確認し、テストが起動した `dist\songcut-win-x64` 配下のプロセスだけを
終了してください。

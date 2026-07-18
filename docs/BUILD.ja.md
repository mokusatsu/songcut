# ビルド

この手順は通常の Windows 開発環境向けです。Codex 固有のランタイム注入方法は
`CODEX.md` に分けています。特に指定がない限り、コマンドはリポジトリルートから
実行します。

## 前提

- Python 3.11 以上
- Node.js
- pnpm
- Git
- PowerShell

開発時の `ffmpeg.exe` / `ffprobe.exe` 同梱は任意です。アプリはリポジトリまたは
パッケージルートを先に探し、見つからなければ `PATH` を探します。

フロントエンドのコマンドを実行するシェルでは、`pnpm` から `node` が見えている
必要があります。`node is not recognized` で失敗する場合は、先に Node.js の
`PATH` 設定を直してから再実行してください。

## Python セットアップ

リポジトリルートから実行します。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

GUI/API 開発やポータブル配布物の作成まで行う場合は、GUI extra も入れます。

```powershell
python -m pip install -e ".[gui,dev]"
```

Python テストは次で実行します。

```powershell
python -m pytest
```

このリポジトリにはプロプライエタリなメディア fixture は含めていません。ローカル
メディアが必要なテストは、対象ファイルがない場合に skip される想定です。

## フロントエンドセットアップ

`gui/` から実行します。

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

## 開発用 GUI

ターミナルを 2 つ使います。

ターミナル 1 は `gui/` から実行します。

```powershell
pnpm run dev
```

ターミナル 2 はリポジトリルートから実行します。

```powershell
$env:SONGCUT_PYTHON = (Get-Command python).Source
$env:SONGCUT_REPO_ROOT = (Resolve-Path .).Path
cd gui
pnpm run electron:dev
```

バックエンド API だけを手動起動する場合は次を使います。

```powershell
python -m songcut.api --host 127.0.0.1 --port 8765
```

## ポータブルパッケージ

先に GUI 用 Python 依存とフロントエンド依存を入れます。

```powershell
python -m pip install -e ".[gui,dev]"
cd gui
pnpm install --frozen-lockfile
cd ..
```

`packaging/build_dist.ps1` は既定で `PATH` からツールを探します。明示的なパスを
使いたい場合は環境変数で注入できます。

```powershell
$env:SONGCUT_PYTHON = (Get-Command python).Source
$env:SONGCUT_NODE = (Get-Command node).Source
$env:SONGCUT_PNPM = (Get-Command pnpm.cmd).Source
$env:SONGCUT_GIT = (Get-Command git).Source
.\packaging\build_dist.ps1
```

このスクリプトは内部で production GUI build も実行します。パッケージング前に
フロントエンドだけを明示的に確認したい場合は、事前に `pnpm run typecheck` と
`pnpm run build` を実行してください。

パラメータで渡すこともできます。

```powershell
.\packaging\build_dist.ps1 `
  -Python "C:\Path\To\python.exe" `
  -Node "C:\Path\To\node.exe" `
  -Pnpm "C:\Path\To\pnpm.cmd" `
  -Git "C:\Path\To\git.exe"
```

出力先は既定で `dist\songcut-win-x64` です。再ビルド前には、実行中のパッケージ版
アプリを閉じてください。Windows が Electron ランタイムファイルをロックしていると
古い出力ディレクトリを削除できません。

パッケージのバージョンは `VERSION` と Git のコミット数を組み合わせた値です。例:
`1.0.3`。リポジトリ内に `.models\openvino\whisper-small` がある場合は、配布物の
`models\openvino\whisper-small` にコピーされます。存在しない場合も、Whisper モデル
非同梱のパッケージとして生成されます。

最低限、成功したパッケージには次が含まれます。

```text
dist\songcut-win-x64\songcut.exe
dist\songcut-win-x64\runtime\
dist\songcut-win-x64\app\dist\
dist\songcut-win-x64\app\dist-electron\
dist\songcut-win-x64\electron\songcut-electron.exe
dist\songcut-win-x64\README.txt
```

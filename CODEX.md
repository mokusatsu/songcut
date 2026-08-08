# 出力メッセージ
- ユーザーとの対話および作業途中のメッセージは日本語を使う。

# エージェント作業分割
- このリポジトリでの作業は、下記のようにメインエージェントとサブエージェントの作業に分けて実施する。
- メインエージェント：ユーザーが対話している相手。目標を理解し、リポジトリを検査し、受け入れ基準を定義し、サブエージェントにおけるCodexスレッド分業が価値を追加するかどうかを決定し、作業を分解し、最終レビューを実行する。サブエージェントに指示する。タスクは evidence-driven-task-management スキルを通じて管理する。tasks/task-list.mdにあるタスクリストを更新する際は、並行する作業チャットで相互にやり取りし競合しないようにする。
- サブエージェント：luna_workerサブエージェントを使う。

# コード確認
- docs\code-map\ の情報を手掛かりにソースコードの見通しとあたりを付ける

# コード実装
- 実装にあたっては同じような内容を重複して作成しないようにする。プロジェクト固有の事情として、Sub/Cutの両モードがあり、両モードで同じことをしている部分を2重に作らないいようにする。

# ドキュメント作成
- ユーザー向けドキュメント（USAGE.mdなど）はユーザー視点で必要な内容とし、実装経緯や内部事情、例外ケースなどは基本的に含めない。
- 技術ドキュメントは「概要 → 詳細」の順の構成とし、概要は高校生レベルでも理解できるわかりやすい説明から始め、段階的詳細化を行う。

# GUIにおける説明文
- GUIの設定項目などに端的な説明を追加する際も、ユーザー向けドキュメント同様にユーザー視点で必要な内容とする。

# GUIフォーカス設計
- Cut/SubのGUIを追加・変更する前に、`docs/GUI_FOCUS_POLICY.ja.md`を読む。
- Editor actionは共通focus scopeを使って操作後にeditorへfocusを戻し、文字入力中とmodal dialog内だけeditor shortcutを抑止する。
- Settings等のdialogに通常のTab操作を残し、Cut/Sub別のfocus処理や全interactive要素の一律shortcut抑止を追加しない。

# コードマップ更新
- ビルド実行時に並行で code_map_maintainer エージェントを起動しコードマップを更新する

# Codex Build Notes

- Windowsサンドボックスで `Microsoft\\WindowsApps\\pwsh.exe` の起動が `CreateProcessAsUserW failed: 5` になる場合は、権限付き実行を常用せず、実体の `C:\\Program Files\\PowerShell\\7\\pwsh.exe` がApp Execution Aliasより先に解決されるようPATHを修正する。

Public build instructions live in `docs/BUILD.md` and `docs/BUILD.ja.md`.
Keep Codex-specific runtime paths out of README and public build docs.
Packaged-GUI E2E commands, modes, artifacts, and troubleshooting are documented
in `docs/E2E_TESTING.md`; read it before changing or running an E2E script.

When building inside Codex, inject the bundled runtime paths through the
environment variables supported by `packaging/build_dist.ps1`. Keep these
commands in the same PowerShell session as the later `pnpm` and build commands;
the `PATH` update is what lets `pnpm` find `node.exe`.

```powershell
$CodexDeps = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$env:SONGCUT_PYTHON = Join-Path $CodexDeps "python\python.exe"
$env:SONGCUT_NODE = Join-Path $CodexDeps "node\bin\node.exe"
$env:SONGCUT_PNPM = Join-Path $CodexDeps "bin\fallback\pnpm.cmd"
$env:SONGCUT_GIT = Join-Path $CodexDeps "native\git\cmd\git.exe"
$env:PATH = "$(Split-Path -Parent $env:SONGCUT_NODE);$env:PATH"
```

Then install the local dependencies and build:

```powershell
& $env:SONGCUT_PYTHON -m pip install -e ".[gui,dev]"
Push-Location gui
& $env:SONGCUT_PNPM install --frozen-lockfile
Pop-Location
.\packaging\build_dist.ps1
```

For a fuller pre-package validation pass, run the tests and frontend checks
before `build_dist.ps1`:

```powershell
& $env:SONGCUT_PYTHON -m pytest
Push-Location gui
& $env:SONGCUT_PNPM run typecheck
& $env:SONGCUT_PNPM run build
Pop-Location
```

If a `pnpm` command fails with `node is not recognized`, rerun the environment
injection block above in the current shell before trying again.

The script also accepts the same tools as parameters:

```powershell
.\packaging\build_dist.ps1 `
  -Python $env:SONGCUT_PYTHON `
  -Node $env:SONGCUT_NODE `
  -Pnpm $env:SONGCUT_PNPM `
  -Git $env:SONGCUT_GIT
```

`build_dist.ps1` runs the GUI production build internally and writes
`dist\songcut-win-x64`. It sets the packaged GUI version from `VERSION` plus
`git rev-list --count HEAD`, and copies `.models\openvino\whisper-small` only
when that local model directory exists.

Treat a normal build and a release build as separate commands. A normal build
updates only the unpacked `dist\songcut-win-x64` directory:

```powershell
.\packaging\build_dist.ps1
```

When asked to create a release build, pass `-Release`:

```powershell
.\packaging\build_dist.ps1 -Release
```

The release build also writes `dist\songcut-[version]-full.zip`, containing
everything from `songcut-win-x64`, and `dist\songcut-[version].zip`, containing
the same package with empty `third_party` and `models` directories. The normal
build does not create or update these release archives.

Close any running `dist\songcut-win-x64\songcut.exe` or
`songcut-electron.exe` processes before rebuilding the portable package,
because Windows can keep Electron runtime files locked.

An explicit user request to update `dist` also authorizes closing processes
whose resolved executable paths are inside `dist\songcut-win-x64`; do not ask
for a separate confirmation. Resolve the exact process paths first and do not
stop same-named processes running from another package or directory.

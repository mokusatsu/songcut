# CLAUDE.md

このリポジトリは Codex で開発されてきた Windows デスクトップアプリ（`songcut`）です。
Claude でもビルド・テスト・配布物作成まで完了できることを確認済みです。

## ビルド手順

正規のビルド手順は [docs/BUILD.ja.md](docs/BUILD.ja.md) にあります。Codex 固有の
ランタイム注入（`$env:SONGCUT_PYTHON` 等）は [CODEX.md](CODEX.md) に分離されており、
**Claude では不要**です。システムの Python / Node.js / pnpm / Git / MSBuild をそのまま
使います。

検証済みのツールチェーン（2026-08-16 時点）:

- Python 3.12.10（Microsoft Store 版。`python` は App Execution Alias）
- Node.js v24.18.0 / pnpm 11.13.0
- Git 2.55.0
- Visual Studio 18 Community（MSVC v145 ツールセット）
- PowerShell 7（`pwsh`）

### Python（ルートで実行）

```powershell
python -m pip install -e ".[gui,dev]"
python -m pytest
```

`pyproject.toml` により `tests/` のみ収集され、352 passed / 2 skipped を確認済み。
長時間の `librosa.stft` 初回呼び出しは Numba キャッシュで停止することがあるため、
その場合は書き込み可能な一時領域を指定します。

### フロントエンド（`gui/` で実行）

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

いずれも成功を確認済み。

### ポータブルパッケージ（ルートで実行）

```powershell
.\packaging\build_dist.ps1
```

ネイティブ font resolver（MSBuild で x64 Release DLL をビルド）→ GUI production build →
PyInstaller → Electron 同梱まで一括で行い、`dist\songcut-win-x64` を生成します。
`Version: 1.1.86` の生成に成功しました（最低要件の
`songcut.exe` / `runtime` / `app\dist` / `app\dist-electron` /
`electron\songcut-electron.exe` / `README.txt` を確認済み）。

Release ビルドは `-Release` を付与します（full/standard の ZIP を追加生成）。

## 重要な注意点（Claude でビルドする場合）

- `build\ass_lyric_effects_site\` は Codex サンドボックスが作ったキャッシュで、
  制限付き ACL（`CodexSandboxUsers`）が付いています。`build_dist.ps1` はこの
  キャッシュが存在すると中身を再利用しようとし、Claude プロセスから読めず
  `PermissionError`（`ass_lyric_effects\__init__.py`）で失敗します。
  - `build\` は gitignore 済みの再生成可能キャッシュなので、`build_dist.ps1` は
    再実行時に自動作成します。**削除して再生成させるのが正解**です。
  - 削除には管理者権限での所有権変更が必要です（詳細は
    `build_dist.ps1` 実行時のエラーを参照）。
- 再ビルド前は実行中のパッケージ版アプリを閉じてください。Windows が Electron
  ランタイムファイルをロックし、古い出力ディレクトリを削除できません。

## 開発タスク管理

開発タスクは `evidence-driven-task-management` スキルで管理します。
`tasks/task-list.md` を唯一の正本とし、一度に1件をアクティブにします。
各タスクの詳細は `tasks/SCUT-NNN.md` の brief（目的・変更範囲・禁止事項・
完了条件・テスト方法・停止条件・実施証跡）に記録します。完了条件は第三者が
達成・未達を判断できる内容にします。

## コードマップ更新

コードベースの大規模な変更やビルド実行時には `code-map-maintainer`
エージェントを起動し、同梱 Python エンジンだけで `docs/code-map/` を差分更新します。
外部 MCP・code-review-graph CLI・pip 導入は不要です。

## その他の規約

- ユーザーへの出力（対話・作業メッセージ）は必ず日本語で行う。
- ソースコードの見通しは `docs\code-map\` を手掛かりにします。
- GUI（Cut/Sub）の追加・変更前には `docs/GUI_FOCUS_POLICY.ja.md` を読みます。
- 実装は既存の類似実装と重複させず、Cut/Sub の共通処理を二重に作らない方針です。

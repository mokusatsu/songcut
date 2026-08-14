# SCUT-061: Electron 43.4.0更新とダイアログ最終場所の維持

## 目的

同梱Electronを公式最新安定版43.4.0へ更新し、Electron 43で変わったファイル／フォルダーダイアログの初期場所を、利用者が最後に確定した場所へ戻す。

## 変更範囲

- `gui/package.json`と`gui/pnpm-lock.yaml`のElectron更新
- `gui/electron/main.ts`の共通ダイアログ入口
- `gui/electron/locale.ts`と同テストのアプリ設定保存
- `packaging/build_dist.ps1`のElectron runtime遅延取得
- `.gitignore`、`docs/code-map/`、本task brief、task-list

## 禁止事項

- GPU設定、ソフトウェアデコード、sandbox、媒体再生制御を変更しない
- OSレジストリを読んで旧ダイアログ履歴を移行しない
- Electron 43.4.0以外の依存更新を混在させない
- commit、push、Release ZIP作成を行わない

## 完了条件

- `gui/pnpm-lock.yaml`と取得済みElectron runtimeが43.4.0を指す
- 動画、プロジェクト、再リンク、出力先選択のすべてが共通入口を通る
- 確定したファイルは親フォルダー、確定したフォルダーはそのフォルダーを保存し、次回のダイアログへ`defaultPath`として渡す
- 言語設定の保存がダイアログ履歴を失わない
- GUI typecheck、全Vitest、production build、通常portable buildが成功し、配布物のElectronが43.4.0である

## テスト方法

- `pnpm install --frozen-lockfile`
- `pnpm run typecheck`、`pnpm test`、`pnpm run build`
- `packaging/build_dist.ps1`による通常portable build
- `ELECTRON_RUN_AS_NODE=1`で同梱Electronの`process.versions.electron`を確認
- `git diff --check`

## 停止条件

- Electron 43.4.0の取得またはbuildが既存依存と両立しない
- 通常portable buildの既存実行ファイルを安全に置換できない
- GPU子プロセス障害の解決を本更新だけで要求する必要が生じる

## 開始記録

- 2026-08-14: `main`、HEAD `5b34d47`、clean worktreeから開始。ユーザーがElectron最新版への差し替えと、最後に使った場所を開く互換性維持を明示した。
- 2026-08-14: Electron公式stable channelで43.4.0を確認した。既存33.4.11からの更新で、Electron 43は`defaultPath`未指定時にDownloadsを既定にするため、Songcutの4つの`showOpenDialog`入口を共通の保存済み場所へ配線する。

## 実施証拠

- 2026-08-14: `pnpm update electron@43.4.0 --lockfile-only`で`gui/pnpm-lock.yaml`を43.4.0へ解決し、`pnpm install --frozen-lockfile`と`pnpm exec electron --version`で公式Windows runtime `v43.4.0`を取得した。
- 2026-08-14: `pnpm run typecheck`成功。`pnpm test`は74 test files・463 tests成功。新規テストは言語設定とダイアログ履歴の同時保存で値が失われないこと、および空の履歴を無効値として扱うことを確認した。
- 2026-08-14: `pnpm run build`成功。`packaging/build_dist.ps1`による通常portable buildを成功させ、`dist/songcut-win-x64`を更新した。ネイティブfont resolver testも成功した。
- 2026-08-14: Electron 43の初回遅延取得を`build_dist.ps1`内で`require('electron')`してから同梱するよう固定し、変更後の通常portable buildも成功した。
- 2026-08-14: `dist/songcut-win-x64/electron/version`および`ELECTRON_RUN_AS_NODE=1`で実行した`dist/songcut-win-x64/electron/songcut-electron.exe`が、ともに`43.4.0`を出力した。実行ファイルのFileVersionも43.4.0。
- 2026-08-14: `git diff --check`成功。通常ビルドのみ実行し、Release ZIPは作成していない（既存最新ZIPのタイムスタンプは2026-08-10のまま）。コードマップのmaintain/validateも成功した。
- ダイアログ履歴は既存の`app-preferences.json`へ保存する。既存インストールにSongcut保存済み履歴がない最初の一回は、OSレジストリを読む移行を行わないため、最初に確定した場所から以後を引き継ぐ。

## 状態判断

2026-08-14: 完了。Electron 43.4.0を配布物へ同梱し、4つのファイル／フォルダーダイアログで最後に確定した場所をアプリ再起動後も渡せることを、型検査・全テスト・通常portable build・実バイナリ検査で確認した。

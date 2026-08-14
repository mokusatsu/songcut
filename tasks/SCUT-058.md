# SCUT-058: CodexSandboxOnlineのElectron GPU子プロセス起動障害特定

## 目的

`CodexSandboxOnline`でElectronのGPU子プロセスが`0xC0000135 (STATUS_DLL_NOT_FOUND)`を繰り返して終了する際、実際にロードできないmoduleまたはsandbox token／プロファイル制約を特定する。通常ユーザーでは成功する差分を根拠付きで説明し、GPU無効化に依存しない修正方針を確定する。

## 変更範囲

- Electron GPU子プロセスのmodule load／process creation診断
- `CodexSandboxOnline`と通常ユーザーのtoken、環境変数、profile path、ACL差分
- `os_crypt_win`、Spell-Checking Event 28、GPU `0xC0000135`の因果関係の切り分け
- 原因がSongcut側にある場合の最小修正と配布E2E

## 禁止事項

- `--disable-gpu`を製品の恒久回避策にしない
- sandboxユーザープロファイルや通常ユーザーのプロファイルを削除・初期化しない
- 欠落moduleを特定せず、推測でDLLを配布物へ追加しない
- SCUT-057のPyInstaller DLL検索パス分離を原因確定の代用にしない

## 完了条件

- GPU子プロセスがロードできないmoduleまたは起動を阻害するtoken／ACLを実測で特定する
- PyInstaller、Electron userData、DirectWrite resolver DLLとの関係を再現比較で確定する
- Songcut側の修正である場合、通常起動の安全性を維持してsandbox配布E2Eを成功させる
- Codex実行環境側の問題である場合、再現条件と必要な外部修正を根拠付きで提示する

## テスト方法

- loader traceまたは同等のmodule load観測でGPU子プロセスの失敗直前を採取する
- PyInstaller経由／Electron直接、通常userData／新規writable userDataを比較する
- 実行主体SIDと対象pathのread／execute権限を照合する
- 修正後はGPUを有効にしたままCDP page、renderer、media playbackを配布E2Eで確認する

## 停止条件

- loader traceに管理者権限またはCodex実行基盤側の計測支援が必要で、現sandboxから取得できない場合
- sandboxプロファイル再作成など、Songcutの変更範囲外で破壊的な環境操作が必要になる場合
- 原因修正にセキュリティ境界の無効化が必要になる場合

## 開始記録

- 未着手。SCUT-057の実配布検証で、DLL検索パス分離後も同じGPU子プロセス異常が再現したため分離した。
- 2026-08-14: `LAPTOP-NMJ33LCB\CodexSandboxOnline`、SID `S-1-5-21-2916212467-1779082049-3551022134-1004`で、PyInstallerを介さないElectron直接起動もGPU `0xC0000135`で失敗した。
- 2026-08-14: `C:\dev\songcut\out\scut057-direct-user-data-1307`を事前作成して`SONGCUT_E2E_USER_DATA_DIR`へ指定しても同じ失敗となった。通常userDataへのアクセス拒否だけではGPU異常を説明できない。

## 実施証拠

- 未実施。

## 状態判断

2026-08-14: 未着手。GPU子プロセスのloader trace取得から開始する。

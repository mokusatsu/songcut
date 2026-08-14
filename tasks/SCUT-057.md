# SCUT-057: PyInstaller外部Electron起動時のDLL検索パス分離

## 目的

PyInstaller製ランチャーが外部Electronを起動するとき、bootloaderが設定した`sys._MEIPASS`のDLL検索パスを子プロセスへ継承させない。Electron生成直後には親Python向けの検索パスを復元し、`CodexSandboxOnline`でGPU子プロセスを含む配布版起動を成立させる。

## 変更範囲

- `packaging/songcut_launcher_entry.py`の外部Electron生成境界
- DLL検索パスの解除・復元を固定するランチャー単体テスト
- 別名portable buildと`CodexSandboxOnline`での配布版E2E
- 起動ログ上のElectron／GPU子プロセス異常確認

## 禁止事項

- ElectronやDirectWrite font resolver DLLの構成・ロード方式を変更しない
- ランチャー全体からPyInstaller runtime向けDLL検索パスを恒久的に解除しない
- sandboxユーザープロファイルの削除・初期化や、GPU無効化を回避策として使わない
- 既存のdirty差分または通常配布物`dist/songcut-win-x64`を上書きしない

## 完了条件

- Windows frozen実行時、外部Electron生成直前に`SetDllDirectoryW(None)`を呼び、生成直後に`SetDllDirectoryW(sys._MEIPASS)`を復元する
- 非Windowsまたは非frozen実行ではDLL検索パスを変更しない
- 解除・生成・復元の順序と、生成失敗時にも復元する契約を単体テストで固定する
- 別名portable buildが成功し、`CodexSandboxOnline`の配布版E2Eが成功する
- 対象起動ログに`0xC0000135`、GPU process launch failure、GPU process is not usableの致命エラーがない

## テスト方法

- `tests/test_launcher.py`でWindows frozen／通常実行／生成失敗時のDLL検索パス契約を検証する
- 対象pytestと必要なランチャー回帰テストを実行する
- `packaging/build_dist.ps1 -PackageName songcut-win-x64-scut057-dllsearch`でportable buildを作成する
- 同配布物を`CodexSandboxOnline`からE2E起動し、成功結果・プロセス実行主体・起動ログを照合する
- `git diff --check`と対象差分を確認する

## 停止条件

- DLL検索パス解除後も同じGPU子プロセス異常が再現し、別のsandboxプロファイルまたはOSコンポーネント修復が必要になる場合
- sandbox実行主体を維持した配布版起動が実行環境の権限制約で行えない場合
- 対象ランチャーまたはテストへ並行する競合変更が入った場合

## 開始記録

- 2026-08-14: `main`、HEAD `6bf1074`。広範な未コミット差分を保持し、未変更の`packaging/songcut_launcher_entry.py`と`tests/test_launcher.py`に範囲を限定して開始。
- 2026-08-14: PyInstallerのWindows bootloaderはfrozen processへ`sys._MEIPASS`をDLL検索パスとして設定し、子プロセスもその設定を継承する。現ランチャーは解除せずに外部Electronを生成している。
- 2026-08-14: 既存配布版を`CodexSandboxOnline`から起動したログではElectron GPU子プロセスが`0xC0000135`で終了した一方、通常ユーザー起動では起動エラーにならない。独自DirectWrite resolver DLL自体の注入・継承を示す証拠はない。

## 実施証拠

- `packaging/songcut_launcher_entry.py`へ`spawn_external_process`を追加した。Windows frozen実行時だけ`SetDllDirectoryW(None)`、外部process生成、`SetDllDirectoryW(sys._MEIPASS)`復元を行い、通常実行は従来の`Popen`を使用する。生成失敗時にも`finally`で復元し、復元失敗時は生成済みprocessを終了する。
- `tests/test_launcher.py`で解除・生成・復元の順序、生成失敗時の復元、非frozen時に変更しない契約を固定した。対象pytestは`4 passed`、Python構文確認と対象差分の`git diff --check`も成功した。
- `packaging/build_dist.ps1 -PackageName songcut-win-x64-scut057-dllsearch`が成功し、`dist/songcut-win-x64-scut057-dllsearch`（version `1.1.76`）を生成した。native font resolver test、GUI production build、PyInstaller収集はいずれも成功した。
- 配布E2Eは`LAPTOP-NMJ33LCB\CodexSandboxOnline`、SID `S-1-5-21-2916212467-1779082049-3551022134-1004`で実行したが、CDP page待機に失敗した。起動ログではGPU子プロセスが9回`exit_code=-1073741515`で終了し、`GPU process isn't usable`でElectronが終了した。終了codeは`2147483651`。
- 同じ配布物の`electron/songcut-electron.exe`をPyInstaller親なしで同sandboxユーザーから直接起動しても、GPU子プロセスは同じ`0xC0000135`で失敗した。よってPyInstaller DLL検索パス継承は今回のGPU異常の直接原因ではない。
- 事前作成した書込可能な`out/scut057-direct-user-data-1307`を`SONGCUT_E2E_USER_DATA_DIR`へ指定したElectron直接起動でも同じGPU異常となった。通常userDataのアクセス拒否だけでも説明できない。
- GPU失敗と同時に`os_crypt_win`の`0x2`とWindows Spell-Checking Event ID 28は再発した。これらを含むsandbox環境の根本調査はSCUT-058へ分離した。
- 同梱Pythonによるコードマップ差分更新と最終validateは`ok: true`（warning／errorなし）。`spawn_external_process`の解除・生成・復元フローと3系統のlauncher test対応を反映した。

## 状態判断

2026-08-14: 保留。DLL検索パス分離の実装・単体テスト・portable buildは成功したが、必須のsandbox配布E2Eは同じGPU `0xC0000135`で失敗したため完了条件を満たさない。PyInstallerを介さない直接起動でも再現したため、本修正が当該障害の解決策ではないことを確認した。根本原因の特定はSCUT-058で扱う。

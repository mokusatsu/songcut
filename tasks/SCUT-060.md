# SCUT-060: 動画デコードエラーの復旧とソフトウェアデコード再起動

## 目的

指定MKVで観測されたElectronの`MEDIA_ERR_DECODE`後も、Cut/Subの編集セッションを閉じずに動画再生を復旧できるようにする。まず故障した`video`要素だけを破棄・再構築し、同じエラーが続く場合はSettingsから当該アプリ起動をソフトウェアデコードへ切り替えて再起動できるようにする。

## 変更範囲

- `gui/src/App.tsx`と必要最小限のGUI部品におけるvideo decode errorの通知、video再構築、再生位置／意図の復元
- ソフトウェアデコードで再起動するSettings操作とそのIPC契約
- `gui/electron`における起動前のハードウェア動画デコード無効化と再起動要求
- 対象Vitest、GUI typecheck、別名portable build、指定MKVでの実環境E2E
- 本タスクの記録

## 禁止事項

- GPUドライバ、OS、Electron sandbox設定を変更しない
- ソース動画を自動変換・置換しない
- デコード失敗時の無制限リトライやrenderer全体のクラッシュ／再読込を行わない
- ソフトウェアデコード選択を恒久設定として保存しない。指定された現在のアプリ起動だけへ適用する
- 既存のdirty差分を巻き戻し・整形しない

## 完了条件

- `HTMLMediaElement.error.code === MEDIA_ERR_DECODE`をvideoだけで検出し、原因と復旧手段を示すDialogを出す
- エラーを出したvideo要素を一度だけ再構築し、同じ動画URL、最後の有効な再生位置、再生中だったかを復元する
- Settingsから「ソフトウェアデコードで再読み込み」を実行すると、次のElectron起動だけは起動前にハードウェア動画デコードを無効化して再起動する
- 通常起動へ恒久設定は残らず、再起動要求・選択中のdecoder modeを診断ログで確認できる
- 自動復旧の一回制限、位置／再生意図の復元、IPC／起動引数の契約をVitestで固定する
- GUI typecheck、対象Vitest、別名portable buildが成功する
- 通常デスクトップで指定MKVを使い、Subの動画読込、decode error Dialog、video再構築、ソフトウェアデコード再起動を確認する

## テスト方法

- 対象Vitestと`pnpm run typecheck`
- 必要なElectron main/preloadテスト
- `packaging/build_dist.ps1`による別名portable build
- 通常起動した配布版で指定MKVを読み込み、CDPの実ポインタ操作でSettingsとSubを操作する。実デコード失敗の再現が不安定なため、`MEDIA_ERR_DECODE`イベントはrendererへ注入して回復経路を確認する

## 停止条件

- video要素の再構築が既存の共有media coordinatorまたは保存中プロジェクト状態と意味的に競合する場合
- Electronの起動前GPU設定変更だけではソフトウェアデコードを保証できない場合
- 必須の再起動が未保存プロジェクト内容を失わせる場合

## 開始記録

- 2026-08-14: `main`、HEAD `6bf1074`。広範な未コミット差分を保持する。
- 2026-08-14: 診断版の通常デスクトップログでvideoに`PIPELINE_ERROR_DECODE: video decode error!`（`MEDIA_ERR_DECODE`）を192件確認。scratch proxyのAAC audioは再生継続し、renderer／backendの停止は観測しなかった。
- 2026-08-14: 指定MKVをffprobeとFFmpegで確認。Matroska内のH.264 High/1080p60とOpusは認識され、パケット時系列は単調、全編ソフトウェアデコードはexit 0だった。一方、FFmpegはH.264の`Late SEI is not implemented`警告を出した。

## 実施証拠

- `gui/src/App.tsx`でvideo限定の`MEDIA_ERR_DECODE`を記録し、同一ソース世代につき一度だけCoordinatorを無効化してReact keyによる`<video>`再構築を行う。最後の有効な位置と再生意図を復元し、利用者へ復旧Dialogを表示する。
- `gui/src/lib/mediaDecodeRecovery.ts`とVitestで、非decode errorの無視と一世代一回の再構築を固定した。
- Settingsの共通タブに「デコーダー復旧」／「ソフトウェアデコーダーで再読み込み」を追加した。選択は保存せず、現在の起動だけ`--songcut-software-decoder`を付ける。
- Electron mainはready前に`disable-accelerated-video-decode`を付与する。ポータブルランチャーはElectron子プロセスのexit code 75と一回限りの要求ファイルで再起動し、同じPython APIサーバーを維持する。resume payloadは一回だけ消費し、launcher logではマスクする。
- 自動検証: `pnpm run typecheck`成功、GUI Vitest `74 files / 461 tests`成功、`tests/test_launcher.py` `7 passed`、`git diff --check`成功。
- 通常ポータブルE2E: 指定MKVをSubで読み込み、`duration=286.065`、`readyState=4`、`error=null`を確認した。Settingsの実ポインタ操作でhardware起動からsoftware起動へ移行し、launcher logに`Electron exited with code 75`、`mode=software`を確認した。再起動後も同じvideo URLとSub選択が復元された。
- その実行中のvideoへ`MEDIA_ERR_DECODE`を注入し、Dialog表示、別`<video>`インスタンスへの再構築、再構築後`readyState=4`かつ`error=null`を確認した。これは異常処理経路の検証であり、実ファイルの物理破損を示すものではない。
- 最終portable build: `packaging/build_dist.ps1 -PackageName songcut-win-x64-scut060-decode-recovery`成功。`dist/songcut-win-x64-scut060-decode-recovery`、version `1.1.76`、2,226 files / 6,438,910,327 bytes。

## 状態判断

2026-08-14: 完了。SCUT-059のplay要求ライフサイクル修正とは独立して、`MEDIA_ERR_DECODE`発生後の限定的なvideo復旧と、利用者が選べる一回限りのsoftware decoder再起動を実装・通常ポータブルE2Eで確認した。software decoderはGPU/ドライバ起因の障害を切り分ける診断手段であり、すべてのファイル／デコード失敗の回復を保証するものではない。

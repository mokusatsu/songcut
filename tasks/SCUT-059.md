# SCUT-059: スクラッチ後の通常再生ライフサイクル競合の解消

## 目的

Cut/Sub共通のスクラッチ再生を停止した直後に通常再生・シークを繰り返しても、動画と音声が停止したままにならないようにする。`HTMLMediaElement.play()`の中断・失敗を隠さず、古いスクラッチ要求が後続の通常再生を妨げないことを固定する。停止が再発した場合は、配布ランチャーログから再生要求・媒体状態・Electronのレンダラー状態を時系列で確認できるようにする。

## 変更範囲

- `gui/src/App.tsx` の共有 video/audio 再生・停止入口
- 再生要求の直列化を担う最小のGUIライブラリとVitest
- `packaging/e2e_scratch_proxy.js` の「スクラッチ終了後に通常再生できる」回帰確認
- rendererの媒体イベントと`play()`結果を配布ランチャーログへ転送する最小の診断経路
- 本タスクの記録とE2E手順

## 禁止事項

- `scratch-proxy` のジョブ管理、音声プロキシ選択条件、GPU設定を変更しない
- Cut/Subで別々の再生制御を追加しない
- 再生失敗を無条件にリトライしない
- 動画のフルパス、継続的な再生時刻、媒体内容を診断ログへ出力しない
- 既存のdirty差分を巻き戻し・整形しない

## 完了条件

- スクラッチ停止が保留中の再生要求を無効化し、次の通常再生要求が古い要求の完了後に実行される
- 現在の通常再生要求だけが失敗メッセージを表示し、停止済みスクラッチの中断はエラー表示しない
- Cut/Sub共通の`video`、およびプロキシ`audio`で同じ制御を使う
- Vitestが再生中断後の再生、古い失敗の無視、現在要求の失敗通知を検証する
- 配布E2Eがスクラッチ終了後の再生・停止・シーク反復を検証する
- 配布版の`logs/songcut-launcher.log`に、video/proxy audio別の再生要求結果・停止／待機／失速／error等の媒体イベントとrenderer異常が記録される
- 通常デスクトップ上で指定MKVの隔離コピーを使う実操作確認を行う。Computer Useヘルパーが利用不能な場合は、失敗内容を証拠として記録し実環境検証待ちとする

## テスト方法

- `pnpm run typecheck` と対象Vitest
- `node --check packaging/e2e_scratch_proxy.js`
- 診断snapshotのVitest、GUI typecheck、別名portable build
- 別名portable build後のスクラッチE2E
- 通常起動した配布版をComputer Useで操作し、Subでスクラッチ、停止、再生、シークを反復する

## 停止条件

- 対象の共有media制御が並行する既存変更と意味的に競合する場合
- 通常デスクトップ操作のヘルパーが失敗し、代替としてsandbox CDPに戻す必要がある場合
- 修正にGPU設定・ドライバ・OS設定変更が必要になる場合

## 開始記録

- 2026-08-14: `main`、HEAD `6bf1074`。広範な未コミット差分を保持する。
- 2026-08-14: 指定のMKVでSubのスクラッチ再生、停止、再生・シーク反復後に動画・音声が停止するとの報告を受けた。
- 2026-08-14: `scratch-proxy` はバックグラウンドjobであり、繰り返しスクラッチの媒体停止・再生要求は`App.tsx`の共有`video`/`audio`で直接実行される。通常`play()`は失敗を観測していない。
- 2026-08-14: `songcut-win-x64-scut059-playback`の停止時ログではAPI、動画probe、AAC scratch-proxy完了、Electron/launcher存続を確認した一方、rendererの`play()`結果や媒体状態は記録されなかった。ログ補強を同タスクの診断条件として追加する。

## 実施証拠

- `MediaPlaybackCoordinator`を追加し、停止時に保留要求を無効化してから次の`play()`を直列実行するようにした。現在要求の失敗だけを`App`で表示し、スクラッチ要求の中断は表示しない。
- `App.tsx`の通常再生、範囲loop、スクラッチ、停止、プロキシ解放、媒体errorを共有coordinatorへ配線した。Cut/Subは同一`video`とプロキシ`audio`を共有するため、mode別実装は追加していない。
- `mediaPlaybackCoordinator.test.ts`で、停止済みスクラッチの後に通常再生が開始されること、古い失敗がcancelledになること、現在要求の失敗が呼出側へ返ることを固定した。
- `packaging/e2e_scratch_proxy.js`へAAC、Opus準備中、Opusプロキシ、プロキシ無効の各経路で、スクラッチ→停止→Space再生→停止を3回反復する実入力E2Eを追加した。
- `pnpm run typecheck` 成功、Vitest 70 files / 445 tests 成功、`node --check packaging/e2e_scratch_proxy.js` 成功、`git diff --check` 成功。
- `packaging/build_dist.ps1 -PackageName songcut-win-x64-scut059-playback` 成功。成果物は`dist/songcut-win-x64-scut059-playback`、version `1.1.76`。
- 通常デスクトップのComputer Useは、アプリ一覧取得時に3回とも`EPERM: operation not permitted, lstat 'C:\\Users\\lain\\AppData\\Local\\OpenAI\\Codex'`で失敗した。安全手順に従いsandbox CDPへ代替せず、指定MKVを使う実機E2Eと配布E2Eは未実施。
- コードマップを差分更新し、`validate`は`ok: true`、error/warning 0だった。
- `mediaDiagnostics.ts`を追加し、video／scratch-proxy audio別に、離散的な再生位置・ready/network state・媒体error・再生要求結果だけを記録するようにした。動画パス、媒体内容、連続した時刻更新は含めない。
- `App.tsx`は通常再生のrequest/resultと750ms後の進行確認、seek、scratch開始、および主要媒体イベントを記録する。Electron mainは`[songcut-media]`だけをランチャー標準出力へ転送し、rendererの媒体開始／停止、無応答、プロセス消失、load失敗も記録する。
- `pnpm run typecheck` 成功、GUI全件Vitest 71 files / 447 tests 成功、`git diff --check` 成功。`packaging/build_dist.ps1 -PackageName songcut-win-x64-scut059-media-diagnostics` 成功、version `1.1.76`、2801 files。
- 診断版の生成済みrenderer bundleとElectron main bundleに`[songcut-media]`および`render-process-gone`のmarkerが含まれることを確認した。通常デスクトップ実行での実出力はComputer Useヘルパー障害のため未確認。
- コードマップの`maintain --mode auto`は`ok: true`で診断対象4ファイルを更新した。sandboxのDB ACL制約により、今回の最終validate結果は未記録。

## 状態判断

2026-08-14: 実環境検証待ち。診断ログ入り別名portable buildを作成し、型検査・GUI全件テスト・静的成果物確認まで完了した。通常デスクトップを遠隔操作するComputer Useヘルパーの権限エラーにより、指定MKVでの実機E2E、配布E2E、実際の`[songcut-media]`出力確認が残っている。

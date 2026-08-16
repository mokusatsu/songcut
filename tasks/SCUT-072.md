# SCUT-072 Sub表示素再解析の即時待機表示・編集ロック・3秒debounce

## 目的

Subの歌詞本文または行境界を確定変更した直後に、Display Elementsサブパネルへ再解析待機状態を表示する。待機中・解析中は表示素の手動編集を無効にし、再解析結果の適用後に編集可能へ戻す。再解析の固定待機時間は10秒から3秒へ短縮する。

## 変更範囲

- `DisplayElementInspector`の再解析中表示、編集操作の無効化、境界handleの視覚状態。
- Display Elementsリストのスクロールバー下で右端文字が欠けないための表示領域確保。
- `LineReanalysisCoordinator`の固定debounce値と関連テスト。
- Display Elements GUIテスト、タスク正本、実施証跡。

## 禁止事項

- 表示素手動編集からCTC再解析を直接起動する既存契約を変更しない。
- 行単位の取消、revision／epoch guard、manual element保護を変更しない。
- Cut、Project schema、公開API、後方互換レイヤーを変更しない。
- 既存の未確認dirty差分を変更、stage、commit、pushしない。

## 完了条件

- eligibleな本文／行境界変更の確定直後に、対象行のDisplay Elementsパネルが`waiting`状態を表示する。
- `waiting`、`running`、`cancelling`の間、表示素の境界drag、本文編集、merge、blank追加、削除、lock、zoom操作が無効になる。
- Display Elementsリストの右端に、既存のスクロールリストと同じ12pxのスクロールバー用余白が確保される。
- 2,999msでは解析を開始せず、3,000msで1回だけ開始する。
- 解析完了後は表示素編集が再び有効になり、既存のstale／conflict／failed表示を壊さない。
- focused GUI tests、GUI typecheck、`git diff --check`が成功する。

## テスト方法

- `gui/src/lib/lineReanalysisCoordinator.test.ts`で即時`waiting`通知と3秒debounceを検証する。
- `gui/src/components/DisplayElementInspector.test.tsx`で待機表示、busyアクセシビリティ属性、編集操作のdisabledを検証する。
- bundled Node／pnpmで対象VitestとGUI typecheckを実行する。
- 配布版の実操作確認を行わない場合は、実環境検証待ちとして記録する。

## 開始記録

- 2026-08-16: `main` / HEAD `2dcea33f5b63bb29970ec9068ca99f5ced8cc606`で開始。既存のREADME、docs、GUI、Python、code-map、SCUT-064〜071関連dirty差分は保持し、本タスクの対象から除外する。

## 実施証跡

- 2026-08-16: 再解析待機中の英語を不自然な`Waiting for reanalyzing`ではなく、状態名詞を使う自然な`Waiting for reanalysis`へ統一した。日本語の`再解析待機中`と意味を合わせ、running／cancelling等の既存状態名は変更していない。
- 2026-08-16: `LineReanalysisCoordinator`の待機値を`3_000ms`へ変更し、確定変更直後の`waiting`通知をテストで固定した。2,999msでは開始せず、3,000msで開始する関連9テストが成功した。
- 2026-08-16: `DisplayElementInspector`で`waiting`／`running`／`cancelling`中の本文編集、境界drag、merge、blank追加、削除、lock、zoomを無効化し、`aria-busy`／`aria-disabled`／`role=status`を追加した。待機表示とdisabled属性を確認するGUIテストを含む2ファイル・15テストが成功した。
- 2026-08-16: Bundled Nodeのプロジェクト内Vitest実体で次を実行しexit 0。`src/components/DisplayElementInspector.test.tsx`、`src/lib/lineReanalysisCoordinator.test.ts`、2 files／15 tests。
- 2026-08-16: Bundled Nodeの`tsc.cmd`で`tsconfig.json`、`tsconfig.node.json`、`tsconfig.electron.json --noEmit`を順に実行しexit 0。`git diff --check`もexit 0（既存のCRLF警告のみ）。
- 2026-08-16: ユーザー依頼によりBundled Python／Node／pnpm／Gitを明示して通常の`packaging/build_dist.ps1`を実行した。初回は既存portable GUI（`dist/songcut-win-x64/songcut.exe`）が`electron/resources/default_app.asar`をロックして終了コード1となったため、配布先内のPIDだけを終了して再実行した。再実行はexit 0で、native font resolver tests、GUI production build（1779 modules）、PyInstaller 6.22.0、`dist/songcut-win-x64`生成を確認した。
- 2026-08-16: 通常ビルドのpackage versionは`1.1.84`。`songcut.exe`、`electron/songcut-electron.exe`、`app/dist/index.html`、`app/dist-electron/main.js`、新しいrenderer CSS／JSを確認した。`-Release`は指定しておらず、Release ZIPは生成・更新していない。500KB超chunk、node_modules lockfile同期、OpenVINOのtorch frontend／optional hidden importに関する既知警告はあるが、ビルド終了コードは0だった。
- 2026-08-16: Display ElementsのScrollArea viewportへ既存の`output-list`／`segment-review-list`と同じ`padding-right: 12px`を追加し、右端の時間文字が縦スクロールバーと重ならない領域を確保した。
- 2026-08-16: CSS修正後のfocused testは2 files／15 tests、GUI typecheckはexit 0。通常ビルドもrenderer CSS（`index-Cv1QuIWm.css`）生成とPyInstaller完了まで進んだが、portable package置換時に起動中の`dist/songcut-win-x64`プロセスが`default_app.asar`を再ロックしてexit 1となった。CSS修正後のportable package反映は未確認で、アプリ終了後の再ビルドが必要。
- 2026-08-16: アプリ終了後にBundled runtime指定の通常ビルドを再実行しexit 0。`dist/songcut-win-x64` version `1.1.84`、native resolver tests、GUI production build（1779 modules）、PyInstaller 6.22.0、renderer CSS `index-Cv1QuIWm.css`を確認した。配布CSS内の`padding-right:12px`は6箇所に含まれ、Release ZIP（最新既存`1.1.83`）は更新していない。

## 状態判断

実環境検証待ち。ローカルのfocused testとGUI typecheckは成功したが、変更後のportable GUIを起動してSubのDisplay Elements操作を実操作確認していない。

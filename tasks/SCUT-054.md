# SCUT-054 表示素編集による歌詞行境界ロック

## 目的

Subの表示素を手動編集した歌詞行について、意図せず行境界を変更して手動表示素を破壊しないよう境界編集ロックを提供する。ロック状態はサイドパネルと表示素ズームDialogで共通に操作でき、タイムライン上でも判別できるようにする。

## 変更範囲

- 歌詞行へ保存する表示素境界ロック状態とschema v3の任意フィールド
- 表示素編集commit時の自動ロックと、利用者による手動解除
- サイドパネル／表示素ズームDialog共通のロック操作と左右追加アイコン
- Subタイムラインの境界drag制約と中央ロック表示
- 先頭／末尾blank表示素の範囲内だけを許可する境界編集
- GUI unit／contract／schema roundtripテストと必要な配布E2E

## 禁止事項

- Cutの境界policy、表示素解析backend、Project schema versionを変更しない
- 手動表示素、stable ID、manual境界を暗黙に削除・clampしない
- サイドパネルとズームDialogへロック判定や編集操作を二重実装しない
- 既存の広い未コミット差分を戻したり整理したりしない
- commit、stage、push、Release ZIP更新を行わない

## 完了条件

- 表示素の境界drag、merge、左右blank追加、削除、本文編集を確定すると対象行の境界ロックが自動でONになる
- ロックボタンをサイドパネルとズームDialogの同じ共通toolbar位置に表示し、手動でOFFにできる
- ロックをOFFにした行は、手動表示素を含んでいてもSub行境界を変更できる
- ロックONの行は、先頭／末尾の非blank表示素を越える境界変更を拒否する
- 先頭または末尾がblankなら、ロックONでもそのblank区間内の境界変更を許可する
- ロックONの歌詞行は、タイムラインsegment中央にロックアイコンを表示する
- 左右blank追加ボタンのアイコンが追加方向と一致する
- schema v3の既存フィールド欠落文書を読み続け、新しいロック状態をroundtrip保存できる
- 対象Vitest、GUI typecheck、変更E2E構文、`git diff --check`が成功する

## テスト方法

- 表示素pure helperで自動ロック、手動解除、blank端部の許容範囲、ロックOFF時の自由編集を固定する
- Inspector／Zoom Dialogの静的markupテストでlock／unlock ARIA、toolbar順、左右アイコンを固定する
- SubTimelineEditorテストで中央lock表示と境界許容範囲を固定する
- project schema／adapterテストで任意フィールド欠落とON/OFF roundtripを確認する
- GUI typecheck、対象Vitest、必要な配布E2E、`git diff --check`を実行する

## 停止条件

- 既存の`start_locked`／`end_locked`が解析用hard boundと利用者操作ロックで両立せず、schema意味変更が必要になる場合
- blank端部を越えた境界変更で表示素の自動削除または本文変更が必要になる場合
- 対象ファイルに別作業の新しい競合変更が入った場合

## 開始記録

- 2026-08-14: `main`、HEAD `6bf107407d78f0d552af882c4c6d72c7b54743fa`、SCUT-040〜053を含む広い未コミット差分を保持した状態で開始
- 2026-08-14: 添付画像で、Display Elements toolbar左端とズームDialog同等位置、左右blank追加アイコン、タイムラインsegment中央の表示位置を確認した。

## 実施証跡

- 2026-08-14: 利用者の追加依頼により通常portableビルド検証を再開した。Release ZIPは対象外とする。
- 2026-08-14: 解析用の`start_locked`／`end_locked`とは分離し、schema v3の任意フィールド`display_element_boundary_locked`を追加した。既存文書でフィールドが欠落する場合は未ロックとして読み、新しい値はProject roundtripで保持する。
- 2026-08-14: サイドパネルとズームDialogが共有する`DisplayElementInspector`へLock／LockOpen操作を追加した。表示素の境界drag、merge、左右blank追加、削除、本文編集のcommit結果は共通経路で自動ロックし、利用者の手動解除は表示素revisionや再解析状態を変更しない。
- 2026-08-14: 左右blank追加を`ArrowLeftToLine`／`ArrowRightToLine`へ変更し、追加方向を明示した。Subタイムラインではロック中のsegment中央へpointerを奪わないLock表示を追加した。
- 2026-08-14: ロックOFF時は手動表示素を含む列を新しい行範囲へ比例再配置する。ロックON時は非blank表示素を固定し、連続する先頭／末尾blankの範囲内だけ行境界変更を許可する。1ms未満、非blank越境、partition不整合は拒否する。
- 2026-08-14: 対象Vitest 6 files / 62 tests成功。GUI全Vitest 68 files / 436 tests成功。GUI typecheck成功。
- 2026-08-14: `pnpm run build`成功（Vite 1775 modules、`gui/dist/index.html`、`assets/index-C4_BnYYQ.css`、`assets/index-BXrUm7l0.js`を生成）。500kB超chunk警告のみ。
- 2026-08-14: `node --check packaging/e2e_sub_mode.js`成功、`git diff --check`成功（既存改行コード警告のみ）。通常portable buildを実施し、Release ZIPは更新していない。
- 2026-08-14: 利用者の追加依頼によりCodex同梱Python／Node／pnpm／Gitを明示して`packaging/build_dist.ps1`をReleaseオプションなしで実行し、152秒で成功した。native font resolver build/test、GUI typecheck＋Vite production build、PyInstaller packagingを含み、portable versionは`1.1.76`。
- 2026-08-14: `dist/songcut-win-x64`の`songcut.exe`、`runtime`、`app/dist`、`app/dist-electron`、`electron/songcut-electron.exe`、`README.txt`を確認した。既存Release ZIPの時刻・サイズは変化せず、新規ZIPも生成していない。通常ビルド後の`git diff --check`も成功（既存改行コード警告のみ）。
- 2026-08-14: 通常ビルドと並行してコードマップを更新した。auto updateは15ファイル再解析・parse errors 0、verify／validateはいずれも`ok=true`でerrors／warningsなし。
- 2026-08-14: 更新後の通常portable配布版Sub E2Eを要求外形1060x720／1440x960で完走し、`SUB_DISPLAY_ELEMENTS_OK`、`SUB_DISPLAY_ELEMENT_ZOOM_OK`、`SUB_E2E_OK`を確認した。merge、右blank追加、削除、左blank追加の連続partition操作とZoom Dialog表示を配布版で検証した。ロック固有の自動ON／手動解除／blank端部許容は対象62件と全GUI Vitest 441件で固定されている。
- 2026-08-14: 同一の最終検証でPython全件477 passed、GUI typecheck、`pnpm run build`（Vite 1775 modules）、通常portable build version 1.1.76、`git diff --check`、code-map verify／validateを成功として再確認した。Release ZIPは生成・更新していない。
- 状態判断: 完了

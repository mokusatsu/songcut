# SCUT-053 Sub波形スクラブとセグメント入力の回帰を解消

## 目的

Subの波形を一度ドラッグした際に、同じpointer入力や端部auto-scrollが複数のスクラッチ再生を起動しないようにする。同時に、SCUT-051で変化したSub歌詞行のクリック選択と境界dragを回復し、Cutと同様にboundary handleを選択buttonの外へ置いてdrag後の互換clickが選択／seekを再発火させないようにする。

## 変更範囲

- 共有`TimelineWaveform`／`useTimelineViewport`のscrub dispatchとedge auto-scroll
- `SubTimelineEditor`の歌詞行本体・境界handleのpointer契約
- shared timeline／Sub editorの回帰テスト
- このbriefとtask list

## 禁止事項

- Sub専用のtimer、listener、debounceで共通経路を迂回しない
- scratch proxy、再生時間設定、Cutの選択・境界drag・再生rangeを変更しない
- 既存の未コミット変更を戻したり整理したりしない
- Project schemaを変更しない。配布E2Eは2026-08-14の追加指示により境界drag重点モードだけを変更し、通常ビルド後に実行する

## 完了条件

- edge zoneを含む一回のpointer scrub入力で`onScrub`が一度だけ呼ばれる
- auto-scroll中の追加dispatchはviewportが実際に移動したtickだけに限定される
- Sub歌詞行本体のクリック選択を維持し、SVG波形矩形だけはスクラブを遮らない
- Sub境界dragはpointer/mouse fallbackで一回commitし、drag直後のclickによる選択／seek／scratch再発火を起こさない
- 配布版E2EでSubの開始・終了境界をdragし、動画要素が描画可能なままで、再生位置が意図しない0秒や選択先頭へ飛ばず、境界が一回だけ確定する
- click seek、Cut/Sub共通のTimelineSurface契約を維持する
- 対象Vitest、GUI typecheck、`git diff --check`が成功する

## テスト方法

- `useTimelineViewport.test.ts`でedge auto-scrollのdispatch判定、端で移動できない場合、通常dragの一回dispatchを固定する
- `SubTimelineEditor.test.ts`でSVG波形矩形の透過、歌詞行クリック選択、boundary drag後click抑止を固定する
- 配布版を実際に起動するE2EでSubの開始・終了境界drag後の映像・時刻・選択・境界値を検証する
- GUI typecheckと`git diff --check`を実行する

## 停止条件

- 実機での再現が共有scrub dispatchや歌詞行入力ではなく、scratch proxy音源またはブラウザ固有のmediaイベントに限定され、別の再生仕様判断が必要になる場合

## 開始記録

- 2026-08-13: `main`、HEAD `6bf1074`、既存の広範な未コミット変更を保持した状態で開始
- 2026-08-13: 読み取り調査で、shared `useTimelineViewport.scrubFromClientX()`がedge auto-scrollで`onScrub`を呼んだ直後に同じ入力から再度`onScrub`を呼ぶ経路を確認した。auto-scroll timerも端でscroll位置が変わらないままdispatchし得る。SubとCutはいずれも同じ`TimelineSurface`と`onScrub: scratchPreview`を使用するため、共通経路で修正する。
- 2026-08-13: 追加報告を受け、SCUT-051で歌詞行HTML矩形までpointer透過にしたため行本体クリックが失われたことを確認した。Cutではboundary handleが選択buttonの兄弟要素なのに対し、Subでは選択buttonの子要素だったため、drag後の互換clickが親buttonの選択／seekを再発火し得る。SVG波形矩形だけを透過に戻し、Subのboundary handleも選択buttonの外側へ分離する。

## 実施証跡

- 2026-08-14: `timelineScrubAutoScroll`を共有viewportへ抽出し、通常のpointer入力は一回だけdispatchする一方、edge auto-scroll timerは実際にscroll位置が変わったtickだけ追加dispatchするようにした。開始／終了端で動けないtimer tickはスクラッチ再生を要求しない。
- 2026-08-14: SubのSVG波形矩形はpointer透過のまま維持し、歌詞行本体buttonは選択可能に復元した。Cutの`DragHandle`と同じく、Subのboundary handleを選択buttonの兄弟要素へ分離したため、drag後の互換clickが選択・自動seekへ伝播しない。
- 2026-08-14: `gui/node_modules/.bin/vitest.cmd run src/lib/useTimelineViewport.test.ts src/components/SubTimelineEditor.test.ts src/components/TimelineSurface.test.ts src/lib/useBoundaryDrag.test.ts`が4 files / 35 testsで成功した。端部clamp、実scroll時のみのauto-scroll、SVG矩形透過、歌詞行選択、handle兄弟化、pointer/mouse boundary lifecycleを固定した。
- 2026-08-14: `pnpm run typecheck`が成功し、`git diff --check`も空白エラーなし（既存のLF→CRLF警告のみ）だった。通常ビルドはこの不具合修正では要求されていないため実行していない。
- 2026-08-14: 修正前の配布E2Eで、開始handleのpointer-move直後に`Invalid Sub subtitle state.`が発生し、React rootとvideo要素が消失することを再現した。Subだけは歌詞行`start..end`と`display_elements`の連続partitionが一致する必要がある一方、drag previewが行境界だけを更新していたことが原因だった。Cutには表示素partition制約がないため同じ例外が発生しない。
- 2026-08-14: 行境界preview時にも既存の`retimeDisplayElementsForLine`を使って表示素を候補範囲へ追従させ、手動anchorと両立しない候補はstateへ適用しないようにした。中間previewが`validateSubtitleState`を通る回帰テストを追加した。

## 追加検証方針

- 2026-08-14: ユーザー指示により通常portable buildを追加実施する。テスト時間は解析・字幕出力経路よりGUI操作のデグレード防止へ重点配分し、GUI全Vitestとtypecheckを主要ゲートとする。Python全件、解析benchmark、実字幕出力E2Eは今回のビルド前ゲートから除外する。
- 2026-08-14: GUI全Vitestは初回実行で68 files / 430 tests中、67 files / 429 testsが成功した。唯一の失敗は`SubModePanel`が字幕ファイル形式型を`@/lib/api`から直接importしていた共通化contract違反だった。型を`@/lib/subtitleFileExport`へ移し、失敗した`commonizationContracts.test.ts`だけを再実行して14 tests成功、GUI typecheckも成功した。資源消費と重複を避けるため全430件の再実行は行っていない。
- 2026-08-14: `packaging/e2e_sub_mode.js`と`packaging/e2e_dist_smoke.js`の`node --check`が成功した。実配布E2E、Python全件、解析benchmark、実字幕出力は今回実行していない。
- 2026-08-14: 同梱runtimeを明示して`packaging/build_dist.ps1`を通常モードで実行し成功した。native font resolver test、GUI production build、PyInstaller、Electron portable化が完了し、version `1.1.76`の`dist/songcut-win-x64`を生成した。`songcut.exe`、`runtime`、`app/dist`、`app/dist-electron`、`electron/songcut-electron.exe`、`README.txt`を確認した。Release ZIPは更新していない。
- 2026-08-14: コード地図はビルドと並行してmaintain/update、verify、validateが成功した。parse error 0、validate `ok: true`、270 files / 3048 nodes / 10701 edges。
- 2026-08-14: 解析済みSub sidecarを使う短縮配布E2Eを追加し、実マウス入力前に`elementFromPoint`で境界のhit targetを確認した。修正前の配布版では、選択中歌詞行の`z-index: 8`が境界handleの`z-index: 5`を覆い、開始handle中央のhit targetが`.lyrics-segment.selected`だったため失敗した。Cutの境界handleは同じ重なり構造を持たない。この差を解消するためSub handleを選択行より前面へ移した。
- 2026-08-14: 最終GUI検証は`pnpm run typecheck`成功、`displayElements`／`useBoundaryDrag`／`SubTimelineEditor`／`projectAdapters`の4 files / 39 tests成功、`node --check packaging/e2e_sub_mode.js`成功、`git diff --check`成功。直前のGUI全体実行は68 files / 431 tests中430件成功で、唯一の失敗は新規回帰テストがvalidatorの戻り値をbooleanと誤認したテスト記述だったため、戻り値の実契約`SubtitleProjectState | null`へ修正後に対象テストを再実行した。資源消費を避け、全体テストの重複実行はしていない。
- 2026-08-14: 同梱runtimeを明示して通常`packaging/build_dist.ps1`を再実行し成功した。native font resolver test、GUI production build、PyInstaller、Electron portable化を完了し、version `1.1.76`の`dist/songcut-win-x64`と必須成果物を確認した。Release ZIPは更新していない。
- 2026-08-14: 指定実データ`05_ラストバージン - RADWIMPS.webm`と隣接Sub sidecarのコピーを使い、修正後portable版で開始・終了handleを実マウスdragした。`SUB_BOUNDARY_DRAG_E2E_PASS`を記録し、開始`18.336→17.888`、終了`24.190→24.560`、line revision `1→3`、表示素partition先頭／末尾も`17.888..24.560`へ一致した。drag中・後のvideoは1920×1080、readyState 4、平均輝度約152、opaque pixel 2304を維持し、React error 0、seeking/seeked/emptied/loadstart/errorは全て0、再生位置は19.336秒から変化しなかった。原本sidecarのSHA256は前後とも`02AC52388A295A633BE797608F5D3089B18145DB8F757B8F045D7D801075A8AC`で不変だった。
- 2026-08-14: コード地図のmaintain/update、verify、validateが成功した。270 files / 3,055 nodes / 10,743 edges、parse errors 0、validate `ok: true`。

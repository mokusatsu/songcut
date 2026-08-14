# SCUT-047 動画上の表示素タイミングプレビュー

## 目的

Sub動画上で通常字幕と表示素タイミングを独立して確認できるようにし、選択中Timelineの前後表示素と再生位置の関係を中央固定カーソルで把握できるようにする。

## 変更範囲

- Sub動画の実映像外にある左黒帯へ`Subtitle`／`Display elements`の表示切替を追加する
- 両設定をSub mode localStorageへ保存し、未保存時はONとする
- primary選択セグメントが所属するLyrics Timeline全体の表示素を、実映像外を含む動画pane全幅へ120px/秒で描画する
- 再生中はmedia時刻を`requestAnimationFrame`で追従し、表示素の平行移動を滑らかにする
- 選択中セグメント、非選択セグメント、active表示素、blank表示素を区別する
- 選択Timeline全体の表示素DOMを再生中は固定し、平行移動とactive境界だけを更新してプレビューを閲覧専用にする
- 既存Subtitle overlay、Checkbox、editor focus、i18n、複数選択契約を再利用する

## 禁止事項

- Project schema v3、字幕データ、解析API、Standard Align結果を変更しない
- 表示切替で字幕データや書き出し結果を変更しない
- 選択されていないLyrics Timelineを混在表示しない
- 表示素の幅や位置を歌詞文字数で均等化しない
- 動画上のプレビューから編集・選択操作を開始しない
- SCUT-045の共通header、情報Dialog、Sub Timeline密度を巻き戻さない

## 完了条件

- Sub動画の実映像外にある左黒帯へ`Subtitle`／`Display elements`チェックボックスが表示され、独立してON/OFFできる
- 両設定が再起動相当の再読込後にも復元され、保存値がない場合はONになる
- primary選択セグメントのTimeline内にある前後すべての表示素が、実映像外を含むpane全幅を使って120px/秒で中央カーソルへ滑らかに追従する
- 複数選択時はprimaryのTimelineを使い、同Timeline内の選択集合だけを強調する
- active表示素が既存選択状態と同じ視覚表現になり、非選択セグメントとblankを判別できる
- 有効なprimary選択がない場合は表示素を描画せず、Checkboxは操作できる
- プレビューがpointer inputを奪わず、既存字幕、再生、選択、shortcut、保存契約が維持される

## テスト方法

- 時刻からpxへの変換、中央カーソル、再生anchorが変わってもDOM key集合が不変であることをpure unit testで固定する
- Timeline選択、複数選択、active、blank、無選択のDOM／class契約をcomponent testで固定する
- Sub mode preferenceの既定値、読込、書込、不正値fallbackをunit testで固定する
- SubtitleとDisplay elementsの独立切替、focus復帰、Cut非表示をcomponent／integration testで確認する
- GUI typecheck、対象Vitest、全Vitest、`node --check packaging/e2e_sub_mode.js`、`git diff --check`
- 1060x720／1440x960で中央配置、重なり、overflowを目視確認する

## 停止条件

- 120px/秒と実動画幅で、表示素の時間関係を維持したまま判読可能な表示を実現できず、別の縮尺仕様が必要になる場合
- 既存SCUT-045差分との競合を解消するために、相手タスクの実装を巻き戻す必要が生じる場合

## 実施証跡

- 2026-08-13: branch `main`, HEAD `6bf1074`。SCUT-040〜046の未commit差分を保持したdirty worktreeで開始
- 2026-08-13: タスク`019ff987-ccaa-79d1-a4ea-891fb7f94af6`からSCUT-045の全自動テスト・通常ビルド成功、進行中なし、製品コード追加修正なしの引き継ぎを受領
- 2026-08-13: SCUT-045差分を戻さず、`App.tsx`、`styles.css`、`SubModePanel.tsx`等は最新worktreeへ追記することを相互確認
- 2026-08-13: `SubVideoPreview`、120px/秒のpure座標変換、active／blank／選択Timelineの描画、Subtitle／Display elementsの独立設定とmode localStorage保存を実装
- 2026-08-13: 対象Vitest 3 files / 21 tests、GUI typecheck、App composition 2 files / 17 tests、Sub E2E syntax、`git diff --check`成功
- 2026-08-13: GUI全Vitestは負荷制限付き再実行で63 files / 382 tests成功。初回並列実行の波形性能・JSDoc走査・生成済みElectron保存testの3件timeout／性能閾値超過は、単独27 testsと単一worker全体で再現せず成功
- 2026-08-13: 実画面確認で、controlsが実映像内へ重なる、表示素が実映像幅に制限される、`timeupdate`更新では移動がカクつく問題を確認。実映像外の左黒帯、pane全幅、`requestAnimationFrame`追従へ受け入れ条件を更新
- 2026-08-13: layerをpane全幅へ拡張し、controlsを実映像左のpillarboxへ分離。表示素trackをvideo時刻からRAFで平行移動する実装へ変更。対象2 files / 16 tests、GUI typecheck、対象`git diff --check`成功
- 2026-08-13: 実画面でRAF移動の滑らかさを確認後、一定間隔のDOM追加／削除による段差が残るフィードバックを受領。再生中のculling/rebaseを廃止し、選択Timeline全体のstable key集合を固定したままGPU transformとactive境界だけを更新する実装へ変更
- 2026-08-13: controlsを左pillarboxの左端から12pxへ明示配置し、Sub E2Eへ左端整列契約を追加。対象SubVideoPreview test 9件、関連対象3 files / 16 tests、GUI typecheck、`git diff --check`成功
- 2026-08-14: 更新後の通常portable配布版でSub E2Eを要求外形1060x720（client 1047x659）と1440x960（client 1427x791）で実行し、両方で`SUB_VIDEO_DISPLAY_ELEMENTS_OK`、`SUB_DISPLAY_ELEMENT_ZOOM_OK`、`SUB_SCRATCH_PLAYBACK_OK`、`SUB_EXPORT_OK`、`SUB_E2E_OK`を確認した。左pillarbox controlsの実映像外配置、pane全幅track、中央cursorのGPU transform、字幕／表示素の独立表示と保存に失敗はなかった。
- 2026-08-14: 両解像度の配布版captureを目視し、controlsの左端整列、実映像との非重複、表示素trackの中央追従、横方向overflowなしを確認した。
- 状態判断: 完了

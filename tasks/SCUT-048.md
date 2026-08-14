# SCUT-048 表示素ズーム編集と範囲再生

## 目的

選択中歌詞行の波形と表示素を前後2秒の文脈を含む広いDialogで精密に確認・編集できるようにし、Dialog表示範囲だけを安全に再生またはloop再生できるようにする。

## 変更範囲

- Display Elementsサブパネルのmerge左へ`Maximize2`ズーム編集ボタンを追加する
- 選択行の前後2秒（動画端でclamp）を全幅へ正規化したwide Dialogを追加する
- 既存全曲波形を対象範囲へ切り出し、ローカル時刻へ変換して表示する
- サイドパネルと共通primitiveで選択、共有境界drag、merge、左右への100ms blank追加、削除、文字編集を提供する
- Dialog専用range playback sessionでplay、pause、seek、loopを対象範囲内へ制限する
- ズームDialogだけ初期focusを編集領域へ置き、Spaceで再生／一時停止できるようにする
- SCUT-043のmanual保護と再解析取消／再予約経路を維持する

## 禁止事項

- 専用のBackend波形API、Project schema変更、MMS再解析経路を追加しない
- サイドパネルとDialogへ表示素編集ロジックを重複実装しない
- drag preview中に保存または再解析を発火しない
- Dialog closeで即時確定済み編集を巻き戻さない
- Dialogに表示した前後2秒を含む範囲外の再生、seek、loopを許可しない
- SCUT-046完了前に独立した停止タイマーを追加しない

## 完了条件

- 単一選択行に表示素がある場合だけズーム編集ボタンが有効になる
- Dialogに切り出し波形、表示素、playhead、範囲先頭／現在／終了、Play/Pause、Loopが表示される
- 波形が未取得でも表示素編集を継続できる
- 境界drag、merge、blank追加がサイドパネルと同じID、manual flag、revision、commit規則を使う
- 左右blank追加、削除、表示素文字編集がサイドパネルとDialogで同じdomain操作を使う
- 文字を持つ表示素の削除前だけ確認し、blankは確認なしで削除する
- 表示素削除後も行全体を隙間・重複なく覆い、削除区間を右隣（末尾だけ左隣）へ吸収する
- Dialog open時に停止し、範囲外なら先頭へ移動し、close時に停止して最後の位置を維持する
- Dialogの表示・seek・再生範囲は行の前後2秒を含み、動画の0秒／終端でclampされる
- Dialog open直後は編集領域がfocusされ、Spaceは再生を切り替え、各controlへ明示focusしたSpaceはcontrol本来の操作を行う
- Loop OFFで終了位置に停止し、Loop ONで先頭から継続する
- Project／音源変更、対象削除、行範囲変更でDialogと古いrange sessionが無効化される

## テスト方法

- 波形切り出し、境界補間、ローカル時刻変換、seek clampをpure unit testで固定する
- zoomボタン順序、tooltip、ARIA、disabled理由、Dialog focusをcomponent testで固定する
- fake media／fake timerでopen、play、pause、loop、close、stale sessionを検証する
- drag commit/cancel、merge、blank追加、SCUT-043 callbackの同値性をcomponent／integration testで確認する
- 左右追加、削除partition、文字編集、削除確認、IME中のEnter／Escape、Dialog初期focusとSpace優先順位をunit／E2Eで確認する
- GUI typecheck、対象Vitest、全Vitest、変更E2E syntax check、通常ビルド、`git diff --check`
- 1060x720／1440x960でDialogの横幅、waveform、controls、overflowを目視確認する

## 停止条件

- SCUT-046の停止契約がrange playbackへ安全に拡張できず、media backendの仕様判断が必要になる場合
- 既存波形密度では1ms表示素境界の編集に必要な視認性を満たさず、Backend API追加の判断が必要になる場合

## 実施証跡

- 2026-08-13: SCUT-046、SCUT-047完了後に開始する未着手タスクとして登録
- 2026-08-13: 全曲waveformを行範囲へ境界補間付きで切り出すpure helperとunit testへ着手
- 2026-08-13: SCUT-047の実画面フィードバック対応を優先するため、当該差分を保持して一時保留
- 2026-08-13: SCUT-047の対象unit／typecheck成功後に再開
- 2026-08-13: 実画面でwide Dialogが共通`.dialog`の後勝ち規則により920pxへ縮小され、再生カーソルが低頻度`timeupdate`由来のReact再描画でカクつくフィードバックを受領
- 2026-08-13: 専用Dialogを約80vwへ拡張。動画`currentTime`をRAFで読み、共通CSS変数をwaveformと表示素timelineの両playheadへ直接反映して、重いDialog再描画からカーソル移動を分離
- 2026-08-13: Zoom用Shadcn ScrollAreaを常設表示からautoへ変更し、縦scrollbarを右端へ固定して左側の黒い予約領域を解消。対象3 files / 16 tests、GUI typecheck、Sub E2E syntax、`git diff --check`成功
- 2026-08-13: GUI全Vitest 67 files / 409 tests、GUI typecheck、Sub E2E syntax、`git diff --check`が成功。通常ビルド version 1.1.76が成功し、`dist/songcut-win-x64/songcut.exe`を更新
- 2026-08-13: 前後2秒のりしろ、左右blank追加、削除確認、表示素文字編集、ズームDialog初期focusの追加要件を受領し再開。branch `main`、HEAD `6bf107407d78f0d552af882c4c6d72c7b54743fa`、SCUT-040以降の共有dirty差分を保持
- 2026-08-13: `displayElements.ts`へ左blank追加、右優先区間吸収の削除、stable IDを保つ文字編集を追加。domain unit 17件が成功
- 2026-08-13: サイドパネル／Zoom共通Inspectorへ左右追加、削除、文字のダブルクリック編集を配線。文字あり削除だけ確認し、blankは確認なしで削除する契約をcomponent／E2Eへ追加
- 2026-08-13: Zoom表示・seek・range playbackを行前後2秒（動画端clamp）へ拡張し、表示素timelineと境界dragも同じ座標系へ統一。Zoomだけ共通Dialogの任意initial focusを編集領域へ上書きし、背景Space再生とcontrol固有Spaceを分離
- 2026-08-13: 配布Sub E2Eでviewport 1427px、Dialog 1141.59px（80%）、waveform／timeline 1099.59px、左右のりしろ各約230.29px、左scrollbar gutterなし、初期focus、Space再生／停止、左右blank、文字編集、文字あり削除取消、blank無確認削除、Project保存を実測。表示素10件→merge 9件→右blank 10件→削除9件→左blank 10件の連続partitionを確認
- 2026-08-13: 実E2Eで見つかったSCUT-045由来の旧Toolbar class、Sub tab有効化待機、nested ScrollArea誤認、旧export完了文言を現行DOM／JobProgressDialog契約へ修正。最終実行は表示素・動画preview・書き出し生成／sidecar／codec確認まで通過し、旧完了文言待ちをprogress=1へ置換後にsyntax check成功
- 2026-08-13: GUI typecheck成功、GUI全Vitest 67 files / 418 tests成功、配布E2E 3 scriptsの`node --check`成功、`git diff --check`成功。通常ビルド version 1.1.76成功。`songcut.exe` 23,069,260 bytes、Electron executable 188,915,200 bytesと必須runtime/app成果物を確認
- 2026-08-14: 更新後の通常portable配布版Sub E2Eを要求外形1060x720（client 1047x659、Dialog 837.59px、waveform／timeline 795.59px）と1440x960（client 1427x791、Dialog 1141.59px、waveform／timeline 1099.59px）で完走した。両方で`SUB_DISPLAY_ELEMENT_ZOOM_OK`、`SUB_SCRATCH_PLAYBACK_OK`、`SUB_E2E_OK`を確認し、左右のりしろ、右端scrollbar、初期focus、Space再生／停止、表示素編集操作に失敗はなかった。
- 2026-08-14: 両解像度の配布版captureを目視し、wide Dialog、waveform、表示素timeline、controlsに重なり・切り詰め・不要な左gutterがないことを確認した。
- 状態判断: 完了

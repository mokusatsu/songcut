# SCUT-070 Subセグメント追加Dialogの実装

## 目的

SCUT-065で確定した仕様を、利用者がSub画面で操作できる実装へ反映する。現在のセグメント追加ボタンはactive Timelineへ即時追加するだけで、追加先Timelineと追加位置を選べないため、Dialogを開いて明示的に確定できるようにする。

## 変更範囲

- Subのセグメント追加ボタンから共通`Dialog`を開く。
- 追加先TimelineをDialog表示時のactive Timelineを初期値として、既存Timelineから選択できるようにする。
- 追加位置としてTimeline先頭、単一選択中セグメントの前／次、Dialog確定時の再生位置を表示する。
- 既存のrhythm grid、最大16区間、空き時間、重複拒否の規則を追加先Timelineへ適用する。
- 追加成功時は追加先Timelineと新規セグメントを主選択にし、Cancel・無効な位置・空きなしでは状態を変更しない。
- `docs/GUI_FOCUS_POLICY.ja.md`に従い、Dialog内は通常Tab操作、閉じた後はeditor focusへ復帰する。

## 禁止事項

- Cutのセグメント追加、Project schema、保存形式、公開API、Timeline上限を変更しない。
- 旧Projectのmigration、互換層、旧即時追加ボタンの別経路を残さない。
- 既存のrhythm grid、空き時間、重複判定をDialog専用に再実装しない。
- SCUT-066、SCUT-067の既存変更、ユーザーの未確認dirty差分、stage、commit、push、PR作成を行わない。

## 完了条件

- Subのセグメント追加ボタンでDialogを開ける。
- Dialog初期値がactive Timelineで、全Timelineを追加先として選択できる。
- Timeline先頭、前、次、再生位置の4位置を選べる。無選択／複数選択時は前／次が無効になる。
- 異なるTimelineの選択セグメントを前／次の時刻参照に使っても、追加先Timelineだけが変更される。
- 追加先Timelineの空き、grid不足、重複時に確定が無効または追加失敗となり、既存状態を壊さない。
- 成功時に新規セグメント、追加先Timeline、主選択、focusが更新され、Cancelでは状態が変わらない。
- pure logicとDialogの回帰テスト、GUI typecheck、対象Vitest、`git diff --check`が成功する。

## テスト方法

- `gui/src/lib/subtitles.test.ts`で4位置、grid、空き、重複、異Timeline時刻参照を検証する。
- `gui/src/components/SegmentAddDialog.test.tsx`でDialogの表示、選択肢、無効化、確定／Cancelの契約を検証し、`gui/src/components/SubModePanel.test.ts`でボタン／キーボード操作のDialog到達経路を固定する。
- 関連Vitest、GUI typecheckを実行する。
- packaged GUIの手動確認が未実施の場合は、実環境検証待ちとして記録する。

## 実施証跡

- 2026-08-16: SCUT-065の現行コードを再確認し、`SubModePanel.tsx`のセグメントボタンが`props.actions.addSegment`を直接呼び、`App.tsx`の`addNewSubtitleSegment`がactive Timelineへ`addFourBeatSegment`を即時適用していることを確認した。追加Dialogの起動経路は存在しなかった。
- 2026-08-16: `main` / HEAD `2dcea33`で着手。既存のSCUT-064〜067差分、`docs/mms-line-proportional-test-targets.md`、`tests/test_omniasr_alignment.py`、`tools/probe_omniasr_ctc_targets.py`を保持し、対象をGUI／字幕pure logicへ限定する。
- 2026-08-16: `SegmentAddDialog.tsx`を追加し、共通`Dialog`、追加先Timeline、先頭／前／次／再生位置、空きなし表示、Cancel／確定を実装した。Subボタンと`new-segment`キーボード操作は同じDialog起動経路へ統一し、成功時の追加先・主選択・editor focus復帰を`App.tsx`へ配線した。
- 2026-08-16: `addSubtitleSegmentAtPosition`を`subtitles.ts`へ追加し、4位置、rhythm grid、最大16区間、対象Timeline内の空き／重複拒否、異Timelineのanchor時刻参照をpure logicとして固定した。既存の`addFourBeatSegment`は旧利用箇所を残さず、既存pureテストの契約としてのみ保持した。
- 2026-08-16: bundled runtimeでGUI typecheckがexit 0、全GUI Vitestが75ファイル・471テスト成功、`git diff --check`が成功した。配布版GUIの手動起動・クリック確認は未実施のため、状態を実環境検証待ちとする。
- 2026-08-16: bundled runtimeで`gui`のproduction buildがexit 0（Vite 1779 modules、`gui/dist/index.html`とhashed JS/CSSを生成）した。500KB超チャンク警告は既存の最適化提案のみで、build errorはない。buildに伴う構造地図更新では`SegmentAddDialog`と関連GUIテストが`docs/code-map/modules/gui.md`へ反映された。
- 2026-08-16: bundled Python／Node／pnpm／Gitを指定して`packaging/build_dist.ps1`を通常モードで実行しexit 0。native font resolver testsがok、`dist/songcut-win-x64`のlauncher、Electron runtime、`app/dist/index.html`、`app/dist-electron/main.js`を確認し、package versionは1.1.84だった。`-Release`は指定せず、既存の1.1.83以前のZIPは更新していない。
- 2026-08-16: Add Dialogのフォントを既存方針と比較し、base 16pxを継承していたフォームをcontrol 14pxへ統一、ラベルもcontrol、プレビュー／エラーをmeta 13px、Selectを親フォント継承へ修正した。`SubModePanel.test.ts`へ共有font-size tokenの契約を追加した。
- 2026-08-16: 修正後のGUI typecheckがexit 0、対象Vitest 3ファイル・34テスト、および全GUI Vitest 75ファイル・472テストが成功し、`git diff --check`も成功した。portable packageはこのCSS修正前の1.1.84であり、修正後の配布版手動確認は未実施のため実環境検証待ちを維持する。
- 2026-08-16: CSS修正後にbundled runtimeで通常`packaging/build_dist.ps1`を再実行しexit 0。native resolver tests、GUI production build、PyInstaller、`dist/songcut-win-x64`生成を確認し、package versionは1.1.84、hashed CSSは`app/dist/assets/index-DbDkGch6.css`だった。主要launcher／Electron／renderer／main.jsの存在、CSS内のcontrol／meta token、Release ZIP未生成を確認した。

## 状態判断

実環境検証待ち。SCUT-065の仕様を実装し、ローカル自動検証は成功した。配布版GUIを起動してSub追加Dialogを実操作する確認が残っている。

## 関連

- [SCUT-065仕様策定](../tasks/SCUT-065.md)

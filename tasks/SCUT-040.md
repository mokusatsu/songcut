# SCUT-040 Cut/Sub共通の全高右サイドパネル

## 目的

Cut/Subのセグメント設定をmodal dialogから共通の全高右サイドパネルへ移し、選択対象を見ながらタイミングとSub固有Style／Effectを即時編集できるようにする。

## 変更範囲

- App直下の全高2列layoutと360px panel／36px collapse rail
- Cut/Sub共通Segment Inspectorと縦積みcollapsible section
- 既存SegmentTimingDialogのtiming評価・入力UI、SubtitleStyleEditorの再利用可能な抽出
- Cut/Subの明示選択、即時commit、i18n、focus、autosave配線
- 既存dialog／Tabs／double-click起動契約と関連unit／E2Eの更新

## 禁止事項

- lane全体のStyle Dialogを削除しない
- Cut/Sub別に同型のpanelやfocus処理を複製しない
- 無効な途中入力をprojectへ保存しない
- SCUT-041以降の表示素model／解析を先行実装しない

## 完了条件

- 右panelがvideo・splitter・editorを通して全高表示され、境界click／Enter／Spaceで開閉できる
- 明示選択が無い場合は「セグメントを選択してください」だけを表示する
- CutはTiming、SubはTiming／Styleを複数同時展開可能な縦sectionとして表示する
- 時刻はblur／Enter、Style／Effectは操作時に有効値だけ即時保存される
- Segment設定dialog、SubのTiming／Style Tabs、double-click起動経路が削除される
- editor action／text entry／modalのfocus契約とschema v3保存が維持される

## テスト方法

- GUI unit: unselected、collapse、accordion、timing validation、Style継承／上書き、focus
- `pnpm run typecheck`
- `pnpm test`
- `node --check packaging/e2e_dist_smoke.js`
- `node --check packaging/e2e_sub_mode.js`
- 1060x720／1440x960の目視確認は最終統合時に行う

## 停止条件

- 既存schemaを破壊しなければpanelへ移せない場合
- lane Style DialogやCut/Sub固有BoundaryPolicyの意味を変更する必要が生じた場合
- 対象ファイルに未確認のユーザー変更が見つかった場合

## 実施証跡

- 開始: branch `main`, HEAD `6bf1074`, tracked worktree clean
- 2026-08-12: ユーザー承認済み計画に基づき実装開始
- 2026-08-12: Appを全高2列へ変更し、360pxの共通`SegmentInspector`、36pxの全高開閉レール、明示選択時だけのCut/Sub内容表示を実装した
- 2026-08-12: Cut/Subのセグメント設定DialogとSub内Tabs／セグメント時刻設定double-clickを削除し、Timing／Styleを独立して同時展開できるARIA accordionへ移植した。lane全体Style Dialogは維持した
- 2026-08-12: 時刻は有効なblur／非IME Enter、Style／Effectは操作時に既存project更新経路へ即時保存し、Escape／無効途中値／選択切替では保存しない契約をunitで固定した
- `pnpm run typecheck`: 成功
- `pnpm test`: 50 files、315 tests成功
- `pnpm run build`: 成功（Vite 1760 modules、既知のchunk size警告のみ）
- `node --check packaging/e2e_dist_smoke.js`: 成功
- `node --check packaging/e2e_sub_mode.js`: 成功
- `git diff --check`: 成功
- 状態判断: ローカル検証済み。1060x720／1440x960の実画面確認は全タスク統合後の最終ゲートで行う
- 2026-08-13: 統合後のGUI全Vitest `55 files / 344 tests`、typecheck、本番buildが成功。Windows portable版のCut E2Eは`E2E_OK`、Sub E2Eは`SUB_E2E_OK`で完走し、右panelからのTiming／Style即時保存とfocus復帰を確認した
- 2026-08-13: 1060x720／1440x960の実画面を確認。右panelは全高360px、開閉railは36pxを維持し、toolbarの重なり、クリック不能な操作、横overflowはいずれも0だった
- 状態判断: 完了。全自動テスト、配布版E2E、最小／通常解像度の実画面確認を満たした

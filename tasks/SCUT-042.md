# SCUT-042 表示素サブパネルと編集タイムライン

## 目的

選択中歌詞行の表示素を右panelで確認し、100%幅の行内timelineで共有境界、merge、blank追加を直接編集できるようにする。

## 変更範囲

- 表示素collapsible section、一覧、行内timeline、再生highlight
- 共有境界drag、右merge、右100ms blank追加
- manual lock／stable ID／revision／autosave更新
- icon、tooltip、aria、focus、disabled理由

## 禁止事項

- 表示素単位の字幕描画・karaoke exportを追加しない
- 表示素編集からCTC再解析を直接起動しない
- 行範囲、隣接行、beat gridを表示素dragから変更しない
- zero-duration要素を保存しない

## 完了条件

- 選択行の全区間が100%幅へ正規化表示される
- blank、選択、再生中が区別して表示される
- shared boundary dragが左右を同時更新し、最小1msとpartition不変条件を守る
- merge-rightと100ms blank追加が仕様どおり動作し保存される
- 旧schema v3の未解析行は安全なempty stateになる

## テスト方法

- model unit: partition validator、drag、merge、split、manual lock
- component unit: 100% mapping、active highlight、button state、focus／aria
- project roundtripとautosave contract
- Sub packaged E2E更新

## 停止条件

- schema v3互換を壊さなければmanual状態を保存できない場合
- 既存BoundaryDrag lifecycleを重複実装する必要が生じた場合

## 実施証跡

- 2026-08-12: SCUT-041のPython対象テスト80件、GUI typecheck、対象Vitest 28件、変更E2E構文確認、きりたん歌唱DB 8曲×3行benchmark合格後に開始。branch `main`, HEAD `6bf1074`、SCUT-040〜041の未commit差分を継続保持
- 2026-08-12: Sub右パネルへ表示素accordion、表示素一覧、選択行100%幅timeline、選択／再生／blankの独立状態、Lucide icon操作とdisabled理由tooltipを追加
- 2026-08-12: 共有境界dragは既存`useBoundaryDrag`を再利用し、左右を同時preview、最小1ms、pointer-up一度だけrevision保存、pointer-cancel／Escapeで開始snapshot復元。merge-rightは左stable ID維持、blank-rightは101ms以上から末尾100msを切り出す
- 2026-08-12: model／component／project対象Vitest 19件成功、GUI typecheck成功、GUI全Vitest `327 passed`、本番build成功、`node --check packaging/e2e_sub_mode.js`、`git diff --check`成功
- 2026-08-12: Sub配布E2Eへ3 accordion、100% partition、merge／blank保存の検証を追加。実配布版の実行は最終統合gateで実施する
- 2026-08-13: Windows portable版Sub E2Eが`SUB_E2E_OK`で完走。実解析行の表示素10件を右mergeして9件、右100ms blank追加で10件へ戻し、partition／stable ID／manual状態の保存を確認した
- 2026-08-13: 統合後のGUI全Vitest `55 files / 344 tests`、typecheck、本番build、Cut portable E2Eも成功した
- 状態判断: 完了。表示、再生追従、共有境界drag、merge、blank追加、schema保存をunitと配布版E2Eで確認した

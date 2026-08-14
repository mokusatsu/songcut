# SCUT-044 セグメントインスペクタ調整と複数選択

## 目的

右セグメントインスペクタの密度とスクロールを改善し、Cut/Subのセグメント複数選択、一括削除、および対象モードにおけるTimeline移動とStyle一括編集を安全に提供する。

## 変更範囲

- 折り畳みレールを36pxから18pxへ縮小する
- Display Elements一覧を既存Shadcn/Radix `ScrollArea`へ統一する
- SubセグメントStyleのInherit表示とSaved Stylesの2行レイアウトを修正する
- Cut/Subのセグメント複数選択、選択表示、一括削除を追加する
- SubへTimeline表示とMove操作を追加し、選択セグメントを別レーンへ移動する
- Subの複数選択時はTimeline／Styleだけを表示し、Cutの複数選択時は編集項目を表示しない
- 通常クリックで単一選択、Ctrl/Cmdクリックで追加・解除、Shiftクリックで同一表示順の範囲選択を行う

## 禁止事項

- 現行schema v3へCut timelineモデルを追加しない。Timeline／Moveは既存LyricsLaneを持つSubだけに実装する
- 既存の単一選択ID、focus、keyboard、boundary drag契約を壊さない
- StyleがInheritのまま個別Style／Effect overrideを作らない
- 複数選択の削除で未選択セグメントまたは別Projectの状態を変更しない
- 移動先レーンの非重複制約を暗黙clampで回避しない

## 完了条件

- 折り畳みレールが18pxで、クリック／Enter／Spaceの開閉契約を維持する
- Display Elements一覧が共通`ScrollArea`を使い、native overflow scrollbarを持たない
- Inherit時は個別設定が非表示で、個別Typeを変更できない
- Saved Stylesの選択／適用と名前／保存が縦2行で表示される
- Cut/Subで複数選択を視認でき、削除が選択集合すべてへ一度だけ作用する
- 単一選択時の既存編集が維持され、複数選択時は許可された項目以外を編集できない
- Subで現在Timelineを表示し、妥当な移動先へ選択集合を移動できる

## テスト方法

- SegmentInspector、DisplayElementInspector、SubtitleStyleEditorのcomponent/unit test
- Cut/Subの選択集合、単一／追加／範囲選択、一括削除、選択消失のunit test
- Timeline移動の非重複、同一先、複数レーン選択、Style一括適用のunit test
- GUI typecheck、全Vitest、本番build、変更したCut/Sub E2Eのsyntax check
- 1060x720／1440x960で折り畳みレール、Saved Styles、scrollbar、複数選択を目視確認

## 停止条件

- Timeline移動先で既存セグメントと重なる際の期待動作を根拠なく補完する必要がある場合
- 複数選択の永続化にschema変更が必要になり、後方互換判断が必要になる場合

## 実施証跡

- 2026-08-13: branch `main`, HEAD `6bf1074`。SCUT-040〜043の未commit差分を保持した状態で調査開始
- 2026-08-13: 現行Cutは`Segment[]`を1本の`TimelineSurface`へ描画し、`Segment`／`ProjectSegment`にtimeline識別子がないことを確認。Subは`LyricsLane[]`を持ち、Timeline移動先を既存モデルで表現できる
- 2026-08-13: ユーザー文の「CutへTimeline」と「複数選択中はTimeline／Styleのみ、Cutでは操作なし」が整合しないため停止条件に到達。対象モードの確認待ち
- 2026-08-13: ユーザー確認によりTimeline／MoveはSubへ実装し、Cut複数選択時はインスペクタ操作なしと確定。通常クリック単一、Ctrl/Cmd追加解除、Shift同一表示順範囲選択として実装を再開
- 2026-08-13: 共通の選択集合resolverを追加し、Cut/Subのリスト・波形・歌詞ラベルから通常クリック、Ctrl/Cmd toggle、Shift範囲選択を配線。primary IDは既存Project fieldを継続利用し、追加選択はsession内だけに保持
- 2026-08-13: Cutは選択集合を確認Dialog経由で一括削除し、Subは全LyricsLaneを横断して一括削除。削除後はprimary位置に最も近い残存セグメントへ単一選択を戻す
- 2026-08-13: SubインスペクタへTimeline accordion、現在Timeline、移動先selector、Move操作を追加。移動先で重複、同一Timeline、空選択の場合は状態を変更せず拒否し、stable segment IDを維持
- 2026-08-13: Sub複数選択時はTimeline／Styleだけを表示し、Style変更を選択集合へ一括反映。Cut複数選択時は編集項目を表示しない。単一選択時だけTiming／Display Elementsを維持
- 2026-08-13: Inherit時は個別Type、font、effectを含む詳細Style editorを非表示にし、Custom時だけ表示。Saved Stylesは選択／適用と名前／保存の2行へ変更
- 2026-08-13: セグメントインスペクタの全高toggle境界と折り畳みレールを常時18pxへ統一。Display Elements一覧を既存Shadcn/Radix ScrollAreaへ移行し、native overflowを除去
- 2026-08-13: 対象unit/component 35件成功。最終GUI全テストは59 files／359 tests成功、`pnpm run typecheck`成功、`pnpm run build`成功（既存の500kB超chunk警告のみ）
- 2026-08-13: `node --check packaging/e2e_dist_smoke.js`、`node --check packaging/e2e_sub_mode.js`、`git diff --check`成功。code-map maintain／verify／validateはparse error 0で成功
- 2026-08-13: 配布版Cut/Sub E2Eと1060x720／1440x960の実画面目視は、ポータブル版の再ビルドと対話可能なWindows desktopが必要なため未実施
- 2026-08-13: ユーザー依頼によりRelease ZIPを作らない通常ビルドを実施。初回は同梱PythonにPyInstallerがなく停止したため、標準手順の`pip install -e ".[gui,dev]"`で宣言済み依存を導入して再実行
- 2026-08-13: `packaging/build_dist.ps1`成功。native font resolver build/test成功、GUI production build成功、PyInstaller／Electron配置成功。`dist/songcut-win-x64`をversion `1.1.76`として更新し、既存Release ZIPは更新していない
- 2026-08-13: ユーザー提供の実画面スクリーンショットで、Sub Timeline移動UI、インスペクタ折り畳みレール、複数選択後のレイアウトが配布ビルド上で表示されることを確認。追加の省スペース化要求はSCUT-045へ分離
- 状態判断: 完了

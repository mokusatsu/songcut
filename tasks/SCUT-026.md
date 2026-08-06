# SCUT-026 toolbar・timeline・boundary 契約の共有

## 目的

両モードで意味が同じ表示と編集 gesture を共有し、mode 固有 policy は外部から注入する。

## 変更範囲

- Cut/Sub toolbar と timeline の props
- `ModeMediaViewModel`、boundary callback/policy adapter
- 関連 component/unit test

## 禁止事項

- Cut の秒単位 policy と Sub の rhythm-grid policy を同一ロジックへ統合しない。
- focus primitive を複製しない。
- toolbar のボタン順・文言を変更しない。

## 完了条件

- [x] Load/Analyze/Export/Settings/Transport の共通 toolbar 実装を両 Panel が利用する。
- [x] Sub timeline の共通 media fields が `ModeMediaViewModel` を再利用する。
- [x] Cut Panel が具体的な boundary policy を import・実行しない。
- [x] 既存 focus と boundary drag のテストが成功する。

## テスト方法

- Unit: GUI全テスト
- Static: GUI typecheck
- Regression: toolbar focus、timeline、boundary drag

## 停止条件

- 表示仕様またはキーボード操作の変更が必要になった場合。

## 完了証拠（2026-08-05）

- `ModeToolbar.tsx`へLoad/Analyze/Export/Settingsと既存`EditorTransportControls`の順序を抽出し、Cut/Sub固有buttonはchildren slotへ残した。
- Sub timeline propsを`ModeMediaViewModel & SubTimelineDomainProps`へ変更し、waveform、再生、zoom、seek等の再宣言を削除した。
- Cut drag boundaryはPanelからedit intentを送り、App側で既存のCut drag policyを解決する構造へ変更した。0.1秒drag policyとcommit-on-cancelは維持した。
- GUI focus primitive、button順、class名、i18n文言、Cut/Sub固有toolbar buttonは変更していない。
- `pnpm run typecheck`、対象3 files／30 tests、全Vitest 45 files／272 tests、source契約、`git diff --check`が成功した。

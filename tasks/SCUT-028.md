# SCUT-028 App と Sub Panel の責務単位分割

## 目的

P0-P2で確立した境界を保ったまま、大きなファイルを責務単位へ分け、再びレイヤーが混ざりにくい構造にする。

## 変更範囲

- Sub timeline/editor component の分割
- mode panel composition/editor action adapter の分割
- import と関連テスト

## 禁止事項

- 単なる行数削減のための細切れファイルを作らない。
- Panel に controller/coordinator/platform依存を戻さない。
- UI、IPC、保存形式を変更しない。

## 完了条件

- [x] Sub timeline/editor が Panel orchestration から独立した component/module になる。
- [x] App の mode panel props 組み立てまたは editor action 群が責務名を持つ module に移る。
- [x] 共通処理の Cut/Sub 複製が増えていない。
- [x] GUI全テスト、typecheck、production build が成功する。

## テスト方法

- Unit: GUI全テスト
- Static: GUI typecheck
- Build: GUI production build
- 実環境確認: 構造変更のみのため本タスクでは必須としない

## 停止条件

- 分割にUI仕様変更や新しいglobal stateが必要になった場合。

## 実施証跡

- waveform/lane表示、segment label編集、boundary dragを`SubTimelineEditor`へ一体の責務として移し、`SubModePanel`はtoolbar・status・dialog orchestrationに限定した。
- `subModePanelAdapter`で`ModeSession`のcontroller/coordinatorをpresentation用`capabilities` / `operation` / `actions`へ変換し、Panelへraw objectやplatform APIが渡らない境界を固定した。
- Cut/Sub共通の`ModeToolbar`、`ModeMediaViewModel`、`ModeSession`はそのまま再利用し、mode固有実装の複製は追加していない。
- composition契約: 2 files / 15 tests 成功。全Vitest: 45 files / 275 tests 成功。
- `npm run typecheck` 成功。
- `npm run build` 成功（Viteの既存chunk size warningのみ）。
- `git diff --check` 成功（既存のLF→CRLF警告のみ）。

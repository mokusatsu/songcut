# SCUT-029 Panel境界の最小化と依存方向修正

## 目的

SCUT-025〜028で作ったPanel境界を現行AGENTS.mdの「最もシンプルな実装」に合わせて見直し、値を詰め替えるだけの間接化とAPI層からpresentation層への型漏れをなくす。

## 変更範囲

- `SubModePanel`のprops/action型とApp側の配線
- 字幕render requestのドメイン型
- Panel境界のsource contract test
- 未使用のSub timeline型

## 禁止事項

- Cut/Sub固有ドメインを一つの型へ統合しない。
- 保存schema、IPC payload、画面表示、操作手順を変更しない。
- 既存sidecar互換やmodeなしCut互換を、利用者確認なしに変更しない。
- 将来用途だけのadapter、facade、fallbackを追加しない。

## 完了条件

- [x] 値を詰め替えるだけの`subModePanelAdapter`が削除される。
- [x] `SubModePanel`の公開propsが共通viewとSub固有の表示値・操作意図だけを受ける。
- [x] 字幕render request型がAPI moduleではなく字幕ドメインに置かれる。
- [x] 未使用型とコメント文字列依存のsource assertionが削除される。
- [x] GUI全テスト、typecheck、production buildが成功する。

## テスト方法

- Unit/contract: GUI全Vitest
- Static: GUI typecheck、禁止importのsource contract
- Build: GUI production build
- Diff: `git diff --check`

## 停止条件

- 変更に保存schema、IPC payload、利用者操作の変更が必要になった場合。

## 実施証跡

- `subModePanelAdapter.ts`と`modePanelContract.ts`を削除し、Appが既存`ModeSession`からPanelの表示値と操作意図を直接配線する構造にした。
- `SubtitleRenderRequest`をAPI moduleから字幕ドメインへ移し、PanelからAPI層への型依存をなくした。IPC payloadは変更していない。
- 未使用`SubTimelineDomainProps`と、adapter名・コメント本文に依存するsource assertionを削除し、実際の禁止importとsession配線を検査するcontractへ変更した。
- typecheck、対象contract 12 tests、全Vitest 45 files／275 tests、production build、`git diff --check`が成功した。buildとの初回並行実行だけ生成testとの競合でtimeoutしたため、build完了後の全テスト単独実行で成功を確認した。

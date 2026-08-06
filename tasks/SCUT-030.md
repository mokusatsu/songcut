# SCUT-030 App composition rootの責務分割

## 目的

巨大な`App.tsx`から、独立して状態・非同期処理・副作用を所有できる機能を抽出し、Appをmode session、画面、dialogを組み立てるcomposition rootへ近づける。

## 変更範囲

- `App.tsx`のmodel準備・status・download orchestration
- 必要に応じた、単一責務を持つfeature hook/module
- 抽出した責務のunit testとApp配線contract

## 禁止事項

- state管理ライブラリを追加しない。
- stateを一括移行せず、独立して完結する責務だけを抽出する。
- propsを横流しするだけのcomponentや将来用途の汎用hookを作らない。
- UI、DOM class、IPC、保存形式、model download仕様を変更しない。

## 完了条件

- [x] model status取得、同時download抑止、task registry反映、完了後refreshが一つのfeature hookにまとまる。
- [x] Appがmodelごとのpromise refとdownload手順の詳細を持たない。
- [x] Appに残るmodel処理が利用場面の組み立てとdialog表示に限定される。
- [x] 抽出moduleに単体テストがあり、既存App contractも成功する。
- [x] GUI全テスト、typecheck、production buildが成功する。

## テスト方法

- Unit: model preparation hook/module
- Contract: Appの禁止import・責務配線
- Static: GUI typecheck
- Build: GUI production build
- Diff: `git diff --check`

## 停止条件

- 抽出にglobal state、新規依存、UI仕様変更が必要になった場合。

## 実施証跡

- `useModelPreparation`へWhisper／Demucs／MMSのstatus取得、同時download抑止、task registry更新、失敗反映、完了後refresh、dialog状態を移した。
- 3モデルに共通する準備済み判定、queued/progress/failure lifecycleを`runModelDownload`へ集約した。既存task ID、表示message、API polling間隔は維持した。
- Appから3本のpromise ref、6個のmodel state、3本のrefresh関数、約210行のdownload手順を削除した。Appは3,253行から3,037行になった。
- model lifecycle 3 tests、App責務contractを追加し、対象2 files／16 tests、全Vitest 46 files／279 tests、typecheck、production build、`git diff --check`が成功した。

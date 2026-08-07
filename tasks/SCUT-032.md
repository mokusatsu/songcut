# SCUT-032 作業タスクリストの汎用化

## 目的

Cut/Sub共通化campaignの詳細文書になっていた`docs/task-list.md`を、songcutのあらゆる開発作業を管理できる汎用SSOTへ再編する。

## 変更範囲

- `docs/task-list.md`の構成と一覧
- `tasks/SCUT-001.md`〜`SCUT-024.md`への既存詳細移動
- `tasks/README.md`の運用規則

## 禁止事項

- 既存タスクID、状態、依存関係、完了証拠を失わない。
- 過去の実装判断や検証結果を書き換えない。
- タスク管理以外のproduction codeを変更しない。

## 完了条件

- [x] task-listのタイトルと概要が機能分野を限定しない。
- [x] 一覧に全タスクのID、分類、状態、優先度、依存、完了条件要約、brief linkがある。
- [x] SCUT-001〜031の詳細と証拠がルートの`tasks/`から参照できる。
- [x] 状態、優先度、採番、1件進行中、証拠更新の運用規則が明記される。
- [x] 全linkの存在とID重複が検査される。

## テスト方法

- Markdown構造、ID重複、brief link存在のstatic検査
- `git diff --check`

## 停止条件

- 既存タスクの詳細を一意に対応付けられない場合。

## 実施証跡

- 旧task-listのSCUT-001〜024詳細を個別briefへ移し、一覧を汎用分類の32行へ再構成した。
- SCUT-025〜031の既存briefは内容を保持し、そのまま一覧から参照した。
- 旧一覧の横断的な設計判断を`CUT_SUB_COMMONIZATION_HISTORY.md`へ移し、task-listからcampaign固有の説明を除いた。
- static検査は`rows=32 unique=32`、`links=32 missing=0`。`git diff --check`も成功した。

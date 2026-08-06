# songcut 作業タスクリスト

## 目的

このファイルは、songcutの開発作業を機能分野に関係なく管理する唯一の一覧です。Cut/Sub共通化、GUI、解析、出力、品質保証、ドキュメント、開発運用など、すべての作業を同じ規則で登録します。

各タスクの目的、変更範囲、禁止事項、完了条件、テスト、停止条件、実施証拠はルートの[`tasks/`](../tasks/README.md)にある個別briefを正本とし、この一覧には優先順位と状態判断に必要な要約だけを置きます。

## 現在の作業

| 項目 | 値 |
|---|---|
| 進行中 | なし |
| 次のタスクID | `SCUT-033` |
| ブランチ | `codex/sub-mode` |
| 再編開始時HEAD | `5308509` |

## 運用ルール

- タスクIDは`SCUT-NNN`の連番とし、完了・中止を含め再利用しない。
- 原則として進行中は1件だけにする。開始前に個別briefの必須項目と依存関係を確認する。
- 状態は自己申告ではなく、差分、テスト結果、実環境確認など個別briefに記録した証拠で更新する。
- 新しい課題は既存タスクへ混在させず、未使用IDで追加し、関連・依存を記録する。
- 後方互換性、schema migration、破壊的変更が必要な場合は、実装前にユーザー判断を得る。
- commit、push、PR作成はユーザーが明示的に依頼した場合だけ行う。

## 状態定義

| 状態 | 判定基準 |
|---|---|
| 未着手 | briefは定義済みだが、調査・実装を開始していない |
| 調査中 | 仕様、既存実装、再現条件を確認している |
| 実装中 | 対象範囲の変更を行っている |
| ローカル検証済み | 必須のローカル自動テストと確認が成功している |
| 実環境検証待ち | ローカル検証済みだが、必須の実環境確認が残っている |
| 完了 | すべての完了条件と必須検証を証拠付きで満たしている |
| 保留 | 外部回答、権限、仕様決定を待っている |
| 中止 / 対象外 | 実行しない理由と判断がbriefに記録されている |

## 優先度

| 優先度 | 意味 |
|---|---|
| 最高 | 利用不能、データ破損、後続作業の停止など、最優先で扱う |
| 高 | 主要機能、信頼性、保守性に直接影響する |
| 中 | 価値は明確だが、直ちに他作業を止めない |
| 低 | 改善候補。着手前に必要性を再確認する |

## タスク一覧

| ID | 分類 | タスク | 状態 | 優先度 | 依存 | 完了条件の要約 | 詳細・証拠 |
|---|---|---|---|---|---|---|---|
| SCUT-001 | 品質保証 | Cut/Sub 現行契約のテスト固定 | 完了 | 最高 | なし | 意図的差分と共通契約が自動テストで固定され、全GUIテストが成功する | [詳細・証拠](../tasks/SCUT-001.md) |
| SCUT-002 | アーキテクチャ | モード安全性と operation 契約の修正 | 完了 | 最高 | SCUT-001 | Sub operation、終了時 recovery、relink destination が mode-safe になる | [詳細・証拠](../tasks/SCUT-002.md) |
| SCUT-003 | アーキテクチャ | AppMode と TimedEntity／BoundaryPolicy の共通化 | 完了 | 高 | SCUT-001 | Cut/Sub の時間範囲計算が共通primitive＋policyで表現される | [詳細・証拠](../tasks/SCUT-003.md) |
| SCUT-004 | GUI | Editor command dispatch の一本化 | 完了 | 高 | SCUT-003 | menu/keyboard が同じ dispatcher を通り、Cut専用操作がSubで実行されない | [詳細・証拠](../tasks/SCUT-004.md) |
| SCUT-005 | GUI | 境界ドラッグ lifecycle の共通化 | 完了 | 高 | SCUT-003 | pointer/mouse、preview、commit、cancelが共通化され、両モード1回commitになる | [詳細・証拠](../tasks/SCUT-005.md) |
| SCUT-006 | GUI | TimelineSurface の共通化 | 完了 | 高 | SCUT-005 | viewport、waveform、playhead、wheel、range layer の共通shellを両モードが使う | [詳細・証拠](../tasks/SCUT-006.md) |
| SCUT-007 | GUI | CutModePanel の抽出 | 完了 | 高 | SCUT-006 | Cut workspace がAppから分離され、SubModePanelと対称な境界を持つ | [詳細・証拠](../tasks/SCUT-007.md) |
| SCUT-008 | アーキテクチャ | Mode controller／capability の導入 | 完了 | 高 | SCUT-004, SCUT-007 | 選択、隣接移動、境界再生、nudge、capabilityがadapter経由になる | [詳細・証拠](../tasks/SCUT-008.md) |
| SCUT-009 | ジョブ管理 | Operation runner とSub operation永続化 | 完了 | 高 | SCUT-002, SCUT-008 | task登録、poll、成功、失敗、interruptedが共通runnerを通る | [詳細・証拠](../tasks/SCUT-009.md) |
| SCUT-010 | プロジェクト | Project schema のmode別不変条件整理 | 完了 | 中 | SCUT-002 | schema v3互換を保ちつつCut/Sub混在状態を型とvalidatorで拒否する | [詳細・証拠](../tasks/SCUT-010.md) |
| SCUT-011 | メディア | Mode切替時のmedia/waveform再利用 | 完了 | 中 | SCUT-006, SCUT-010 | 同一fingerprintのモード切替で波形再生成を行わない | [詳細・証拠](../tasks/SCUT-011.md) |
| SCUT-012 | 設定 | 設定の保存スコープ明確化 | 完了 | 中 | SCUT-010, SCUT-011 | app共通／mode別／project別設定が型と保存先で分離される | [詳細・証拠](../tasks/SCUT-012.md) |
| SCUT-013 | GUI | Job progress dialog shell の共通化 | 完了 | 中 | SCUT-009 | Cut/Subの同型progress dialogが共通部品を使う | [詳細・証拠](../tasks/SCUT-013.md) |
| SCUT-014 | i18n | Sub UI ローカライズ統合 | 完了 | 中 | SCUT-007, SCUT-013 | Subの利用者向け固定日本語がi18n resourceへ移る | [詳細・証拠](../tasks/SCUT-014.md) |
| SCUT-015 | 品質保証 | 共通部品contract testと配布版回帰確認 | 完了 | 最高 | SCUT-012, SCUT-013, SCUT-014 | typecheck/build/unitが成功し、Cut/Sub E2E結果が証拠化される | [詳細・証拠](../tasks/SCUT-015.md) |
| SCUT-016 | GUI | Editor focus policy とショートカット継続 | 完了 | 最高 | SCUT-004, SCUT-007 | Cut/Subのeditor actionがfocusを保持せず、入力・dialog例外とWASD契約が共通化される | [詳細・証拠](../tasks/SCUT-016.md) |
| SCUT-017 | 出力 | Cut export進捗の利用者向け表示 | 完了 | 高 | SCUT-013, SCUT-014 | 内部export IDを表示せず、タイトルと現在件数／総件数を表示する | [詳細・証拠](../tasks/SCUT-017.md) |
| SCUT-018 | アーキテクチャ | Cut/Sub operation coordinator の責務対称化 | 完了 | 最高 | SCUT-007, SCUT-009 | Cut/Sub固有operationが同じ階層のcontrollerへ分離され、Appと両panelが同じ責務境界を持つ | [詳細・証拠](../tasks/SCUT-018.md) |
| SCUT-019 | 編集 | BoundaryPolicyの実配線と時間編集policy整理 | 完了 | 高 | SCUT-003, SCUT-005, SCUT-008 | 全境界編集入口が共通resolverを通り、意図的な0.1秒／0.001秒差とSub制約を維持する | [詳細・証拠](../tasks/SCUT-019.md) |
| SCUT-020 | プロジェクト | mode別project adapterによるcompose／hydrate分離 | 完了 | 高 | SCUT-010, SCUT-018 | 共通sessionとCut/Sub文書変換が分離され、mode固有field混在を呼出側の型で防ぐ | [詳細・証拠](../tasks/SCUT-020.md) |
| SCUT-021 | アーキテクチャ | App composition root の縮小 | 完了 | 高 | SCUT-018, SCUT-020 | Appが共通media/session/persistenceと画面配線へ集中し、mode固有operation実装を含まない | [詳細・証拠](../tasks/SCUT-021.md) |
| SCUT-022 | AI・解析 | Whisper execution session の共通化 | 完了 | 中 | SCUT-018 | Cut転写、Sub標準align、Uta-Alignが同じmodel/runtime/fallback基盤を使う | [詳細・証拠](../tasks/SCUT-022.md) |
| SCUT-023 | メディア処理 | FFmpeg process runner の共通化 | 完了 | 中 | SCUT-018 | Cut/Sub出力が共通process/error/progress primitiveを使い、command生成は固有に保つ | [詳細・証拠](../tasks/SCUT-023.md) |
| SCUT-024 | 品質保証 | P4/P5 contract testと配布版回帰確認 | 完了 | 最高 | SCUT-019, SCUT-021, SCUT-022, SCUT-023 | 新しい責務境界がunitとCut/Sub実E2Eで固定される | [詳細・証拠](../tasks/SCUT-024.md) |
| SCUT-025 | アーキテクチャ | Panel入力境界の統一 | 完了 | 最高 | SCUT-024 | Cut/Sub Panelからraw controller/coordinator/platform API依存を除き、表示値と操作意図だけを受ける | [詳細・証拠](../tasks/SCUT-025.md) |
| SCUT-026 | GUI | toolbar・timeline・boundary契約の共有 | 完了 | 高 | SCUT-025 | 共通toolbar、共通media型、Panel外boundary policyを両モードへ配線する | [詳細・証拠](../tasks/SCUT-026.md) |
| SCUT-027 | アーキテクチャ | operation・settings・project型の適正化 | 完了 | 中 | SCUT-026 | kind/slot対応、API設定入力、project selectionの過剰な共通型を縮小する | [詳細・証拠](../tasks/SCUT-027.md) |
| SCUT-028 | アーキテクチャ | AppとSub Panelの責務単位分割 | 完了 | 中 | SCUT-025, SCUT-026, SCUT-027 | Sub timeline/editorとmode compositionを責務単位で分割し、P0境界を維持する | [詳細・証拠](../tasks/SCUT-028.md) |
| SCUT-029 | アーキテクチャ | Panel境界の最小化と依存方向修正 | 完了 | 最高 | SCUT-028 | pass-through Adapterを削除し、Panel契約と字幕render型を実際の責務へ配置する | [詳細・証拠](../tasks/SCUT-029.md) |
| SCUT-030 | アーキテクチャ | App composition rootの責務分割 | 完了 | 高 | SCUT-029 | model準備などの独立した状態・副作用をfeature hookへ移し、Appを画面配線へ集中させる | [詳細・証拠](../tasks/SCUT-030.md) |
| SCUT-031 | ドキュメント・品質 | 公開・名前付き関数の日本語JSDoc整備 | 完了 | 中 | SCUT-030 | production TypeScriptの公開関数と変更対象の名前付き関数に日本語JSDocを付与し、契約テストで維持する | [詳細・証拠](../tasks/SCUT-031.md) |
| SCUT-032 | 開発運用 | 作業タスクリストの汎用化 | 完了 | 高 | SCUT-031 | 一覧とtask briefを分離し、機能分野を問わず同じSSOTで管理できる | [詳細・証拠](../tasks/SCUT-032.md) |

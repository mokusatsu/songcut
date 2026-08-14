# songcut 作業タスクリスト

## 目的

このファイルは、songcutの開発作業を機能分野に関係なく管理する唯一の一覧です。Cut/Sub共通化、GUI、解析、出力、品質保証、ドキュメント、開発運用など、すべての作業を同じ規則で登録します。

各タスクの目的、変更範囲、禁止事項、完了条件、テスト、停止条件、実施証拠はルートの[`tasks/`](../tasks/README.md)にある個別briefを正本とし、この一覧には優先順位と状態判断に必要な要約だけを置きます。

## 現在の作業

| 項目 | 値 |
|---|---|
| 進行中 | なし（SCUT-059は実環境検証待ち、SCUT-063は完了） |
| 次のタスクID | `SCUT-064` |
| ブランチ | `main` |
| 今回開始時HEAD | `9581e4b` |

## 運用ルール

- タスクIDは`SCUT-NNN`の連番とし、完了・中止を含め再利用しない。
- 原則として進行中は1件だけにする。開始前に個別briefの必須項目と依存関係を確認する。
- 状態は自己申告ではなく、差分、テスト結果、実環境確認など個別briefに記録した証拠で更新する。
- 新しい課題は既存タスクへ混在させず、未使用IDで追加し、関連・依存を記録する。
- 後方互換性、schema migration、破壊的変更が必要な場合は、実装前にユーザー判断を得る。
- commit、push、PR作成はユーザーが明示的に依頼した場合だけ行う。
- GUI変更では操作回帰を固定するVitestとGUI typecheckを優先し、Python全件、実解析、実字幕出力は変更範囲に必要な場合だけ実行する。

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
| SCUT-033 | Sub・字幕 | セグメント個別Style／Effect設定 | 完了 | 高 | SCUT-032 | Subセグメントがレーン継承または独自Style／Effectを選べ、保存・プレビュー・動画・ASSへ反映される | [詳細・証拠](../tasks/SCUT-033.md) |
| SCUT-034 | GUI | Timeline初回表示幅の同期 | 完了 | 中 | SCUT-006 | Cut/SubのTimelineが初回ペイント前から実viewport幅で描画され、通常ビルドが成功する | [詳細・証拠](../tasks/SCUT-034.md) |
| SCUT-035 | 字幕・調査 | ASS_Lyric_Effects置換調査 | 完了 | 高 | なし | 外部契約とsongcut影響範囲を照合し、障害・必要変更・互換性判断点・検証計画を根拠付きで確定する | [詳細・証拠](../tasks/SCUT-035.md) |
| SCUT-036 | 字幕・統合 | ASS_Lyric_Effects v3統合 | 完了 | 最高 | SCUT-035、ASS_Lyric_Effects MERGE23-003 | 旧ass-effects23を残さずv3公開catalog・97効果・実フォント複数行layoutをGUI、保存、ASS出力、配布版へ統合する | [詳細・証拠](../tasks/SCUT-036.md) |
| SCUT-037 | 字幕・不具合修正 | 名前付きウェイト書体の字幕出力修正 | 完了 | 最高 | SCUT-036 | Medium等の非太字物理faceを正しく解決し、ASS Effect付き出力とportable buildが成功する | [詳細・証拠](../tasks/SCUT-037.md) |
| SCUT-038 | 字幕・基盤 | MSVC DirectWrite font resolverへの置換 | 完了 | 高 | SCUT-037 | runtimeのPowerShell／子processを廃止し、MSVC DLLから実font path・face・coverageを厳格解決する | [詳細・証拠](../tasks/SCUT-038.md) |
| SCUT-039 | 字幕・GUI | 字幕エフェクト設定の情報設計修正 | 完了 | 高 | SCUT-036 | Type説明、duration、parameter、外部リンクを整理し、Outline／Boldの重なりを解消する | [詳細・証拠](../tasks/SCUT-039.md) |
| SCUT-040 | GUI | Cut/Sub共通の全高右サイドパネル | 完了 | 最高 | SCUT-039 | セグメント設定が共通右パネルへ移り、未選択・即時確定・縦積み折りたたみ・focus契約が成立する | [詳細・証拠](../tasks/SCUT-040.md) |
| SCUT-041 | AI・解析 | Standard Align表示素タイミング検出 | 完了 | 最高 | SCUT-040 | Standard Alignが品質判定付き表示素タイミングを返し、局所再解析用artifactを保持する | [詳細・証拠](../tasks/SCUT-041.md) |
| SCUT-042 | 字幕・GUI | 表示素サブパネルと編集タイムライン | 完了 | 高 | SCUT-041 | 選択行の表示素を100%幅で表示・編集・再生追従でき、blank・merge・追加が保存される | [詳細・証拠](../tasks/SCUT-042.md) |
| SCUT-043 | 字幕・解析 | 10秒遅延の行再解析と手動表示素保護 | 完了 | 最高 | SCUT-042 | 確定編集だけが10秒後に対象行を再解析し、同一行の旧task取消とmanual保護が成立する | [詳細・証拠](../tasks/SCUT-043.md) |
| SCUT-044 | GUI・編集 | セグメントインスペクタ調整と複数選択 | 完了 | 高 | SCUT-040, SCUT-042 | インスペクタ表示を整理し、Cut/Subの複数選択・一括削除と、SubのTimeline移動／Style編集が成立する | [詳細・証拠](../tasks/SCUT-044.md) |
| SCUT-045 | GUI | Cut/Sub操作・ステータス・タイムライン密度整理 | 完了 | 高 | SCUT-044 | Cutの解析導線とCut/Sub共通ヘッダーを省スペース化し、完了済み準備情報を共通情報Dialogへ集約し、SubのTimeline移動・名称編集・歌詞行密度を改善する | [詳細・証拠](../tasks/SCUT-045.md) |
| SCUT-046 | GUI・品質保証 | Cut境界プレビュー停止と配布E2Eの安定化 | 完了 | 高 | SCUT-045 | 開始／終了境界previewが設定秒数で停止し、配布E2Eで再現性高く検証される | [詳細・証拠](../tasks/SCUT-046.md) |
| SCUT-047 | 字幕・GUI | 動画上の表示素タイミングプレビュー | 完了 | 高 | SCUT-042, SCUT-044, SCUT-045 | Sub動画上で字幕と表示素を独立表示でき、選択Timeline全体の表示素が中央再生カーソルへ時間比例で追従する | [詳細・証拠](../tasks/SCUT-047.md) |
| SCUT-048 | 字幕・GUI | 表示素ズーム編集と範囲再生 | 完了 | 高 | SCUT-046, SCUT-047 | 選択行の前後2秒を含む波形と表示素をwide Dialogで編集でき、再生とloopがDialog表示範囲外へ出ない | [詳細・証拠](../tasks/SCUT-048.md) |
| SCUT-049 | 字幕・出力 | 選択Timelineを統合するSub字幕ファイル書き出し | 完了 | 高 | SCUT-042, SCUT-045 | Export Subから選択Timelineを統合し、SRT／表示素時刻付きLRC／ASSを一つの字幕ファイルとして書き出せる | [詳細・証拠](../tasks/SCUT-049.md) |
| SCUT-050 | Cut・再生 | Cut選択時の再生カーソル固定を解消 | 完了 | 高 | SCUT-046 | 選択時の一度だけのseekは維持し、以後のカーソル操作が選択開始位置へ戻されない | [詳細・証拠](../tasks/SCUT-050.md) |
| SCUT-051 | Sub・再生 | Sub波形上の歌詞行矩形によるスクラブ阻害を解消 | 完了 | 高 | SCUT-046 | 歌詞行矩形が波形スクラブを遮らず、境界ハンドルと歌詞ラベルの編集経路を維持する | [詳細・証拠](../tasks/SCUT-051.md) |
| SCUT-052 | 字幕・GUI | パレット型字幕エフェクトのカラーピッカー表示 | 完了 | 高 | SCUT-039, SCUT-040 | `color_wave`と`aurora_bands`の各パレット色を個別のカラーピッカーで編集でき、配列の順序・長さ・保存形式を維持する | [詳細・証拠](../tasks/SCUT-052.md) |
| SCUT-053 | Sub・再生 | 波形スクラブとセグメント入力の回帰を解消 | 完了 | 高 | SCUT-046, SCUT-051 | Sub波形の一回のpointer操作が重複したスクラッチ再生を起こさず、セグメント選択と境界dragを維持する | [詳細・証拠](../tasks/SCUT-053.md) |
| SCUT-054 | 字幕・GUI | 表示素編集による歌詞行境界ロック | 完了 | 高 | SCUT-042, SCUT-043, SCUT-048, SCUT-053 | 表示素編集行を自動ロックし、手動解除とblank端部内の境界編集、共通UI表示を提供する | [詳細・証拠](../tasks/SCUT-054.md) |
| SCUT-055 | 字幕・統合 | ASS_Lyric_Effects v3 最新wheel取り込み | 完了 | 最高 | SCUT-036 | 指定repoのクリーンHEAD wheelを固定し、97効果・字幕出力・配布版収集を検証する | [詳細・証拠](../tasks/SCUT-055.md) |
| SCUT-056 | 字幕・統合／GUI | Subタイムライン下端ガターとローカルASS実装取り込み | 完了 | 最高 | SCUT-055 | 最下段の表示素を横バーから保護し、指定ASS worktreeの実装をhash固定wheelとして配布版へ含める | [詳細・証拠](../tasks/SCUT-056.md) |
| SCUT-057 | 配布・起動 | PyInstaller外部Electron起動時のDLL検索パス分離 | 保留 | 最高 | SCUT-038 | DLL検索パス分離は検証済みだがsandbox GPU異常は未解消。PyInstaller非経由でも再現 | [詳細・証拠](../tasks/SCUT-057.md) |
| SCUT-058 | 配布・調査 | CodexSandboxOnlineのElectron GPU子プロセス起動障害特定 | 未着手 | 最高 | SCUT-057 | `0xC0000135`の欠落moduleまたはtoken／ACL制約を実測で特定する | [詳細・証拠](../tasks/SCUT-058.md) |
| SCUT-059 | Cut/Sub・再生 | スクラッチ後の通常再生ライフサイクル競合の解消 | 実環境検証待ち | 最高 | SCUT-053 | スクラッチ停止後の通常再生・シーク反復を共通media制御と回帰テストで固定し、停止時の媒体／renderer診断ログを追加した。通常デスクトップE2Eが残る | [詳細・証拠](../tasks/SCUT-059.md) |
| SCUT-060 | Cut/Sub・再生 | 動画デコードエラーの復旧とソフトウェアデコード再起動 | 完了 | 最高 | SCUT-059 | `MEDIA_ERR_DECODE`時に利用者へ通知しvideo要素を一度だけ再構築する。Settingsから当該アプリ起動だけをソフトウェアデコードへ切り替えて再起動でき、回帰テスト・通常ポータブルE2Eで確認した。利用者はElectron最新版への更新後、指定再現操作でデコードエラーが発生しなくなったことを確認した | [詳細・証拠](../tasks/SCUT-060.md) |
| SCUT-061 | 配布・互換性 | Electron 43.4.0更新とダイアログ最終場所の維持 | 完了 | 最高 | なし | Electronを43.4.0へ更新し、ファイル／フォルダー選択が最後に確定した場所を次回も開く。通常portable buildと実バイナリ43.4.0を確認済み | [詳細・証拠](../tasks/SCUT-061.md) |
| SCUT-062 | 配布・軽量化 | 配布物third_partyをffmpegに限定 | 完了 | 高 | SCUT-061 | `build_dist.ps1`が生成する配布物のthird_partyへffmpeg以外をコピーしない。再ビルドはユーザー指示により未実行 | [詳細・証拠](../tasks/SCUT-062.md) |
| SCUT-063 | 配布・品質保証 | 1.1.83 Release build | 完了 | 高 | SCUT-062 | Git commit count 83を基準にportable packageとFull／通常版Release ZIPを生成し、必須構成・third_party限定・archive構成を検証する | [詳細・証拠](../tasks/SCUT-063.md) |

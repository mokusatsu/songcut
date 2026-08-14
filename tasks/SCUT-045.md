# SCUT-045 Cut/Sub操作・ステータス・タイムライン密度整理

## 目的

Cut/Subの主要操作とステータスを同じ省スペースなヘッダー構造へ整理し、Cut解析時だけガイドテキストを確認する導線、Sub Timelineの簡潔な移動UIと名称編集、歌詞行表示の必要量に応じた高さを提供する。

## 変更範囲

- Cutの常設ガイドテキスト欄を撤去し、Analyze押下後にガイドテキスト確認入力Dialogを表示する
- Dialogで確定したガイドテキストをProjectへ保存し、その確定値で解析を開始する
- Cut/Subの操作部、保存状態、処理状態、メディア情報を省スペースな共通レイアウトへ整理する
- 完了済みの準備状態を常設表示せず、Cut/Sub共通の情報ボタンから開くDialogへ共通メディア情報、準備状態、タスク状態、Sub固有情報を整理する
- SubインスペクタのTimelineを`Current`／`Move to`の見出しと、現在名・矢印・移動先・Moveボタンからなる1行へ整理する
- Sub Timeline名を表示箇所のダブルクリックでinline編集できるようにする
- Sub歌詞行の段間と末尾余白を縮め、実際に必要な重なり段数からTimeline高さを決める
- 既存i18n、Dialog、Input、Button、Select、editor focus primitiveを再利用する

## 禁止事項

- Analyze押下だけで解析を開始しない。Dialog確定前、Cancel、Escapeでは解析しない
- 入力途中やIME composition中のEnter/Escapeを確定として扱わない
- Sub Timeline名編集のためにProject schemaを変更しない
- Timelineの時間座標、境界drag、複数選択、Moveの非重複制約を変更しない
- 歌詞行を詰めるために要素を重ねたり、最終行をclipしたりしない
- Cut/Subへ同一ヘッダー配置やfocus処理を重複実装しない

## 完了条件

- Cutに常設ガイドテキスト欄がなく、Analyzeで確認Dialogが開き、確定後だけ最新値で解析が始まる
- DialogのCancel／Escapeで解析せず、再表示時は保存済みガイドテキストを初期値にする
- Cut/Subの操作・保存状態・処理状態が同じ高さの省スペースヘッダーに収まる
- 常設ステータスカードがなく、共通ヘッダーの情報ボタンから詳細Dialogを開閉できる
- 情報ボタンは通常時に完了メッセージを表示せず、実行中タスク数または失敗状態だけをbadgeで示す
- 詳細Dialogが現在のCut/Subモード、動画、スクラッチ音声、波形、UIメッセージ、最新タスクをラベル付きで表示する
- SubではEffects、BPM、信頼度がDialog内のSub固有項目として表示され、Cutには表示されない
- 波形生成失敗時の再試行と失敗タスクのdismissを詳細Dialog内で実行できる
- Sub Timeline移動UIが`Current`／`Move to`と1行の移動操作で表示される
- Sub Timeline名がダブルクリックで編集でき、blurまたは非composition Enterで確定、Escapeで破棄される
- Sub歌詞行Timelineが必要な段数に応じて縮み、段間と最終余白が詰まる
- 既存の選択、境界drag、Move、Style、解析、保存、shortcut契約が維持される

## テスト方法

- Cut Analyze確認Dialogの表示、確定値、Cancel、Escape、IME、再表示をcomponent/unit testで固定する
- Cut/Sub共通ヘッダーのDOM契約と情報ボタン配置をcomponent testで固定する
- 情報ボタンの通常／実行中／失敗badge、Dialog内の共通項目、Sub固有項目、再試行／dismissをcomponent testで固定する
- Timeline移動の簡潔なlayout、disabled理由、Move callbackをunit testで固定する
- Timeline名のdblclick、blur／Enter確定、Escape／composition抑止をcomponent testで固定する
- 歌詞行の段数別高さ、最終余白、既存座標・drag契約をunit testで固定する
- GUI typecheck、対象Vitest、全Vitest、production build、変更したCut/Sub E2Eのsyntax check、`git diff --check`
- 1060x720／1440x960の目視確認は追加の実環境確認として扱い、自動テストと通常ビルドの成功を本タスクの完了判定とする

## 停止条件

- ガイドテキスト確定と解析開始を同じsnapshotで保証するためにAPI契約または保存schema変更が必要になる場合
- 可変Timeline高さが既存の座標・scroll・drag契約と両立せず、表示仕様の判断が必要になる場合

## 実施証跡

- 2026-08-13: branch `main`, HEAD `6bf1074`。SCUT-040〜044の未commit差分を保持した状態で開始
- 2026-08-13: ユーザー提供の1440px級Cut画面およびSub歌詞Timeline画像を基準に、常設ガイド欄、縦積みstatus、固定240pxレーン高さが主な余白要因であることを確認
- 2026-08-13: `ModeToolbar`をCut/Sub共通の操作＋transport＋statusヘッダーへ拡張。Cutの常設ガイド欄を削除し、`CutAnalyzeGuideDialog`で確定したsnapshotだけを`useCutOperations`へ渡すよう変更
- 2026-08-13: Sub Timeline移動欄を`Current → Move to [Move]`の1行へ整理。Timeline名のダブルクリック編集、非composition Enter／blur確定、Escape破棄を追加
- 2026-08-13: Sub歌詞レーン高を表示段数から算出し、先頭・末尾余白を縮小。共通statusと操作部をCutと同じ高さへ統合
- 2026-08-13: `pnpm run typecheck` 成功
- 2026-08-13: GUI全Vitest `61 files / 368 tests` 成功
- 2026-08-13: Python全pytest `472 passed, 2 skipped` 成功
- 2026-08-13: `node --check packaging/e2e_dist_smoke.js`、`node --check packaging/e2e_sub_mode.js`、`git diff --check` 成功
- 2026-08-13: 通常ビルド成功。成果物は`dist/songcut-win-x64`、`songcut.exe` 22,822,746 bytes、`songcut-electron.exe` 188,915,200 bytes。Vite JS/CSSも同時刻に生成
- 2026-08-13: 1060x720／1440x960のlayout-only配布E2E成功。右Inspector幅360px、横overflowなし、常設guideなし、Cut/Sub共通headerのcontrols/status同高をDOM geometryで確認
- 2026-08-13: Sub実データ配布E2E成功。39行解析、Timeline名編集、横scroll、Style、表示素merge／blank、PNG cache、字幕書き出しまで`SUB_E2E_OK`
- 2026-08-13: Cut配布E2Eはguide確認Dialog、確定値解析、共通header、保存、waveform操作まで成功後、既存の開始境界preview停止待ちで再現性のあるtimeout。別件`SCUT-046`へ分離
- 2026-08-13: CDP screenshotはtimeout、Windows fallbackは黒画面だったため、1060x720／1440x960の最終目視確認は未完了
- 2026-08-13: `docs/code-map`をincremental更新。255 files／2,935 nodes／10,233 edges／18 flows、parse errors 0、verify／validate成功
- 2026-08-13: 実環境画像のフィードバックを受け、右ステータスカード内で共通情報とSub固有情報が一列に混在する問題を追加修正として再開
- 2026-08-13: 共通`TaskStatusPanel`へCut/Sub見出しとラベル付きmetadata gridを追加。共通のメディア／スクラッチ音声／波形と、Sub固有のEffects／BPM／信頼度／拍警告を同じ項目契約で整理
- 2026-08-13: `TaskStatusPanel.test.tsx`でCut共通項目とSub固有項目のDOM契約を追加。対象Vitest `3 files / 11 tests`、GUI全Vitest `62 files / 371 tests`、typecheck、production build、`git diff --check`成功
- 2026-08-13: 実環境画像の追加フィードバックを受け、完了済みの波形／スクラッチプロキシ等を常設しない情報設計へ変更するため再開
- 2026-08-13: 常設ステータスカードを撤去し、Cut/Sub共通ヘッダーの情報ボタンから開く`ProjectInformation` Dialogへ、プロジェクト、メディア準備、モード固有情報、バックグラウンド処理を集約
- 2026-08-13: 情報ボタンは通常時に完了状態を表示せず、実行中件数または失敗件数だけをbadge表示。波形再試行と失敗task dismissはDialog内に維持
- 2026-08-13: bounded Dialogの詳細領域に共通`ScrollArea`を使用し、Dialog内のnormal focus scopeと通常Tab操作を維持
- 2026-08-13: `pnpm run typecheck`成功。対象Vitest `3 files / 13 tests`、GUI全Vitest `62 files / 374 tests`、production build、`git diff --check`成功
- 2026-08-13: GUI全Vitestの途中実行で既存波形性能テストが一度だけ時間上限超過（269ms / 100ms）したが、単独再実行`10 tests`と最終全実行`374 tests`で成功
- 2026-08-13: `docs/code-map`をincremental更新。257 files／2,940 nodes／10,273 edges／18 flows、parse errors 0、verify／validate成功
- 2026-08-13: 最終検証としてnative font resolver build/test成功、Python全pytest `472 passed, 2 skipped`、GUI typecheck成功、GUI全Vitest `62 files / 374 tests`成功、変更済みE2Eスクリプト3本の`node --check`成功、`git diff --check`成功
- 2026-08-13: 通常ビルド`packaging/build_dist.ps1`成功。`dist/songcut-win-x64`をversion `1.1.76`で更新し、`songcut.exe` 22,822,746 bytes、`electron/songcut-electron.exe` 188,915,200 bytes、`runtime`、`app/dist`、`app/dist-electron`、`README.txt`の存在を確認。Release ZIPは更新していない
- 2026-08-13: 最終コードマップ検証成功。257 files／2,940 nodes／10,273 edges／parse errors 0、verify／validate成功
- 状態判断: 完了（ユーザー指定の完了範囲である全自動テストと通常ビルドが成功。追加の実環境目視確認は任意）

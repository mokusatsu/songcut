# Cut/Sub 共通化 Task List

このファイルを P0〜P3 共通化作業の進捗管理における唯一の正本とする。会話、Issue、PR と状態が異なる場合は、このファイルへ正式な状態と証拠を反映する。

## 概要

Cut/Sub は、動画、波形、再生、保存、ジョブ管理を共有し、解析アルゴリズム、セグメントの意味、境界制約、出力形式はモード固有のまま維持する。共通化は「同じ意味の処理を一つにする」範囲に限定し、異なる意味を巨大な共通型や単一 endpoint へ押し込まない。

## 運用ルール

- タスク ID 形式は `SCUT-NNN` とし、発行済み ID を再利用しない。
- 原則として `調査中` または `実装中` のタスクは同時に1件だけとする。
- 実装、テスト、関連文書、差分確認、証拠更新を同じタスク内で完結させる。
- 完了条件と必須検証を証拠付きで満たした場合だけ `完了` にする。
- コミット、push、PR は明示依頼があるまで行わない。
- Cut の歌唱区間検出／smart clip export と、Sub の歌詞整列／字幕 export は統合対象外とする。
- `.songcut` と `.sub.songcut` は独立した編集文書として維持する。
- 既存の未コミット文書変更は利用者の作業として保持し、対象タスクが明示しない限り変更しない。

## 状態定義

| 状態 | 判定基準 |
|---|---|
| 未着手 | 調査も実装も開始していない |
| 調査中 | 仕様または既存コードを確認している |
| 実装中 | 対象の変更を行っている |
| ローカル検証済み | 必須ローカルテストが成功している |
| 実環境検証待ち | ローカル検証済みだが配布版E2Eなどが残っている |
| 完了 | すべての完了条件と必須検証を証拠付きで満たした |
| 保留 | 外部回答、権限、仕様決定などを待っている |
| 中止 / 対象外 | 実行しない判断と理由が記録されている |

## 開始時点

- ブランチ: `codex/sub-mode`
- HEAD: `64fc0eff00cd1df6c86e4fb52e4f0ed5083c6557`
- 既存変更: `CODEX.md`、README、CLI/USAGE/INDEX/KEYBOARD_SHORTCUTS、`packaging/README_DIST.txt`、`docs/FeatureCorrespondenceTable.xlsx`、`docs/SUB_STANDARD_ALIGN.ja.md`
- コード対象との重複: 開始時点ではなし

## Tasks

| ID | 段階 | タスク | 状態 | 優先度 | 依存 | 完了条件の要約 | 証拠 |
|---|---|---|---|---|---|---|---|
| SCUT-001 | P0 | Cut/Sub 現行契約のテスト固定 | 完了 | 最高 | なし | 意図的差分と共通契約が自動テストで固定され、全GUIテストが成功する | 2026-08-05: typecheck成功、Vitest 25 files / 160 tests成功、`git diff --check`成功 |
| SCUT-002 | P0 | モード安全性と operation 契約の修正 | 完了 | 最高 | SCUT-001 | Sub operation、終了時 recovery、relink destination が mode-safe になる | 2026-08-05: typecheck成功、Vitest 25 files / 165 tests成功、`git diff --check`成功 |
| SCUT-003 | P1 | AppMode と TimedEntity／BoundaryPolicy の共通化 | 完了 | 高 | SCUT-001 | Cut/Sub の時間範囲計算が共通primitive＋policyで表現される | 2026-08-05: typecheck成功、Vitest 26 files / 170 tests成功、`git diff --check`成功 |
| SCUT-004 | P1 | Editor command dispatch の一本化 | 完了 | 高 | SCUT-003 | menu/keyboard が同じ dispatcher を通り、Cut専用操作がSubで実行されない | 2026-08-05: typecheck成功、Vitest 27 files / 173 tests成功、`git diff --check`成功 |
| SCUT-005 | P1 | 境界ドラッグ lifecycle の共通化 | 完了 | 高 | SCUT-003 | pointer/mouse、preview、commit、cancelが共通化され、両モード1回commitになる | 2026-08-05: typecheck成功、Vitest 28 files / 180 tests成功、`git diff --check`成功 |
| SCUT-006 | P1 | TimelineSurface の共通化 | 完了 | 高 | SCUT-005 | viewport、waveform、playhead、wheel、range layer の共通shellを両モードが使う | 2026-08-05: typecheck成功、Vitest 29 files / 185 tests成功、build成功、`git diff --check`成功 |
| SCUT-007 | P1 | CutModePanel の抽出 | 完了 | 高 | SCUT-006 | Cut workspace がAppから分離され、SubModePanelと対称な境界を持つ | 2026-08-05: typecheck成功、Vitest 29 files / 185 tests成功、build成功、`git diff --check`成功 |
| SCUT-008 | P2 | Mode controller／capability の導入 | 完了 | 高 | SCUT-004, SCUT-007 | 選択、隣接移動、境界再生、nudge、capabilityがadapter経由になる | 2026-08-05: typecheck成功、Vitest 30 files / 188 tests成功、build成功、`git diff --check`成功 |
| SCUT-009 | P2 | Operation runner とSub operation永続化 | 完了 | 高 | SCUT-002, SCUT-008 | task登録、poll、成功、失敗、interruptedが共通runnerを通る | 2026-08-05: typecheck成功、Vitest 31 files / 193 tests成功、build成功、`git diff --check`成功 |
| SCUT-010 | P2 | Project schema のmode別不変条件整理 | 完了 | 中 | SCUT-002 | schema v3互換を保ちつつCut/Sub混在状態を型とvalidatorで拒否する | 2026-08-05: typecheck成功、Vitest 31 files / 202 tests成功、build成功、実sidecar 11件parse成功 |
| SCUT-011 | P2 | Mode切替時のmedia/waveform再利用 | 完了 | 中 | SCUT-006, SCUT-010 | 同一fingerprintのモード切替で波形再生成を行わない | 2026-08-05: typecheck成功、Vitest 32 files / 209 tests成功、build成功、`git diff --check`成功 |
| SCUT-012 | P2 | 設定の保存スコープ明確化 | 完了 | 中 | SCUT-010, SCUT-011 | app共通／mode別／project別設定が型と保存先で分離される | 2026-08-05: typecheck成功、Vitest 34 files / 218 tests成功、build成功、`git diff --check`成功 |
| SCUT-013 | P3 | Job progress dialog shell の共通化 | 完了 | 中 | SCUT-009 | Cut/Subの同型progress dialogが共通部品を使う | 2026-08-05: typecheck成功、Vitest 35 files / 228 tests成功、build成功、`git diff --check`成功 |
| SCUT-014 | P3 | Sub UI ローカライズ統合 | 完了 | 中 | SCUT-007, SCUT-013 | Subの利用者向け固定日本語がi18n resourceへ移る | 2026-08-05: typecheck成功、Vitest 35 files / 229 tests成功、build成功、固定CJK 0件、`git diff --check`成功 |
| SCUT-015 | P3 | 共通部品contract testと配布版回帰確認 | 完了 | 最高 | SCUT-012, SCUT-013, SCUT-014 | typecheck/build/unitが成功し、Cut/Sub E2E結果が証拠化される | 2026-08-05: typecheck、35 files / 229 tests、build、pytest 366 passed、配布build、Cut `E2E_OK`、Sub `SUB_E2E_OK`、`git diff --check`成功 |
| SCUT-016 | P3 | Editor focus policy とショートカット継続 | 完了 | 最高 | SCUT-004, SCUT-007 | Cut/Subのeditor actionがfocusを保持せず、入力・dialog例外とWASD契約が共通化される | 2026-08-05: typecheck、37 files / 238 tests、build、dist 1.1.57、Cut `E2E_OK`、Sub `SUB_E2E_OK`、focus実入力contract成功 |
| SCUT-017 | P3 | Cut export進捗の利用者向け表示 | 完了 | 高 | SCUT-013, SCUT-014 | 内部export IDを表示せず、タイトルと現在件数／総件数を表示する | 2026-08-05: pytest 367件、GUI 238件、typecheck/build、dist 1.1.57、`EXPORT_PROGRESS_TITLE_COUNT_OK`、`E2E_OK`成功 |
| SCUT-018 | P4 | Cut/Sub operation coordinator の責務対称化 | 完了 | 最高 | SCUT-007, SCUT-009 | Cut/Sub固有operationが同じ階層のcontrollerへ分離され、Appと両panelが同じ責務境界を持つ | 2026-08-05: mode別coordinator、39 files／244 tests、typecheck、build、Cut/Sub配布版E2E成功 |
| SCUT-019 | P4 | BoundaryPolicyの実配線と時間編集policy整理 | 完了 | 高 | SCUT-003, SCUT-005, SCUT-008 | 全境界編集入口が共通resolverを通り、意図的な0.1秒／0.001秒差とSub制約を維持する | 2026-08-05: Cut/Subのdrag、nudge、時間dialogを共通resolverへ配線し、全Vitest 40 files／251 tests、typecheck、build成功 |
| SCUT-020 | P4 | mode別project adapterによるcompose／hydrate分離 | 完了 | 高 | SCUT-010, SCUT-018 | 共通sessionとCut/Sub文書変換が分離され、mode固有field混在を呼出側の型で防ぐ | 2026-08-05: 共通base serializerとCut/Sub adapterを本番配線し、全Vitest 41 files／256 tests、typecheck、build、実sidecar parse成功 |
| SCUT-021 | P4 | App composition root の縮小 | 完了 | 高 | SCUT-018, SCUT-020 | Appが共通media/session/persistenceと画面配線へ集中し、mode固有operation実装を含まない | 2026-08-05: 対称mode sessionと共通panel view modelを本番配線し、Appを3,225行へ縮小。44 files／262 tests、build、Cut/Sub E2E成功 |
| SCUT-022 | P5 | Whisper execution session の共通化 | 完了 | 中 | SCUT-018 | Cut転写、Sub標準align、Uta-Alignが同じmodel/runtime/fallback基盤を使う | 2026-08-05: 共通sessionを3経路へ配線し、全pytest 374件成功／2件skip |
| SCUT-023 | P5 | FFmpeg process runner の共通化 | 完了 | 中 | SCUT-018 | Cut/Sub出力が共通process/error/progress primitiveを使い、command生成は固有に保つ | 2026-08-05: 同期／streaming runnerを配線し、全pytest 382件成功／2件skip |
| SCUT-024 | P5 | P4/P5 contract testと配布版回帰確認 | 完了 | 最高 | SCUT-019, SCUT-021, SCUT-022, SCUT-023 | 新しい責務境界がunitとCut/Sub実E2Eで固定される | 2026-08-05: contract、全test、build、portable 1.1.58、Cut/Sub実E2E成功 |

## 再評価後の追加方針（P4〜P5）

2026-08-05の再評価では、共通UI shellとoperation lifecycleは共有できている一方、operation orchestrationの所有場所がCut/Subで非対称であることを確認した。Cutの解析・転写・exportは`App.tsx`、Subの歌詞解析・字幕exportは`SubModePanel.tsx`が所有している。この非対称を、どちらか一方のcomponentへ寄せるのではなく、同じ階層のmode別coordinatorへ分離する。

目標構造は次とする。

```text
App.tsx
├─ common media / playback / waveform / persistence / task registry
├─ useCutOperations(common context, Cut state adapter)
├─ useSubOperations(common context, Sub state adapter)
├─ CutModePanel  ← action・job viewを受け取るpresentation
└─ SubModePanel  ← action・job viewを受け取るpresentation
```

- 共通化する責務: duplicate-start防止、project operation記録、task登録、poll、progress、成功、失敗、interrupted、利用者向けjob view。
- mode別に残す責務: endpoint、request payload、result型、成功結果のstate反映、resume可否、解析／出力の意味。
- `App.tsx`または単一の巨大なmode switchへ全operationを集約しない。
- panelから`OperationRunner`や生のoperation APIを直接呼ばず、mode coordinatorが返すactionとjob viewだけを渡す。
- Cutの通常drag／nudgeの最小長0.1秒と時間dialogの最小長0.001秒は意図的差分として維持する。単一の最小長へ統一しない。
- Cut/Subの解析pipeline、domain model、REST endpoint、sidecarは統合しない。

## 詳細タスク

### SCUT-001 Cut/Sub 現行契約のテスト固定

- 目的: 共通化中に意図的差分を壊さないため、現行の境界、sidecar、viewport、保存契約を先に固定する。
- 変更範囲: `gui/src/lib/*.test.ts`、`gui/electron/*.test.ts`。production codeは変更しない。
- 禁止事項: 既知の不整合を正しい期待値として固定しない。Appやcomponentの構造変更を混ぜない。
- 完了条件:
  - Cutの秒単位自由境界とSubの拍スナップ／lane非重複が別policyとして観測可能なテストで表現される。
  - `.songcut`／`.sub.songcut`、revision駆動autosave、共通viewport計算の契約がテスト化される。
  - GUI typecheckと全Vitestが成功する。
- テスト: `pnpm run typecheck`、`pnpm test`。
- 停止条件: 現行仕様同士の矛盾、production変更がないとテスト可能にできない契約を検出した場合。
- 完了証拠 (2026-08-05):
  - Cutの小数秒境界、Subの拍スナップ付きnudgeとlane非重複、Cut/Sub sidecar分離、両modeのrevision autosave、共通viewport follow policyを6テストファイルで固定した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 25 files / 160 tests passed。
  - `git diff --check`: exit 0。

### SCUT-002 モード安全性と operation 契約の修正

- 目的: 後続共通化の前に、Sub operationとrelinkが誤ったCut経路へ入る可能性を除く。
- 変更範囲: `project-schema.ts`、`App.tsx`、project/store関連テスト。
- 禁止事項: schema version変更、sidecar統合、Sub jobのresume仕様の推測実装。
- 完了条件:
  - validatorが型で許可された全operation kindを受理する。
  - quit recoveryが実行中のSub operation kindを保持する。
  - Sub relink先が`.sub.songcut`となり、Cut sidecarをarchive/上書きしない。
  - 対象test、全Vitest、typecheckが成功する。
- 停止条件: Sub operationをresumableにするか否かの製品判断が必要になった場合は、永続化契約を「interrupted記録のみ」に限定する。
- 完了証拠 (2026-08-05):
  - runtime validatorとquit recoveryを全5種の永続operation kindへ対応し、Sub relinkでactive modeをsidecar resolverへ渡した。
  - 全operation kindのparse／interrupted normalizationとCut/Sub sidecar分離をテストで固定した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 25 files / 165 tests passed。
  - `git diff --check`: exit 0。

### SCUT-003 AppMode と TimedEntity／BoundaryPolicy の共通化

- 目的: モード固有metadataを統合せず、共通する時間範囲操作だけを共有する。
- 変更範囲: 新規`lib/modes.ts`、`lib/timeRange.ts`、`boundaries.ts`、`segmentTiming.ts`、`subtitles.ts`とテスト。
- 禁止事項: `Segment`と`LyricsSegment`の統合、API payload変更。
- 完了条件: `AppMode`がsubtitle domainから独立し、Cut/Sub policyがmin duration、snap、neighbor constraint、nudgeを表現し、既存挙動を保持する。
- テスト: pure unit、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - `modes.ts`へ`AppMode`を移し、`timeRange.ts`とdomain-neutralな`BoundaryPolicy`を追加した。
  - Cutの自由小数秒＋0.1秒minimum、Subの拍snap＋厳密neighbor制約＋nudgeをpolicyで表現し、Sub既存関数を共通resolver経由へ移した。
  - epsilon二重適用をレビューで検出・修正し、単一epsilon互換テストを追加した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 26 files / 170 tests passed。
  - `git diff --check`: exit 0。

### SCUT-004 Editor command dispatch の一本化

- 目的: menuとkeyboardの重複switchを廃止し、mode capabilityを一箇所で強制する。
- 変更範囲: `App.tsx`、`shortcuts.ts`、新規dispatcher/helper、関連テスト。
- 禁止事項: shortcut割当変更、Electron menu label変更。
- 完了条件: 両入口が同じdispatcherを呼び、Cut専用export/segment管理がSubでno-opとなり、共通操作は同じadapterへ到達する。
- テスト: dispatcher unit、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - menu/keyboard入力を`editorCommands.ts`で正規化し、App内の単一executorへ配線した。menu固有のload/open/save/relink/settingsは既存経路に維持した。
  - SubでCut専用の一括segment管理、export、診断を拒否し、両mode共通の追加／選択削除は維持した。
  - 実装レビューでSubの追加／削除が誤って無効化される回帰を検出・修正した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 27 files / 173 tests passed。
  - `git diff --check`: exit 0。

### SCUT-005 境界ドラッグ lifecycle の共通化

- 目的: Cut/Subで異なるpointer処理と保存単位を一つにする。
- 変更範囲: 新規Hook/component、`App.tsx`、`SubModePanel.tsx`、component/unit test。
- 禁止事項: 見た目、snap policy、min durationの変更。
- 完了条件: pointer/mouse drag、cancel、listener cleanup、preview更新、release時1回commitを両モードが同じ実装で行う。
- テスト: drag event test、revision/commit count test、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - `useBoundaryDrag.ts`でpointer/mouseのglobal listener、preview、release時single commit、cancel/dispose、cleanupを共通化し、Cut/Sub両方へ配線した。
  - Subはfunctional state previewのみをmove中に行い、releaseでrevisionを1回更新、cancel/disposeで開始snapshotを復元する。Cutの0.1秒clampとcancel commit互換は維持した。
  - optional fallbackをレビューで削除し、Subのsingle-commit契約を必須propsとして型で強制した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 28 files / 180 tests passed。
  - `git diff --check`: exit 0。

### SCUT-006 TimelineSurface の共通化

- 目的: viewport、waveform、playhead、wheel routing、range overlayの二重実装を共通shellへ移す。
- 変更範囲: 新規`TimelineSurface.tsx`、Cut timeline、Sub timeline、CSS、テスト。
- 禁止事項: Sub lane layout、Cut selected-only下段、波形既定表示の変更。
- 完了条件: 両モードが同じsurfaceを使い、mode固有rowをslotで描画し、wheel/scrub/focusが同じ経路を通る。
- テスト: component/unit、全Vitest、typecheck、必要ならE2E重点確認。
- 完了証拠 (2026-08-05):
  - `TimelineSurface.tsx`へviewport、ScrollArea、content sizing、playhead、waveform、scrub、focus、wheel routeを集約し、Cut/Sub両timelineを移行した。
  - Cutのselected-only rowとSubのguide/grid/lane DOM・既存classはslotとして維持し、CSS変更は不要だった。
  - wheel scopeを共通shell内で明示し、Cutはsurface全体を横scroll、Subはwaveform上だけ横scroll、laneは縦scrollを維持した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 29 files / 185 tests passed。
  - `cd gui; pnpm run build`: exit 0。
  - `git diff --check`: exit 0。ブラウザE2E視覚確認はSCUT-015へ送る。

### SCUT-007 CutModePanel の抽出

- 目的: Appを共通session ownerにし、Cut/Sub workspaceの責任境界を対称にする。
- 変更範囲: 新規`CutModePanel.tsx`、`App.tsx`、関連component。
- 禁止事項: state ownershipを同時に全面変更、Cut機能削除、Sub変更。
- 完了条件: Cut toolbar/guide/timeline/listがpanelへ移り、Appはmedia/session/dialog/controller配線を担当する。
- テスト: 全Vitest、typecheck、build、Cut smoke重点確認。
- 完了証拠 (2026-08-05):
  - `CutModePanel.tsx`へtoolbar、guide、Cut timeline、segment listとCut-local表示helperを移し、SubModePanelと対称なworkspace境界を作った。
  - Appはmedia/session/project/persistence/jobs/dialog/command callbackのownerとして維持し、既存DOM class・i18n・ARIAを保持した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 29 files / 185 tests passed。
  - `cd gui; pnpm run build`: exit 0。
  - `git diff --check`: exit 0。CutブラウザsmokeはSCUT-015へ送る。

### SCUT-008 Mode controller／capability の導入

- 目的: 選択、追加、削除、隣接移動、境界再生、nudgeをmode adapterで統一する。
- 変更範囲: 新規mode controller、`App.tsx`、両panel、menu state。
- 禁止事項: domain model統合、mode固有UIの共通化強制。
- 完了条件: UI/menu/keyboardがactive controllerを利用し、散在する主要`mode ===` command分岐がなくなる。
- テスト: controller unit、menu capability、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - `modeController.ts`へ選択、追加／削除、隣接移動、境界jump／preview／nudgeとavailability snapshotを集約した。
  - Appのeditor executor、menu state、Cut/Sub transportとSub追加／削除／選択をcontrollerへ接続し、editor-action内のmode分岐を除去した。
  - 不要になったSubの旧callback propsをレビューで削除し、controller経路を必須化した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 30 files / 188 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。

### SCUT-009 Operation runner とSub operation永続化

- 目的: task registry、poll、成功／失敗、projectOperation、quit interruptionを共通化する。
- 変更範囲: 新規`useOperationRunner.ts`、App/Sub job orchestration、関連tests。backend endpointは維持する。
- 禁止事項: Cut/Sub解析pipeline統合、job REST契約変更、未定義resume実装。
- 完了条件: Cut/Sub foreground jobが共通runnerを通り、Subもrunning/clear/interruptedを文書へ記録し、失敗時task情報を保持する。
- テスト: fake job lifecycle、project persistence、全Vitest、typecheck、Python API test。
- 完了根拠（2026-08-05）:
  - `gui/src/lib/useOperationRunner.ts`にpending/start/poll/progress/success/failure、operationのrunning/clear/interrupted、foreground二重開始防止を集約した。
  - Cutのanalysis/transcription/exportとSubのlyrics-analysis/subtitle-exportを同じrunnerへ接続し、固有API・payload・結果反映は各callerのcallbackに残した。
  - transcriptionの部分失敗は成功callbackから`interrupted`と失敗segment IDを返し、既存resume契約を維持した。
  - runner単体テストで成功clear、progress反映、失敗task保持、interrupted、同一／別slotの二重開始防止、部分失敗operation保持を確認した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 31 files / 193 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。
  - Python API testはCodex同梱Pythonに`pytest`がなく実行不可（`No module named pytest`）。backend endpoint／schemaは変更していない。

### SCUT-010 Project schema のmode別不変条件整理

- 目的: schema v3 serializationを維持しながら、Cut/Sub固有fieldの混在を型とruntimeで検出する。
- 変更範囲: `project-schema.ts`、`project.ts`、project tests。
- 禁止事項: schema version bump、既存v3 sidecarの破壊的migration。
- 完了条件: internal discriminated typeまたはmode別assertが導入され、既存の正当なCut/Sub v3文書がround-tripする。
- テスト: legacy/current fixtures、store round-trip、全Vitest、typecheck。
- 完了根拠（2026-08-05）:
  - Cut/Sub operation kindとmode別document viewを型で分離し、`normalizeProjectDocument`でlegacyのmode省略Cutを非破壊のstrict viewへ変換できるようにした。
  - runtime validatorでCutへのsubtitle混入、SubへのCut analysis/segments/export candidates混入、modeとoperation kindの不一致を具体的エラーで拒否する。
  - parse/loadは入力objectを変更せず、schema version 3とmode省略Cutのround-trip互換を維持した。
  - 正当なCut/Sub atomic round-trip、legacy mode省略、Sub compose、mode別operation、mixed payload拒否をテストした。
  - リポジトリ内の実sidecar 11件を新validatorでparse成功。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 31 files / 202 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。

### SCUT-011 Mode切替時のmedia/waveform再利用

- 目的: 同じ動画のCut/Sub切替で、同一fingerprint波形を再生成しない。
- 変更範囲: progressive waveform/session cache、hydrate/switch、tests。
- 禁止事項: mutable edit documentの共有、sidecar統合、永続cache形式の無断追加。
- 完了条件: in-memory fingerprint cacheを優先し、不一致・duration差では再生成し、scratch proxy挙動を維持する。
- テスト: cache hit/miss/invalidate、mode switch integration、全Vitest、typecheck。
- 完了根拠（2026-08-05）:
  - Appインスタンス単位の`waveformSessionCache`を追加し、fingerprint、duration、generator、encoding、sample rate、channelsで完成済み波形を検証・cloneして保持する。
  - hydrate順をdocument snapshot、session cache、backend生成に固定し、新規videoとCut/Sub切替の両経路で同じpure decision helperを使用する。
  - duration／generator／encoding不一致ではcacheを無効化し、sourceがある場合だけ通常生成へfallbackする。
  - scratch proxy、waveform task registry、Cut/Subのmutable documentは共有せず既存挙動を維持した。
  - cache hit/clone、fingerprint miss、duration invalidate、metadata不一致、document優先、mode切替hit、generate fallbackを7テストで確認した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 32 files / 209 tests passed（scratch proxy tests含む）。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。

### SCUT-012 設定の保存スコープ明確化

- 目的: app共通、mode別、project別の設定を型と保存処理で区別する。
- 変更範囲: settings types、project compose/hydrate、localStorage helper、SettingsDialog tests。
- 禁止事項: 利用者設定値のリセット、schema version bump、UI項目削除。
- 完了条件: 各設定のscope表がcode/testで表現され、mode切替後の期待値が自動テストで固定される。
- テスト: preferences/project tests、全Vitest、typecheck。
- 完了根拠（2026-08-05）:
  - `settingsScopes.ts`にapp／mode／projectの型、所有matrix、既存keyを保持したtyped storage helperを追加した。
  - app共通はscratch、boundary preview、layout、locale、Cut mode設定はnudge/refinement/create-folder/amplitude、Cut/Sub別waveform、Sub mode設定はstyle presetとして分離した。
  - project-ownedはanalysis device、Whisper/alignment、filename template、subtitle stateをschema v3のままcompose/hydrateする型境界へ接続した。
  - Appのinline localStorage read/writeをtyped helperへ移し、mode切替／project hydrateで別scopeの値を上書きしないようにした。
  - SettingsDialogのcontrol/tab scope表をコード化し、DOM不要のpure testを追加した。
  - exact key互換、malformed／storage例外fallback、Cut/Sub isolation、project抽出／round-tripをテストした。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 34 files / 218 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。

### SCUT-013 Job progress dialog shell の共通化

- 目的: Cut/Subで重複するpending/running/completed/failed表示を共通部品へ移す。
- 変更範囲: 新規共通dialog、App、SubModePanel、CSS、tests。
- 禁止事項: task lifecycleや文言意味の変更。
- 完了条件: operation固有title/description/close policyをpropsで渡し、同型markupが重複しない。
- テスト: component state matrix、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - `JobProgressDialog.tsx`へqueued/running/completed/failed/cancelledの表示状態、進捗率clamp、message/error、close actionの共通shellを抽出した。
  - Subの歌詞解析／字幕export、Cut export、Whisper／Demucs／MMS model downloadの4系統を共通dialogへ移した。
  - operation固有の説明、互換性summary、転送byte表示、補足文、close label/policyはpropsとslotで保持した。
  - cancel時を含む既存の「隠す」／「閉じる」契約を維持し、状態matrix 10 testsで固定した。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 35 files / 228 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。

### SCUT-014 Sub UI ローカライズ統合

- 目的: Subの利用者向け固定日本語を既存i18n経路へ統合する。
- 変更範囲: `SubModePanel.tsx`、`i18n.ts`、renderer locale tests。
- 禁止事項: 技術識別子、効果名、仕様文言の意味変更。
- 完了条件: Subの主要toolbar/dialog/error/aria文言が英日resourceを持ち、空翻訳検査が成功する。
- テスト: i18n completeness、全Vitest、typecheck。
- 完了証拠 (2026-08-05):
  - `i18n.ts`へSubのtoolbar、dialog、job、error、style editor、effect label／parameter／optionを含む英日resourceを追加した。
  - `SubModePanel.tsx`の利用者向け固定日本語を`tr(key, args)`へ移し、JobProgressDialog props、確認文、動的effect表示も同じ経路へ統合した。
  - 英日leaf key集合の完全一致、空翻訳、主要Sub文言を`i18n.test.ts`で検証した。
  - `rg`による`SubModePanel.tsx`の固定CJK literal検査: 0件。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 35 files / 229 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - `git diff --check`: exit 0。

### SCUT-015 共通部品contract testと配布版回帰確認

- 目的: P0〜P3全体を自動テストと実アプリ経路で検証し、残る未確認事項を明示する。
- 変更範囲: component tests、E2E scriptsは必要最小限、task list証拠。
- 禁止事項: テストを通すための機能弱体化、既存E2E成功条件の削除。
- 完了条件:
  - `pnpm run typecheck`、`pnpm test`、`pnpm run build`が成功する。
  - Python `pytest`が利用可能な環境で成功する。
  - 再ビルド済み配布物でCut `E2E_OK`、Sub `SUB_E2E_OK`を確認するか、実行不能理由を記録して`実環境検証待ち`とする。
  - 最終差分と対象外の利用者変更を記録する。
- 停止条件: model/fixture/対話desktopなど外部実環境が不足する場合は、ローカル検証済みとして停止し未確認を明示する。
- 完了証拠 (2026-08-05):
  - mode controller、editor commands、boundary policy／drag、TimelineSurface、operation runner、project schema、waveform cache、settings scope、JobProgressDialog、i18nのbehavior contractを35 test files / 229 testsで棚卸しし、網羅を確認した。
  - `tests/test_cli_integration.py`の任意の未追跡fixture列挙順と固定時刻への依存を除き、parse可能metadata、生成segmentとreview HTML、実動画長内guide反映を決定的に検証するよう修正した。
  - system `python -m pytest`: 366 passed / 2 skipped、exit 0。同梱Pythonはpytest非搭載のため、既存system Python 3.12.10を利用し追加installは行っていない。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 35 files / 229 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - system Pythonの既存PyInstaller 6.21.0を明示して`packaging/build_dist.ps1`を実行し、version 1.1.57の`dist/songcut-win-x64`を再buildした。
  - 再build済み配布物でCut通常E2Eを完走し、`out/e2e-dist-smoke.log`の`E2E_OK`を確認した。
  - Sub E2E初回でローカライズ前のeffect aria selectorがstaleと判明し、成功条件を変えず`.subtitle-effect-section select`へ2箇所を修正した。再実行で実解析39行、2 lanes、confidence、PNG cache、style/effect、overlay、scratch、9象限lane、394.378秒の字幕動画とSRT／style各2本を検証し、`out/e2e-sub-mode/e2e-sub-mode.log`の`SUB_E2E_OK`を確認した。
  - E2E script 3件の`node --check`: exit 0。`git diff --check`: exit 0。
  - 既存のドキュメント、画像、`CODEX.md`等の利用者変更は変更対象外として保持し、commitは作成していない。

### SCUT-016 Editor focus policy とショートカット継続

- 目的: Cut/Sub editorの操作ボタンへfocusが残ることでWASD等のeditor shortcutが停止する問題を解消し、両モードで同じfocus契約を使う。
- 変更範囲: editor focus scope、共通UI primitive、Cut/Subのeditor action、shortcut抑止判定、focus contract tests、GUI設計文書、配布版E2E。
- 禁止事項:
  - 設定dialog等のmodal内から通常のkeyboard focusを奪わない。
  - textarea、text/number input、contenteditableをfocusなしで編集可能とみなさない。
  - IME composition中のEnter/Escapeをeditor shortcutとして扱わない。
  - Cut/Subごとに同じfocus復帰処理を複製しない。
- 完了条件:
  - editor action controlはTab移動先にならず、pointer/keyboard activation後に共通editor focus anchorへfocusを戻す。
  - text entry中とmodal表示中はeditor shortcutを抑止し、編集終了後はWASD等が再開する。
  - dialog/settings内は通常のfocus可能性を維持する。
  - 後続実装者が判断できるGUI focus policyをrepo文書とagent向け入口に残す。
- テスト: focus policy unit tests、shortcut tests、全Vitest、typecheck、build、再build済みdistでCut/Sub E2E、`git diff --check`。
- 停止条件: 対話desktop、model、fixture等が不足して配布版E2Eを実行できない場合は、ローカル検証済みとして理由と未確認範囲を記録する。
- 開始証拠 (2026-08-05):
  - ブランチ `codex/sub-mode`、HEAD `64fc0eff00cd1df6c86e4fb52e4f0ed5083c6557` から開始した。
  - 共通`Button`/`Toggle`等にfocus policyがなく、`shortcuts.ts`がfocus中のbutton/checkbox等をinteractiveとして一律抑止するため、クリック後にWASD等が停止する経路を確認した。
  - 既存の未コミット変更を利用者作業として保持し、対象ファイルの局所差分だけを追加する。
- 完了証拠 (2026-08-05):
  - `EditorFocusProvider`、normal/editor scope、共通editor anchor、native action用hookを追加し、`Button`、`Toggle`、`Checkbox`、`TabsTrigger`とCut/Sub固有のunstyled actionへ同じfocus契約を適用した。
  - 共通`Tabs`はasync `onValueChange`完了を待ってfocusを戻す。実E2EでRadixが非同期mode hydrate後に`.tabs-list`へfocusを戻す挙動を検出し、Cut/Sub個別処理を増やさず共通rootで解消した。
  - 共通`Dialog`はnormal focus scope、初期focus、終了時focus復帰を持ち、editor actionから開いた場合は閉じた後にeditor anchorへ戻す。modal表示中の遅延focus競合もguardした。
  - `Input`/`Textarea`はfocus可能なまま維持し、入力中だけshortcutを抑止する。IME compositionを尊重し、editor内では`Escape`でblurしてanchorへ戻す。waveform/wheel操作開始時も入力focusを共通timelineから終了する。
  - `shortcuts.ts`を目的ベースへ変更し、modal、text entry、明示`data-editor-shortcuts="suppress"`だけを抑止する。button、checkbox、link、action roleは一律抑止しない。
  - `docs/GUI_FOCUS_POLICY.ja.md`へ判断表、必須原則、実装方法、IME/dialog/timeline契約、禁止パターン、test checklistを記録し、`CODEX.md`と`docs/INDEX.md`から参照可能にした。
  - `cd gui; pnpm run typecheck`: exit 0。
  - `cd gui; pnpm test -- --run`: 37 files / 238 tests passed。
  - `cd gui; pnpm run build`: exit 0（chunk size warningのみ）。
  - system PythonのPyInstaller 6.21.0でversion 1.1.57の`dist/songcut-win-x64`を再buildした。
  - 最終distのCut通常E2Eで`CUT_EDITOR_ACTION_FOCUS_OK`、`EDITOR_INPUT_ESCAPE_FOCUS_OK`、text entry抑止、action継続、modal通常focus/抑止/復帰と最終`E2E_OK`を確認した。
  - 最終distのSub実データE2Eで`SUB_MODE_TAB_FOCUS_OK`、`SUB_EDITOR_ACTION_FOCUS_OK`と最終`SUB_E2E_OK`を確認した。
  - E2E script 2件の`node --check`: exit 0。`git diff --check`: exit 0。
  - 既存の広範な未コミット変更は保持し、commitは作成していない。

### SCUT-017 Cut export進捗の利用者向け表示

- 目的: Cutのexport進捗から利用者に意味のない内部IDを除き、出力対象のタイトルと進捗件数を表示する。
- 変更範囲: export request／job progress metadata、英日i18n resource、API／renderer回帰テスト、必要な配布build。
- 禁止事項:
  - export item ID、結果payload、ファイル名生成の既存契約を変更しない。
  - 内部IDを表示タイトルのfallbackとして再利用しない。
  - Cut以外のtask lifecycleや共通progress dialog shellの挙動を変更しない。
- 完了条件:
  - 英語表示が `Exporting {title} ({current}/{total})` となり、日本語でも同じ情報を自然な文言で表示する。
  - 複数の選択項目で1始まりの現在件数と選択済み総件数を構造化metadataとして返す。
  - title未送信の旧requestでも内部IDを露出せず、利用者向けのファイル名stemへfallbackする。
  - APIとrendererのテストでタイトル、件数、legacy request fallbackを固定する。
- テスト: 対象pytest、i18n Vitest、全GUI test、typecheck、build、`git diff --check`。配布buildを更新する場合はCut E2Eも実行する。
- 停止条件: 配布版E2Eに必要な対話desktopやfixtureが利用不能な場合は、ローカル検証済み範囲と未確認事項を記録する。
- 開始証拠 (2026-08-05):
  - `_export_job`が`Exporting {item.id}.`を生成し、`export-002`等の内部IDを直接表示していた。
  - GUI側のcandidateはtitleを保持する一方、APIの`ExportItem`にはtitle fieldがなく、進捗生成まで届いていなかった。
  - 新規の構造化message codeでtitle/current/totalを渡し、既存のlegacy `exportingItem` mappingは互換用に維持する方針とした。
- 完了証拠 (2026-08-05):
  - `ExportItem`へ後方互換のoptional `title`を追加し、Cutが既に送っている利用者向けタイトルをbackendまで保持するようにした。
  - `_export_job`は選択済み項目だけを母数に、`exportingItemProgress`と`title/current/total`を返す。raw fallbackも`Exporting {title} ({current}/{total})`とし、旧requestのtitle未送信時は内部IDではなく`filename_stem`を使う。
  - 英語を`Exporting {{title}} ({{current}}/{{total}})`、日本語を`{{title}} を書き出しています ({{current}}/{{total}})`として共通i18n経路へ追加し、legacy `exportingItem`は互換用に残した。
  - API testでunchecked項目を総数から除外し、1始まりの2件進捗、title、legacy fallback、内部export ID非露出を固定した。renderer testで英日表示を固定した。
  - `python -m pytest -q`: 367 passed / 2 skipped。`cd gui; pnpm test -- --run`: 37 files / 238 tests passed。
  - `cd gui; pnpm run typecheck`、`cd gui; pnpm run build`、E2E scriptの`node --check`、`git diff --check`: すべてexit 0（buildは既知のchunk warningのみ）。
  - version 1.1.57の隔離distをbuildしてCut通常E2Eを完走し、実DOM履歴で`Exporting Smoke Song Edited (1/1)`、内部ID非露出、`EXPORT_PROGRESS_TITLE_COUNT_OK`、`E2E_OK`を確認した。
  - 通常利用中の既定distは強制終了せず保護した。終了後に`dist/songcut-win-x64`を同じソースから再buildし、renderer bundleとElectron実行物がE2E済みbuildとSHA-256一致することを確認した。
  - 検証専用`dist/songcut-win-x64-scut017`は、絶対パスとプロセス不在を確認して削除した。既定distは更新済みのまま保持している。

### SCUT-018 Cut/Sub operation coordinator の責務対称化

- 目的: CutとSubで異なる場所にあるoperation orchestrationを同じ階層へ移し、Appを共通session owner、mode panelをpresentation、mode coordinatorを固有operation ownerとして対称化する。
- 開始証拠 (2026-08-05):
  - ブランチ`codex/sub-mode`、HEAD `203fdeb9227399dd233de7c8f5850f7577b0e66a`から開始した。
  - 開始時の既存変更は、再評価計画を追加した`docs/task-list.md`だけであり、production codeとの重複はない。
  - 開始前の現行GUI baselineはtypecheck成功、37 files／238 tests成功、`git diff --check`成功である。
- 現状証拠:
  - Cutの`analysis`、`transcription`、`export`は`App.tsx`内で`operationRunner.run`を呼ぶ。
  - Subの`lyrics-analysis`、`subtitle-export`は`SubModePanel.tsx`内で`operationRunner.run`を呼ぶ。
  - 共通`useOperationRunner`は既にtask登録、排他、running／interrupted、成功／失敗を提供しているため、runner自体の再実装は不要である。
- 変更範囲: 新規`useCutOperations.ts`、`useSubOperations.ts`または同等のmode別coordinator、`App.tsx`、`CutModePanel.tsx`、`SubModePanel.tsx`、operation contract tests。
- 設計:
  - 両coordinatorは共通の`OperationRunner`、API base URL、source、task view、message／state adapterを受け取る。
  - Cut coordinatorは解析、segment転写、clip exportを所有する。
  - Sub coordinatorは歌詞解析、字幕export、字幕render cache jobを所有する。
  - panelへは`actions`、`jobs`、`busy`、operation固有の表示用stateだけを渡す。
  - mode固有resultの反映は各coordinatorに残し、共通runnerへdomain stateを持ち込まない。
- 禁止事項:
  - Cut/Sub operationを単一の巨大な`switch(mode)`へ統合しない。
  - REST endpoint、request／result payload、resume仕様を変更しない。
  - Cut解析／転写／exportをSub panelへ移したり、Sub解析／exportをCut panelへ移したりしない。
  - model downloadやwaveform等のapp共通taskをmode coordinatorへ重複実装しない。
- 完了条件:
  - `App.tsx`が`startAnalysis`、`startTranscription`、`startExport`を直接呼ばない。
  - `SubModePanel.tsx`が`startLyricsAnalysis`、`startSubtitleExport`、`startSubtitleRender`、`operationRunner.run`を直接呼ばない。
  - Cut/Subのforeground operationが同じ共通runnerとtask registryを通る。
  - running、成功、失敗、interrupted、duplicate-start防止、progress dialogの既存挙動が維持される。
  - panel propsから生の`OperationRunner`を除去し、action／view contractへ置換する。
- テスト: coordinator pure contract、runner integration、operation kind／interrupted永続化、全Vitest、typecheck、build、Cut/Sub E2E。
- 停止条件: operationのresume可否や成功後document状態について新しい製品判断が必要になった場合は、現行契約を維持したまま責務移動だけを行う。
- 完了証拠 (2026-08-05):
  - `useCutOperations.ts`がCut解析、手動／background転写、clip exportを所有し、`useSubOperations.ts`が歌詞解析、字幕export、字幕render job、歌詞配置、render cache結果適用を所有する。
  - `App.tsx`は両coordinatorを同じcomposition層で生成し、state／task adapterを渡す。`SubModePanel.tsx`から生の`OperationRunner`、API base URL、source path、operation API呼出しを除去した。
  - `App.tsx`／`CutModePanel.tsx`／`SubModePanel.tsx`に対象の`startAnalysis`、`startTranscription`、`startExport`、`startLyricsAnalysis`、`startSubtitleExport`、`startSubtitleRender`、`operationRunner.run`が残っていないことを`rg`で確認した。
  - `luna_worker`による独立レビューを2回実施し、stale subtitle render taskのclear、最新Sub stateへの解析結果適用、background転写監視のApp外移動、監視中の手動転写排他、未完了監視cleanupを追加した。
  - coordinator contract 6件を追加し、既存runner contractを含む全Vitestは39 files／244 tests成功、`npm run typecheck`成功、`npm run build`成功、`git diff --check`成功である。
  - ポータブル版1.1.58を生成し、Cut通常E2Eは`E2E_OK`（解析、background転写、progress dialog、clip／TS export）、Sub実データE2Eは`SUB_E2E_OK`（39字幕、PNG cache、style invalidation、SRT／style sidecar、字幕焼き込み動画）まで成功した。

### SCUT-019 BoundaryPolicyの実配線と時間編集policy整理

- 開始証拠 (2026-08-05):
  - SCUT-018完了後、同一branch `codex/sub-mode`で順次開始した。SCUT-018の未commit変更は完了証拠付きの前提差分として保持する。
  - 開始時baselineは全Vitest 39 files／244 tests、typecheck、production build、Cut通常E2E、Sub実データE2E成功である。
- 目的: 共通`BoundaryPolicy`をテスト専用の抽象にせず、Cut/Sub双方のdrag、nudge、時間dialogから利用する。ただし操作別の意図的差分は維持する。
- 現状証拠:
  - Subは`resolveBoundaryTime`／`nudgeBoundaryTime`をproductionで使用している。
  - Cutはdragとnudgeで個別`clamp`を使用し、`CUT_BOUNDARY_POLICY`はproductionから参照されていない。
  - `SegmentTimingDialog`は共通UIだが、内部にmode分岐と独自validationを持つ。
- 変更範囲: `boundaries.ts`、`SegmentTimingDialog.tsx`、Cut/Sub境界adapter、関連unit/component tests。
- 設計:
  - `drag`、`nudge`、`dialog`の操作意図をpolicy生成時に明示する。
  - Cut drag／nudgeは最小0.1秒、Cut時間dialogは最小0.001秒を維持する。
  - Subはrhythm snap、前後segment非重複、strict boundaryを維持する。
  - pointer lifecycleとcancel semanticsは既存`useBoundaryDrag`に残す。
- 禁止事項: Cutの0.1秒／0.001秒差の統一、Subの拍snap解除、lane制約変更、Cut pointercancel時commitとSub rollbackの統一。
- 完了条件: すべての境界変更入口が共通resolverへ到達し、各操作の意図的差分がpolicy contract testで判別できる。
- テスト: drag、nudge、dialog arrow、直接入力、neighbor edge、cancel、commit count、全Vitest、typecheck、build。
- 停止条件: 既存E2Eと現在の数値契約が矛盾する場合は、挙動を変更せず差異を証拠化して判断を求める。
- 完了証拠 (2026-08-05):
  - Cut dragは`resolveBoundaryTime`とdrag policy、Cut nudgeは`nudgeBoundaryTime`とnudge policy、Cut/Sub時間dialogは`resolveBoundaryRange`へ到達する。Sub drag／nudgeも既存の共通resolver経路を維持した。
  - Cut drag／nudgeの最小0.1秒と時間dialogの最小0.001秒を別policyとして固定した。Subは同じrhythm／strict policyを3入口で用い、操作差はresolve／nudge APIで表現する。
  - Sub時間dialogの直接入力もgridへsnapし、実在する前後segmentだけをstrict neighborとして渡すことで先頭0秒と末尾media durationを許容した。
  - pointer lifecycleは変更せず、Cutのpointercancel時commitとSubのcancel時rollback／release時1回commitを既存hook testsで確認した。
  - manual作成、解析結果、project hydrateによる境界生成は利用者の境界編集入口ではないためresolver対象外とし、mode固有creation／ingest契約として維持した。
  - `luna_worker`による独立監査で全production配線と意図的差分を確認した。対象testは5 files／41 tests、全Vitestは40 files／251 tests成功、`npm run typecheck`、`npm run build`、`git diff --check`も成功した。

### SCUT-020 mode別project adapterによるcompose／hydrate分離

- 開始証拠 (2026-08-05):
  - SCUT-019完了後、同一branch `codex/sub-mode`で順次開始した。SCUT-018／019の未commit変更は完了証拠付きの前提差分として保持する。
  - 開始時baselineは全Vitest 40 files／251 tests、typecheck、production build成功である。
- 目的: schema v3の共通envelopeを維持しながら、Cut/Sub固有stateのcompose／hydrateをmode別adapterへ分け、混在不能を呼出側の型でも保証する。
- 現状証拠: `composeProjectDocument`はCutのanalysis、segments、export candidatesを必須入力とし、Sub stateをoptional fieldで受け取るCut中心の形になっている。
- 変更範囲: `project.ts`、mode別project adapter、`App.tsx`のcreate／hydrate／compose配線、project tests。
- 禁止事項: schema version変更、保存JSONの不要な変更、`.songcut`／`.sub.songcut`統合、mutable document共有。
- 完了条件:
  - Cut adapterがCut fieldsとCut operationだけを受け取る。
  - Sub adapterがsubtitle stateとSub operationだけを受け取り、Cut fieldsを入力に要求しない。
  - 共通source、settings、waveform、view state、revision処理は一つのbase serializerを使う。
  - legacy mode省略Cutと既存v3 sidecarがbyte互換方針を保ってround-tripする。
- テスト: mode別compose／hydrate、mixed inputの型・runtime拒否、実sidecar parse、全Vitest、typecheck、build。
- 停止条件: schema bumpまたは既存sidecar migrationが必要になった場合は実装を止め、非破壊adapter案へ戻す。
- 完了証拠 (2026-08-05):
  - `projectBase.ts`へschema v3の共通create／serialize／hydrateを集約し、source、settings、waveform、view state、revisionをCut/Subで一つの実装から処理する。
  - `projectAdapters.ts`へCut/Sub専用create／compose／hydrateとoperation type guard／assertを分離した。Sub compose inputはsubtitleとSub operationだけをmode payloadとして受け、Cut analysis／segments／export candidatesを要求しない。
  - Appのcompose、hydrate、新規sidecar作成をmode別adapterへ配線し、Sub hydrate時はCut stateを空へ、Cut hydrate時はsubtitle stateを既定値へ戻してmode間残留を防止した。
  - legacy Cutの`mode`省略と`settings.export`省略を保持し、既存`createProjectDocument`／`composeProjectDocument`は互換wrapperとして残した。schema version、`.songcut`／`.sub.songcut`形式は変更していない。
  - 型contractとruntime検査の両方でmixed mode base、mode外operation、Sub inputへのCut field混入を拒否し、hydrate結果は永続documentとmutable値を共有しない。
  - `luna_worker`がserializer／adapter／testsを実装し、Main側でApp配線を統合・再検証した。全Vitest 41 files／256 tests、`npm run typecheck`、`npm run build`、`git diff --check`が成功した。
  - 既存E2E生成物のCut sidecarとSub sidecarをbuild済みschemaでparseし、Cut mode文書と3-lane Sub mode文書がともにschema v3として読めることを確認した。

### SCUT-021 App composition root の縮小

- 開始証拠 (2026-08-05):
  - SCUT-020完了後、同一branch `codex/sub-mode`で順次開始した。SCUT-018～020の未commit変更は完了証拠付きの前提差分として保持する。
  - 開始時baselineは全Vitest 41 files／256 tests、typecheck、production build、既存Cut/Sub実sidecar parse成功である。
- 目的: SCUT-018／020で得た境界を使い、`App.tsx`を共通media/session/persistence、active mode選択、画面配線へ集中させる。
- 変更範囲: `App.tsx`、mode session/controller hooks、panel props、App内のCut固有dialog helper配置。
- 禁止事項: state管理ライブラリ導入、全stateの一括移行、UI／DOM class変更、無関係なhelper整理。
- 完了条件:
  - Appがmode固有API orchestrationとmode固有project変換を持たない。
  - Cut/Sub controller生成とoperation actionが対称なmode session境界から得られる。
  - panelへ渡す共通media／transport propsが型付きview modelとしてまとまる。
  - Appに残すmode分岐はactive panel、subtitle overlay、mode capabilityなどcomposition上必要なものに限定される。
- テスト: App配線contract、menu／shortcut、mode switch、autosave、waveform cache、全Vitest、typecheck、build、Cut/Sub E2E。
- 停止条件: 画面構造や利用者操作を変えないと抽出できない箇所は、無理に共通化せずmode session側のadapterとして残す。
- 完了証拠 (2026-08-05):
  - `modeSession.ts`がCut/Subのcontroller、mode固有operation coordinator、共通panel viewを同じcontractで返し、Appは`createModeController`を直接生成しない。
  - `modeViewModel.ts`の`ModeMediaViewModel`／`ModeTransportViewModel`へsource、waveform、playback、zoom、boundary controlを集約し、Cut/Sub panelへどちらも`view`一つで渡す。
  - AppのCut/Sub operation actionは各mode sessionの`operations`経由となり、active controllerだけをmode capabilityとして選択する。生operation API、`operationRunner.run`、generic project compose／createはAppに残っていない。
  - Cut専用時間dialog変換を`CutSegmentTimingDialog.tsx`へ、出力・segment管理・task status・model／export進捗等のview-only componentを`AppDialogs.tsx`へ移した。DOM classと表示契約は維持した。
  - App配線source contract 3件を追加し、menu／shortcut、autosave、waveform cache、mode controller／session testsを含む全Vitest 44 files／262 tests、`npm run typecheck`、`npm run build`、`git diff --check`が成功した。
  - Appは開始時約3,950行から3,225行へ縮小した。stateful media／persistence処理、active panel、Sub overlay、mode capability等のcomposition責務はAppに残した。
  - 2つの`luna_worker`がmode session/view modelとview-only dialog抽出を分担し、Main側でpanel/App配線を統合した。
  - ポータブル版1.1.58を再buildし、Cut通常E2Eは`E2E_OK`（menu、shortcut、autosave、background転写、0.001秒Cut dialog、clip／TS export）、Sub実データE2Eは`SUB_E2E_OK`（39字幕、rhythm、PNG cache、overlay、SRT／style、焼き込み動画）まで成功した。

### SCUT-022 Whisper execution session の共通化

- 開始証拠 (2026-08-05):
  - SCUT-021完了後、同一branch `codex/sub-mode`で順次開始した。SCUT-018～021の未commit変更は完了証拠付きの前提差分として保持する。
  - 開始時baselineは全Vitest 44 files／262 tests、typecheck、production／portable build、Cut `E2E_OK`、Sub `SUB_E2E_OK`成功である。
- 目的: Cut転写、Sub標準align、Uta-Alignに分散したWhisper model読込、runtime選択、CPU fallback、generate、chunk正規化を共通sessionへ集約する。
- 変更範囲: `transcription.py`、`lyrics_alignment.py`、`uta_alignment.py`、新規Whisper execution module、関連pytest。
- 禁止事項: alignment algorithm統合、chunk利用方法の統一、model選択仕様変更、strict device指定時の暗黙fallback追加。
- 完了条件:
  - 3経路が同じpipeline factoryとdevice fallback契約を使う。
  - Cutはsegment単位、Subはactive interval単位、Utaはrequest単位という入力分割を維持する。
  - timestampの絶対化とdomain result生成は各callerに残す。
- テスト: pipeline fakeによるdevice選択、auto CPU fallback、strict failure、language token、chunk timestamp、既存transcription／alignment pytest。
- 停止条件: Uta-Align backendのpipeline lifetimeが共通sessionと互換でない場合は、factoryとfallbackだけを共有し、request APIは固有に残す。
- 完了証拠 (2026-08-05):
  - 新規`whisper_execution.py`へOpenVINO pipeline factory、constructor／generateのauto時CPU fallback、strict device時のfallback禁止、language token付与、相対chunk／word timestamp正規化を集約した。
  - Cutはsegment、Sub標準alignはactive interval、Uta-Alignはrequest内active intervalという入力分割を維持し、media絶対offset、丸め、domain result生成は各callerに残した。
  - pipeline fakeでdevice選択、constructor／generate fallback、strict failure、language token、chunk sentinel、word属性を固定した。Main側の全`pytest -q`は374 passed／2 skipped／36 subtests passed、`compileall`と`git diff --check`も成功した。

### SCUT-023 FFmpeg process runner の共通化

- 開始証拠 (2026-08-05):
  - SCUT-022完了後、同一branch `codex/sub-mode`で順次開始した。SCUT-018～022の未commit変更は完了証拠付きの前提差分として保持する。
  - 開始時baselineは全Python pytest 374件成功／2件skip／36 subtests成功、GUI Vitest 44 files／262 tests、typecheck、production／portable build、Cut `E2E_OK`、Sub `SUB_E2E_OK`成功である。
- 目的: Cut smart exportとSub subtitle exportに分散したprocess起動、stderr保持、return code、progress解析を共通primitiveへ移す。
- 変更範囲: `ffmpeg_tools.py`または新規process module、`smart_export.py`、`subtitle_export.py`、関連pytest。
- 禁止事項: smart render計画とsubtitle filter commandの統合、encoder設定変更、出力形式変更。
- 完了条件:
  - 共通runnerがWindows no-window、stdout／stderr、tail、終了判定、任意progress callbackを扱う。
  - Cut/Subはcommand生成と進捗配分だけを固有に保持する。
  - failure messageに既存以上の診断情報が残る。
- テスト: fake process、非0終了、progress protocol、UTF-8 replacement、出力検証、既存smart export／subtitle export pytest。
- 停止条件: smart exportの同期実行契約とsubtitle exportのstreaming契約を同じAPIへ押し込む必要がある場合は、共通low-level primitiveを二つのwrapperから使う形に限定する。
- 完了証拠 (2026-08-05):
  - 新規`ffmpeg_process.py`へ同期／streaming runnerを分けて追加し、Windows no-window、UTF-8 replacement、stdout／stderr、bounded tail、return code、任意line callbackを共通化した。
  - smart exportは同期runner、subtitle burnはstreaming runner、字幕PNG生成とASS filter probeは同期runnerへ配線した。command生成、Subのprogress protocol／0.15～0.96配分、Cut/Sub固有の出力検証は各callerに維持した。
  - fake process、非0終了、UTF-8 replacement、tail、progress配線、smart no-video、Sub出力存在／size／durationのテストを追加した。対象pytestは35 passed、全pytestは382 passed／2 skipped／36 subtests passed、`compileall`と`git diff --check`も成功した。

### SCUT-024 P4/P5 contract testと配布版回帰確認

- 開始証拠 (2026-08-05):
  - SCUT-023完了後、同一branch `codex/sub-mode`で順次開始した。SCUT-018～023の未commit変更は完了証拠付きの前提差分として保持する。
  - 開始時baselineは全Python pytest 382件成功／2件skip／36 subtests成功、GUI Vitest 44 files／262 tests、typecheck、production／portable build、Cut `E2E_OK`、Sub `SUB_E2E_OK`成功である。
- 目的: 追加共通化後の責務境界と意図的差分を自動テスト・実アプリで固定し、文書の完了状態を実配線と一致させる。
- 変更範囲: contract tests、E2E scriptsの必要最小限、task list証拠。
- 禁止事項: 既存E2E成功条件削除、テスト都合の仕様弱体化、Cut/Sub固有pipelineの統合。
- 完了条件:
  - App／panelが禁止された生API・runner importを持たないことをcontract検査できる。
  - Cut 0.1秒drag／0.001秒dialog、Sub rhythm／non-overlap、mode別sidecar、全operation lifecycleが成功する。
  - typecheck、全Vitest、pytest、build、再build済みCut/Sub E2E、`git diff --check`が成功する。
  - 実行不能な実環境検証がある場合は`実環境検証待ち`として理由と範囲を記録する。
- 停止条件: model、fixture、対話desktop不足時はローカル検証済みまで進め、実環境成功を推測しない。
- 完了証拠 (2026-08-05):
  - Appから生runner／mode coordinator hookを除去し、新規`useModeOperations`が共通runnerを一度生成してCut/Sub coordinatorへ注入するcomposition境界へ移した。両panelは共通`ModePanelViewModel`とmode coordinatorだけを受け取る。
  - GUI横断contractでApp／panelの禁止依存、共通runner注入、mode別sidecar、5種の永続operation lifecycle、`subtitle-render`の非永続task lifecycleを固定した。既存boundary／dialog testでCut 0.1秒drag・0.001秒dialogとSub rhythm／non-overlapも維持した。Python横断contractでWhisper 3 callerの共通sessionとcaller固有offset、Cut/Sub FFmpeg共通runnerと固有progress／validationを固定した。
  - 最終検証はGUI Vitest 45 files／271 tests、typecheck、Python pytest 385 passed／2 skipped／36 subtests passed、production build、`git diff --check`が成功した。
  - portable版1.1.58を再buildした。Cut通常E2Eは343.6秒で`E2E_OK`（menu、shortcut、autosave、0.001秒dialog、background転写chunk、clip／TS export）、Sub実データE2Eは603.8秒で`SUB_E2E_OK`（39字幕、rhythm／non-overlap、PNG cache、overlay、2 laneのSRT／style、394.378秒の字幕動画）まで成功した。

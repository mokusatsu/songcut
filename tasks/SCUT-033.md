# SCUT-033 Subセグメント個別Style／Effect設定

## 目的

Subモードの一部セグメントだけ文字サイズ、配置、色、Effectなどを変更できるようにし、レーン既定設定を継承する通常の編集と共存させる。個別設定をプレビュー、project保存、動画出力、ASSサイドカーへ一貫して反映する。

## 変更範囲

- SubセグメントのStyle／Effect override型、正規化、実効値解決
- schema v3 projectの検証、保存、再読込
- Subセグメント編集ダイアログのTiming／Styleタブとdraft確定
- 字幕静止プレビュー、API payload、ASS生成、動画出力、ASSサイドカー
- 日英i18n、利用者文書、unit／integration／E2Eテスト
- `tasks/task-list.md`の状態と実施証跡

## 禁止事項

- project schema versionを変更しない。
- 旧project用migrationや別の互換レイヤーを追加しない。override未指定を継承として扱う。
- Cutのタイミングダイアログの外観・挙動を変更しない。
- レーンStyle編集とセグメントStyle編集に同じUIや正規化処理を重複実装しない。
- 無関係なリファクタリング、commit、push、PR作成を行わない。

## 完了条件

- [x] SubセグメントのダブルクリックでTiming／Styleタブを持つmodalが開き、Cut側は従来どおりである。
- [x] Subのmodalタイトルが「セグメント設定」となり、Styleタブの縦スクロールに共通shadcn ScrollAreaを使用する。
- [x] 独自Style／Effectを持つ歌詞ラベルは左端のギザギザ線で継承セグメントと識別できる。
- [x] 継承／独自を選択でき、独自の初期値、draft保持、適用、キャンセルが仕様どおり動く。
- [x] 個別Styleが静止プレビューと描画キャッシュへ反映され、レーン変更は継承セグメントだけを更新する。
- [x] 個別Style／Effectがschema v3 projectで保存・再読込され、旧projectは継承状態で開く。
- [x] 個別Style／Effectが焼き込み動画と完全なASSサイドカーへ反映され、既存SRT／styleも維持される。
- [x] 日英UIと利用者文書が新しい操作を説明する。
- [x] 必須の自動テストと配布版Sub E2Eが成功し、証跡が記録される。

## テスト方法

- GUI unit/component: resolver、正規化、dialog draft、schema／adapter、API mapping、cache invalidation
- Python unit/API: request fallback、行別ASS Style／Effect、ASSサイドカー、既存SRT／style
- `pnpm test`、`pnpm run typecheck`、`pnpm run build`
- `python -m pytest`
- 配布版再build後の`node packaging\e2e_sub_mode.js`

## 停止条件

- schema v3のまま安全に保存できないことが判明した場合。
- 既存projectの読み込みに破壊的migrationが必要になった場合。
- 対象ファイルに未確認の既存変更が現れ、変更範囲が競合した場合。
- 実データE2Eに必要なモデル、FFmpeg、テストデータがなく、代替検証でも完了条件を確認できない場合。

## 実施証跡

- 開始: 2026-08-07、branch `main`、HEAD `4849785976caf1d1cd268bb6f37d0c073a24ee59`、作業ツリーclean。
- 互換性判断: ユーザー承認によりschema v3を維持し、任意override未指定を継承として扱う。
- 実装: schema v3の任意override、共通実効値resolver、Timing／Style draft dialog、shadcn ScrollArea、独自Styleのギザギザ表示、preview/cache/API/ASS/export連携、日英文書を追加。
- GUI unit: `pnpm test -- --run` = 48 files / 295 tests passed（共有作業ツリーの並行追加9 testsを含む）。
- GUI typecheck/build: `pnpm run typecheck`成功。`packaging/build_dist.ps1`内のtypecheck＋Vite production build＋PyInstaller portable build成功、portable version `1.1.65`。
- Python: `python -m pytest -q` = 387 passed, 2 skipped。対象API／字幕出力test = 45 passed。
- 配布版Sub E2E: `node packaging/e2e_sub_mode.js`成功。39セグメント／2レーンの実データで個別52px＋Glow、対象だけのcache更新、shadcn ScrollArea、ギザギザ表示、project保存、overlay、焼き込み動画、ASS sidecar、既存SRT／`.style`を確認。
- E2E出力: `out/e2e-sub-mode/export/02_「星の消えた夜に」 - Aimer-subtitled.mp4`、`02_「星の消えた夜に」 - Aimer-subtitles.ass`。ログは `out/e2e-sub-mode/e2e-sub-mode.log`。
- 最終状態: 2026-08-08、branch `main`、HEAD `4849785976caf1d1cd268bb6f37d0c073a24ee59`（commit未実施）。

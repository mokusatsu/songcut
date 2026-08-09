# SCUT-036 ASS_Lyric_Effects v3統合

## 目的

現行の内蔵`ass-effects23`を`ASS_Lyric_Effects` v3へ置き換え、97効果と公開parameter catalogをSubモードのレーン／セグメント設定、project保存、静止プレビュー、ASSサイドカー、動画焼き込みへ一貫して反映する。songcut側で効果一覧やparameter制約を複製せず、実フォント計測を使って単一行・複数行を正しく配置する。

## 変更範囲

- `ass-lyric-effects` v3のruntime／GUI依存、固定version、portable配布への同梱
- Python側の公開catalog取得、effect validation、ASS生成、event budget事前確認
- 使用フォントの実ファイル解決、HarfBuzz/libass REAL_DIM基準のgrapheme幅、複数行layout context生成
- GUIの23効果手書き定義を97効果の公開catalog由来へ変更し、number／choice／color／paletteを編集可能にする
- レーン／セグメントEffectの正規化、project schema v3保存、API payload、静止プレビュー、ASS sidecar、動画焼き込み
- `songcut/ass_effects23/`、`third_party/ass-effects23/`、旧専用CLI／テスト／ignore／package設定の削除
- Python、GUI、packaged build、Cut/Sub E2E、文書、コードマップ、タスク証跡
- ASS_Lyric_Effects側タスク`019fe4c5-2e23-70f3-a6f2-6694874a195a`との固定commit・API契約・障害修正の相互確認

## 禁止事項

- 旧`ass-effects23`のcompatibility alias、fallback、migrationを追加しない。
- 旧23効果の手書きschemaや、新97効果の別schemaをsongcut側へ複製しない。
- Unicodeコードポイント、固定文字幅、East Asian Width推定をEffect文字配置へ使用しない。
- `glyph_widths`、行別box、実フォントfaceを不足情報から黙って推定しない。
- Karaokeへ`\k`、`\K`、`\kf`、`\ko`を戻さない。v3のclip sweepを新仕様とする。
- project schema versionを変更せず、旧名を保存したproject向けmigrationも追加しない。
- Cut/Sub別にcatalog取得、Effect正規化、parameter editorを重複実装しない。
- ASS_Lyric_Effectsの未固定な作業ツリーを本番依存として配布しない。
- 無関係な変更、commit、push、PR作成を行わない。

## 完了条件

- [ ] `ass-lyric-effects==3.0.0`の固定配布物または固定commitから構築した同一wheelを開発環境とportable buildが利用し、旧packageコード・設定・配布物が残らない。
- [ ] Python公開APIから取得した97個のstable `effect_id`と全parameter schemaを、JSON API経由でGUIが表示・編集できる。
- [ ] number／integer／choice／color／paletteの既定値、範囲、step、選択肢、日英label／descriptionが公開catalogと一致し、別Effectの古いparameterを保存・送信しない。
- [ ] レーン／セグメントEffectが既存schema v3 projectへ保存・再読込され、97個の文字列IDをそのまま保持する。
- [ ] 使用中フォントの実ファイルとfaceを解決し、UAX #29とHarfBuzz/libass REAL_DIMで得た行別glyph幅と座標を`EffectContext`へ渡す。East Asian Width推定は削除される。
- [ ] 単一行と複数行で全97既定効果を9 alignment、四辺近傍、狭いboxに対して生成でき、strict tag、未知parameter、event budget超過を利用者向けに明示する。
- [ ] ASS sidecarと焼き込み動画で選択したEffectが反映され、Karaokeはv3 clip sweepとして出力される。
- [ ] `estimate_event_count()`を使う事前警告または拒否境界があり、既定上限をsongcut側の根拠なしに強制しない。
- [ ] Python／GUI unit・integration、typecheck、production build、portable package smoke、Cut/Sub E2Eが成功し、証跡を記録する。
- [ ] ASS_Lyric_Effectsの固定commit、wheel SHA-256、songcut開始／終了HEAD、差分、未実施事項を実施証跡へ記録する。

## テスト方法

- `python -m pytest -q`
- ASS_Lyric_Effects catalog contract、97 stable ID、schema JSON、全default／choice、未知parameter、event budget
- 97 effects × 単一行／2・3行 × 9 alignment、四辺・狭小box、Unicode拡張書記素、zero-width grapheme
- GUI `pnpm test -- --run`、`pnpm run typecheck`、`pnpm run build`
- project保存・再読込、lane／segment override、API payload、静止preview、ASS sidecar
- `packaging/build_dist.ps1`と隔離portable import／catalog／ASS生成smoke
- `node packaging/e2e_cut_mode.js`、`node packaging/e2e_sub_mode.js`
- 旧名・固定幅・East Asian Width・重複effect schemaの静的検索

## 停止条件

- ASS_Lyric_Effects v3のstable ID、catalog schema、multiline contextがsongcut要件と両立しない場合。
- 使用フォントの実ファイル／faceをsongcutの実行環境で一意に解決できず、正しいglyph幅を渡せない場合。
- schema v3のまま97効果の文字列IDまたはpalette値を安全に保存できない場合。
- portable buildへ`regex`／`uharfbuzz`／v3 packageを再現可能に同梱できない場合。
- 対象ファイルに識別不能な並行変更が現れ、変更範囲が競合した場合。

## 実施証跡

- 開始: 2026-08-09、branch `codex/SCUT-036-ass-lyric-effects-integration`、HEAD `459ca5eb7ac3651319fb6ed2d72cb049675fc137`。
- 開始時既存差分: SCUT-035調査による`tasks/task-list.md`変更と未追跡`tasks/SCUT-035.md`。内容を保持してSCUT-036へ継続。
- 依存先: `C:/dev/ASS_Lyric_Effects40`の`MERGE23-003`は実装中。Codex task `019fe4c5-2e23-70f3-a6f2-6694874a195a`へ固定commit、公開signature、wheel、multiline contractを照会済み。
- 上流回答: push済み`3927a8abe9ab3fad84aeb227745a373f6bb72510`は分類propertyとgeometry修正の固定点だが旧import名のためv3依存には使用しない。integration-ready SHA通知を待つ。
- 確定予定API: `ass_lyric_effects`、`__version__ == "3.0.0"`、package rootから`get_effect_catalog()`、`estimate_event_count()`、`EventBudgetExceededError`を公開する。
- 検証用wheel予定: `C:/dev/ASS_Lyric_Effects40/source/ass_lyric_effects-3.0.0-py3-none-any.whl`。Release／PyPI固定前はlocal wheelを隔離installし、絶対file URLを`pyproject.toml`へcommitしない。
- multiline予定契約: `VisualLineLayout(anchor_x, anchor_y, text_box, glyph_widths)`を`EffectContext.line_layouts`へ上から順に渡す。18文字配置効果は行別layout＋共有timeline、Typewriter／Scramble Resolveは全行textを上段からsequential、native効果はblock contextを使う。不足・不一致の黙った推定は行わない。

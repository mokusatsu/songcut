# SCUT-035 ASS_Lyric_Effects置換調査

## 目的

現行の`ass-effects23`を`ASS_Lyric_Effects`へ置き換える前に、外部パッケージの契約とsongcutの既存契約を照合し、統合障害、必要変更、互換性判断、検証方法を根拠付きで確定する。

## 変更範囲

- `ASS_Lyric_Effects`公式サイト、公式リポジトリ、配布物、ライセンスの調査
- songcutの字幕エフェクトAPI、GUI、保存スキーマ、プレビュー、ASS生成、動画書き出し、配布工程、テストの影響分析
- songcut統合を簡潔かつ堅牢にするために`ASS_Lyric_Effects`側で必要または望ましい変更の特定
- 実装前に必要なユーザー判断と段階的な導入計画の整理
- 調査記録とタスクリストの更新

## 禁止事項

- このタスク内で製品コード、保存スキーマ、依存関係、配布物を変更しない。
- 後方互換レイヤー、フォールバック、移行処理の必要性をユーザー確認なしに決めない。
- 外部仕様に記載のない動作を推測で補完しない。
- 無関係な既存問題を修正しない。

## 完了条件

- [x] 外部パッケージの配布形態、runtime、API、入出力、エフェクトmetadata、依存関係、ライセンスを公式根拠で確認する。
- [x] 現行`ass-effects23`の全呼び出し元と永続化・GUI・配布・テスト契約を特定する。
- [x] 直接置換できる契約、変換が必要な契約、未確認または障害となる契約を分類する。
- [x] songcut側の変更候補を実装順、対象ファイル、検証方法、互換性判断点とともに提示する。
- [x] `ASS_Lyric_Effects`側の変更候補を必須度、理由、推奨API契約とともに提示する。
- [x] 製品コードを変更していないことをGit差分で確認する。

## テスト方法

- 公式GitHub Pages、GitHubリポジトリ、同梱README・manifest・wheel metadataの相互確認
- `rg`による参照箇所の列挙と、API／GUI／export／packaging／testsのコードレビュー
- 必要に応じて隔離した一時ディレクトリでwheel内容と最小API呼び出しを読み取り検証する
- `git diff --check`と`git status --short`で調査記録以外の変更がないことを確認する

## 停止条件

- ライセンスまたは再配布条件が不明で、同梱可否を判断できない場合。
- 既存プロジェクト保存データとの後方互換性または破壊的移行の要否をユーザー判断なしに確定する必要がある場合。
- 公開配布物と公式ドキュメントの契約が矛盾し、採用対象versionを確定できない場合。

## 実施証跡

- 開始: 2026-08-09、branch `main`、HEAD `459ca5eb7ac3651319fb6ed2d72cb049675fc137`、開始時worktree clean。
- 公式配布物: v2.0.0 wheel SHA-256 `847898852e343e52fd630924ec0b50b6ed8ad5261aaa542a038854c8d7193832`、source ZIP SHA-256 `82a229390df1b84e5413cf2a1a236d525f1d4f94a5895183554e1c1ad3742ff5`をPACKAGE_INVENTORYと照合一致。
- runtime: Python 3.10以上、`regex>=2024.0`、`uharfbuzz>=0.38`。一時領域へwheelと依存を導入し、同梱公式テスト62件すべて成功。
- API: `decorate_dialogue()`は現行と同じASS Dialogue 1行から`list[str]`を返す形。97演出中79演出が`EffectContext`必須。
- 互換比較: 現行23演出と上流`old23`を同一入力で比較し、22演出はバイト一致。`karaoke`だけ現行の`\\kf`方式から上流の時間駆動clip sweepへ変化。
- 配置走査: songcut既定1920x1080、font size 48、margin 54、alignment 1～9で全97演出を実行。下配置1～3で`mirror_reflection`、`water_reflection`、`lava_flow`が`Rect requires x1 < x2 and y1 < y2`、中央・上配置では全97件成功。
- 複数行走査: 20演出が仕様どおりone visual line制約で失敗。下配置では上記3件も加わり計23件失敗。
- 出力量: 5秒、8書記素、中央配置、全97既定値で29,604 Dialogue行、約10.5MB。単一演出の最大は`afterimage_wave` 1,200行、`waterfall` 1,049行、`snowfall_depth` 827行／約632KB。生成Layerは0～15で、songcutのレーン間隔1000とは衝突しない。
- metadata: 97演出、357 default parameter、79 categorical parameter。公開`EffectSpec`は名称、説明、category、default、categorical、context要否のみで、数値型・min/max/step、色・palette型、複数行可否、出力コストを持たない。`palette`既定値2件はtupleで、songcutの現行scalar params schemaでは保存不能。
- 配布状態: GitHub Releases／Tagsなし、PyPIなし、指定GitHub Pagesは未公開。repository直下のwheel/source ZIP取得のみ。package/import/CLI名は97演出でも`effects40`のまま。
- ライセンス: MITだが、package metadata、LICENSE、vendored source通知が`OpenAI`名義。実作者・権利者の表示へ修正要否を確認する必要がある。
- 最終差分: 製品コード、依存関係、テスト、配布物は未変更。`tasks/task-list.md`と本briefのみ変更。

## 調査結果

### 概要

`ASS_Lyric_Effects` v2.0.0は現行23演出を内包する上位集合で、Python APIの基本形も近いため採用可能。ただし現版をそのまま置換すると、songcut既定の下配置で3演出が書き出しを停止し、GUIは97演出・357 parameterを安全に構成できず、任意フォントの実測幅も渡せない。上流のP0修正後にsongcutを接続するのが最短で保守しやすい。

### `ASS_Lyric_Effects`側の変更候補

#### P0: songcut統合前に必要

1. **画面端での矩形生成を安全化する。** `mirror_reflection`と`water_reflection`は指定方向に空きがない場合の反対側配置または画面内縮退、`lava_flow`は`ground_y >= scene.y2`時の有効領域確保が必要。全9 alignment、四辺近傍、狭いtext boxを回す回帰テストを追加する。
2. **完全なmachine-readable parameter schemaを公開する。** parameterごとに`kind`、JSON-safe default、min、max、step、choices、英日label/description、ASS色／palette形式を持たせる。effect側にもone-line制約、context要否、出力コスト区分を持たせる。songcut側へ357個の規則を複製しないために必須。
3. **正式な依存識別子を確定して固定配布する。** 実態に合わせ`ass-lyric-effects`／`ass_lyric_effects`等へ改名するか、`effects40`名を継続するか決定し、version tag、GitHub Release、wheel/source asset、checksumを公開する。可能ならPyPIへ公開する。公開前なので、互換不要なら今の段階で名称を整理するのが最も単純。
4. **著作者・権利者metadataを修正する。** `pyproject.toml`のauthor、LICENSE、THIRD_PARTY_NOTICESの`OpenAI`表記を実際の権利関係に合わせる。

#### P1: 同時に直すと統合品質が上がる

1. `__version__`または公開package versionを追加し、songcutが生成ASS／診断情報へengine versionを記録できるようにする。
2. `get_effect_catalog()`のようなJSON-safeな一括APIを追加し、family、display order、分類、parameter schema、capabilityを単一正本から返す。
3. `measure_grapheme_widths()`へfont bytes、TTC face index、必要ならvariation指定を渡せる入口を追加する。family名からファイルを選ぶ責任はホスト側と明記する。
4. `estimate_event_count()`またはcost metadata／event budgetを提供する。高コスト演出が1セグメントで1000行超になることを呼び出し前に判定可能にする。
5. GitHub Pagesを有効化し、指定URLの404を解消する。manifestの`classification_status: provisional`と文書上のfinal表記も統一する。
6. 複数行非対応を失敗時だけでなくeffect capabilityとして公開する。将来対応しない場合でも、GUIが選択前に説明できる。

### songcut側の変更候補

#### 第1段階: engine境界と依存

- `pyproject.toml`: 固定versionの新package、`regex`、`uharfbuzz`をGUI/runtime依存へ追加し、旧`songcut.ass_effects23` package指定を削除する。
- `songcut/subtitle_export.py`: importを新packageへ変更する。engine metadata取得・parameter変換・context生成は字幕書き出し本体と分けた小さなadapter moduleへ置く。
- `songcut/ass_effects23/`、`third_party/ass-effects23/`、旧CLI、旧専用テスト、`.gitignore`例外を削除する。ユーザーが後方互換を必要としないと確認した場合は互換layerやfallbackを残さない。
- `packaging/build_dist.ps1`: PyInstallerへ`regex`と`uharfbuzz`本体・native wheelを確実に収集し、配布版のimport smokeを追加する。MIT LICENSE／noticesを配布物へ残す。

#### 第2段階: 正しいlayout context

- `songcut/subtitle_export.py`のコードポイント／East Asian Widthによる幅概算を、`split_graphemes()`と実フォントのHarfBuzz計測へ置換する。
- Electronの`system-fonts.ts`はfamily名しか返さないため、選択family・bold・italicを実フォントファイルとTTC faceへ解決するWindows font resolverが必要。
- outline、shadow、alignment、margin、複数行を含むtext boxを組み立て、書き出しに使うlibassのfont選択と測定fontが一致することを検証する。解決不能時に黙って別フォントへfallbackしない。

#### 第3段階: API・保存・GUI

- `songcut/api.py`: engine catalog endpointを追加し、effect nameとparameterを上流schemaで早期検証する。現状の任意name／scalar-only paramsを見直す。
- `gui/src/lib/subtitleEffects.ts`: 23件の手書き配列を廃止し、backendのcatalogを正本にする。動的ID、family/category、英日名称、説明、数値・select・color・palette controlへ対応する。
- `gui/src/components/SubModePanel.tsx`: 97件をflat selectにせず、family/category grouping、検索、説明、one-line制約を表示する。
- `gui/src/lib/subtitles.ts`と`gui/electron/project-schema.ts`: parameter schemaをJSON-safeに拡張する。旧23のeffect nameは保存値としてそのまま有効だが、palette配列を編集・保存するなら現行`string | number`契約を広げる。
- 現行の静止画字幕previewはeffectを入力・signatureに含めず、見た目を表示しない。97演出の選択支援として、上流sampleへのリンクまたは短時間の専用動画previewを別要件で決める。

#### 第4段階: 負荷・回帰検証

- 全97既定値、全categorical variant、9 alignment、短文／長文／Unicode cluster／複数行でASS生成contract testを行う。
- 高コスト演出を含む複数レーンの実動画を書き出し、FFmpeg/libassの描画、所要時間、メモリ、ASSサイズ、動画durationを確認する。
- GUI unit、API unit、typecheck、通常build、配布版Sub E2Eを実行し、PyInstaller版でnative依存とfont解決を確認する。

### 実装前に必要な判断

1. **Karaoke互換性:** 既存songcutの`\\kf`出力を維持するか、新packageのclip sweepへ切り替えるか。後者では既存プロジェクトの再書き出し結果が変わる。
2. **上流package名:** 未公開段階で97演出に合う名前へ破壊的に整理するか、`effects40`名を維持するか。
3. **複数行:** 非対応20演出をGUIで選択不可にするか、上流側で複数行対応を実装するか。自動的な`cut` fallbackは追加しない。
4. **preview:** 初回置換に動画previewまで含めるか、説明とsample linkまでに限定するか。

### ユーザー確定方針

- Karaokeはv3のclip sweepへ切り替え、旧`\kf`出力との互換・migrationを行わない。
- packageは正式統合前に`ass-lyric-effects`／`ass_lyric_effects`へ改名し、旧名aliasやfallbackを残さない。
- 複数行非対応20効果はASS_Lyric_Effects側で対応を検討・実装する。
- 動画previewはGitHub Pagesの既存サンプルを再生できればよく、現段階で再生成や動画差分検査を行わない。

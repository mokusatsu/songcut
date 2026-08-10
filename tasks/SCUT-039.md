# SCUT-039 字幕エフェクト設定の情報設計修正

## 目的

字幕スタイルダイアログの出力エフェクト設定を、効果の説明、duration、個別パラメータ、外部リンクの役割ごとに読みやすく配置する。また、色入力の高さ不足によりOutlineとBoldが二重ボタンのように重なって見える表示崩れを解消する。

## 変更範囲

- `SubModePanel`の字幕スタイル／出力エフェクト設定DOMを整理する。
- Typeと効果説明を同じ行に置き、durationを次の行へ分離する。
- catalog parameterの補足説明文を画面から削除する。
- サンプルとカタログページの外部リンクを既存Button意匠に合わせる。
- サンプル動画を中央に配置し、リンクボタンを通常幅では中央の1行2列、狭幅では安全に折り返して表示する。
- Type候補のドロップダウンを既存Shadcn系primitiveとScrollAreaで表示し、OS標準ではなくアプリ共通のscrollbarを使う。
- `ColorControl`のラベル、picker、文字列入力が後続Toggleと重ならない寸法・layoutへ修正する。
- 日英表示、responsive layout、GUIテストを同期する。

## 禁止事項

- catalog schema、effect ID、保存形式、字幕出力処理を変更しない。
- Bold／Italicや色文字列入力を削除しない。
- 外部URLをGUI側で推測・固定しない。
- focus-visible表示やdialogのTab操作を一律に無効化しない。
- SCUT-038および無関係な既存差分を戻さない。
- commit、push、PR作成を行わない。

## 完了条件

- [x] parameterごとの`Control(s) the ...`説明が表示されない。
- [x] Type selectorの右側に選択中effectの説明文が表示される。
- [x] start／end durationがType行の次の独立行に表示される。
- [x] サンプルとカタログページのリンクがButton意匠で表示され、catalog由来URLを開く。
- [x] サンプル動画が中央寄せになり、サンプル／カタログのボタンが通常幅では中央の1行2列、狭幅では溢れず折り返す。
- [x] Typeドロップダウンが97 effectsとcategory groupingを維持し、Shadcn形式のRadix Select viewportでスクロール操作できる。
- [x] Outline色入力とBold toggleが重ならず、各controlが一つの明確な枠で表示される。
- [x] narrow viewportでもType説明、duration、parameter、リンクが一列へ安全に折り返す。
- [x] GUI focused test、全Vitest、typecheck、production buildが成功する。
- [x] コードマップとタスク証跡が最終実装に一致する。

## テスト方法

- `SubModePanel`のsource contract／render testで説明文削除、行分割、リンクButton classを固定する。
- Type selectorの選択、category group表示、keyboard操作、Shadcn ScrollArea利用をfocused testで固定する。
- Sub E2EのType操作はRadix triggerとportal内`data-effect-id` itemを使い、97効果・category・fad／glow選択契約を固定する。
- `pnpm run typecheck`、focused Vitest、全Vitest、`pnpm run build`。
- build後の字幕スタイルダイアログを実画面で確認する。
- `git diff --check`で差分を確認する。

## 停止条件

- catalog descriptionを削除するとアクセシビリティ上必要なlabelまで失われる場合。
- 既存の色文字列入力を廃止しなければlayoutを成立させられない場合。
- 対象ファイルに識別不能な並行変更が現れた場合。

## 実施証跡

- 開始: 2026-08-10。利用者の明示指示により開始。branch `codex/SCUT-036-ass-lyric-effects-integration`、開始HEAD `c3f21e650f6be8ce9a9cb541c790a835ec77f13f`。SCUT-038はE2E停止指示により実環境検証待ちとして保持する。
- 現行調査: 対象はCut固有画面ではなく、`SubModePanel`内の字幕スタイルダイアログ。parameter説明はcatalogの`description_en/ja`を各field下へ表示している。
- Outline調査: `ColorControl`は固定`width:42px;height:52px`のgrid内にlabel、34px picker、34px text inputを配置しており、内容高が枠を超える。Outline直後のBold toggleと視覚的に重なり、二重ボタンに見える。
- 実装: Type selectorを`@radix-ui/react-select`ベースのShadcn形式primitiveへ置換し、category group、keyboard操作、scroll button付きviewportを維持した。Type／説明、duration、effect parameterを独立行へ分離し、parameter補足文を削除した。catalog由来のサンプル／カタログURLは既存Button classを使うlinkへ変更した。
- Outline修正: `ColorControl`を`88px`幅、内容に追従する高さへ変更し、pickerと色文字列入力を一つのcontrol内へ収めた。Bold／Italic toggleと重ならない。
- 追加レイアウト: プレビュー領域を中央寄せし、サンプル／カタログリンクを`subtitle-effect-link-actions`へまとめた。通常幅は中央の1行2ボタン、`680px`以下は1列・幅100%として、片方だけの場合も中央に置く。
- Radix E2E追従: Type itemへstableな`data-effect-id`を追加し、Sub E2Eの97件／category確認、fad選択、segment glow選択をtrigger→portal option操作へ更新した。Radix 2.2.6のmouse選択契約に合わせ、各itemへ`pointerdown`→`pointerup`を送る。旧native `.subtitle-effect-section select`参照を削除した。
- 自動検証: focused Vitest `5 passed`、全GUI Vitest `49 files / 307 tests passed`、`pnpm run typecheck`、`pnpm run build`、`pnpm install --frozen-lockfile --offline`、`git diff --check`が成功。production buildの500KB超chunk警告のみで失敗なし。
- コードマップ: 中央寄せ追加後に`docs/code-map`を更新し、maintain update／verify／validateはいずれも成功、警告・エラーなし。
- 最終dist: `C:\dev\songcut\dist\songcut-win-x64`をversion `1.1.73`として再生成。portable起動後、`/health`と`/subtitle-effects/catalog`がHTTP 200。MSVC resolver DLLはbuild元と同一SHA256 `2C0F1FA6BAAB33CB37633422B38DD5D598647F46D9B265CF9F0407BCC2F18F2D`。
- ASS最新版: `git fetch --prune origin`後、local `main`と`origin/main`がcommit `c08fdac267731f519d3d2fee5c183b10c6f36347`で一致し、作業ツリーcleanを確認。このcommitから再構築したwheel SHA256 `DA53415DB412160EAD7FA60F6BDDD92F85AA228133BCB691AB167EE0F0CD8138`をportableへ同梱した。`core.py`と`_natural36_engine.py`はsourceとdistでSHA256完全一致。ASS側testsは`96 passed, 3024 subtests passed`、songcut側catalog／subtitle export／API focused testsは`61 passed`。
- 実E2E初回: portable版で約6分34秒の実動画を解析し、39行／2 lanesの字幕生成まで成功した。字幕スタイルダイアログのShadcn ScrollArea自体は使われていたが、Radix既定の自動表示では縦scrollbar要素がホバー時にも生成されず、E2Eが`Subtitle style shadcn vertical scrollbar on hover`で失敗した。
- 実E2E修正: レーン字幕スタイルの`ScrollArea`を、既存のセグメント設定と同じ`scrollbars={["vertical"]}`／`type="always"`へ統一した。focused Vitestは`6 passed`、typecheck、通常portable再buildが成功した。
- 実E2E再実行: `packaging/e2e_sub_mode.js`が`SUB_E2E_OK`で完了。Shadcn縦scrollbar、Radix Type selector、750ms既定値、プレビュー再生前後の固定dialog/frame/video寸法、fad／segment glow、約6分34秒の字幕Burn-inを確認した。出力は394.378秒、source／output audio codecはいずれもOpus。証跡logは`out/e2e-sub-mode/e2e-sub-mode.log`、出力動画は`out/e2e-sub-mode/export/02_「星の消えた夜に」 - Aimer-subtitled.mp4`（223,048,612 bytes）。

# SCUT-052 パレット型字幕エフェクトのカラーピッカー表示

## 目的

複数色を使う字幕エフェクトの色を、ASS色文字列を改行テキストエリアへ直接入力せず、各色ごとの既存カラーピッカーで選択・編集できるようにする。

## 変更範囲

- 共通の`SubtitleStyleEditor`で、catalog parameterの`kind: "palette"`を配列要素ごとの既存`ColorControl`として描画する。
- 各カラーピッカーの変更では、対象の配列要素だけを置換し、他の色、配列順、配列長を維持する。
- 共通エディタを使うレーンのスタイル編集とセグメント個別overrideの両方で同じ表示・保存契約を使う。
- `color_wave`、`aurora_bands`、および既存の複数単色parameterを持つ`color_pingpong`を対象とするGUI回帰テストを追加する。
- `subtitleEffects`のpalette正規化が文字列配列を維持する契約をテストで固定する。

## 禁止事項

- effect catalog、effect ID、backend API、Project schema、保存済み`params`の配列形式、ASSレンダリングを変更しない。
- paletteの色数追加・削除・並べ替えUIを追加しない。catalogまたは保存値にある配列長をそのまま使う。
- `kind: "color"`、`kind: "string"`、数値、choice、booleanの既存入力を置換しない。
- 色表示時に値を正規化・推測・破棄しない。既存`ColorControl`のpicker変換以外の変換を導入しない。
- 無関係な既存差分を戻さず、commit、push、PR作成を行わない。

## 完了条件

- `color_wave`と`aurora_bands`を選ぶと、paletteの各要素が独立した`input[type="color"]`を持つ`ColorControl`として表示され、palette用`Textarea`は表示されない。
- いずれか一つの色を変更すると、`onEffectChange`へ渡すpalette配列では対応する添字だけが変わり、元の配列順・長さ・他要素が維持される。
- レーンのスタイル編集とセグメント個別overrideの双方が、共通`SubtitleStyleEditor`を通じて同じ挙動になる。
- `color_pingpong`など、複数の`kind: "color"` parameterを持つ既存効果のカラーピッカー表示が維持される。
- 対象GUI Vitest、`subtitleEffects`の対象テスト、renderer TypeScript型検査、GUI production build、`git diff --check`が成功する。

## テスト方法

- `SubtitleStyleEditor`のDOMテストで、palette fixtureを注入した`color_wave`に4個のcolor inputがあり、parameter grid内にpalette用textareaがないことを確認する。
- 同テストで任意のpickerを変更し、変更対象だけを差し替えた`string[]`が`onEffectChange`へ渡ることを確認する。
- `color_pingpong`の`color_a`と`color_b`が従来どおり個別pickerとして表示されることを回帰確認する。
- `subtitleEffects.test.ts`でpalette値の正規化が文字列配列の順序・値を保持することを確認する。
- GUI対象Vitest、`pnpm exec tsc -p tsconfig.json --noEmit --pretty false`、`pnpm run build`、`git diff --check`を実行する。

## 停止条件

- catalogに色文字列以外のpalette要素、または利用者が編集可能な色数を要求する効果があり、追加・削除・並べ替えの仕様判断が必要になる場合。
- 未コミットの`SubtitleStyleEditor`またはその周辺ファイルが別作業と重なり、所有者との調整なしに安全に変更できない場合。
- 既存`ColorControl`だけではアクセシビリティ、Tab操作、または色文字列編集の契約を満たせず、新しい入力仕様が必要になる場合。

## 登録根拠

- 2026-08-13: 読み取り専用の調査で、`SubtitleStyleEditor`の`kind: "palette"`分岐が`string[]`を改行連結した`Textarea`として描画していることを確認した。一方、`kind: "color"`は既存`ColorControl`を使っている。
- 2026-08-13: `ass_lyric_effects` 3.0.0の現行catalogでは、palette型は`color_wave`と`aurora_bands`の2効果だけであり、各既定値は4色の文字列配列だった。`color_pingpong`は個別の`color_a`／`color_b`であり、既存picker表示の対象である。
- 2026-08-13: frontend型・backend validation・レンダリングはpaletteを`string[]`として保持しているため、修正対象はUIの表示分岐に限定できることを確認した。

## 実施証跡

- 2026-08-14: `main`、HEAD `6bf1074`。SCUT-040以降を含む既存の広い未commit差分を保持し、未追跡だった共通`SubtitleStyleEditor`にはpalette表示分岐だけを追記した。
- 2026-08-14: palette用`Textarea`を除去し、各配列要素を既存`ColorControl`で描画するよう変更した。変更時は`replacePaletteColor`で指定添字だけを置換し、順序・長さ・他要素を保持する。
- 2026-08-14: `SubtitleStyleEditor`の静的DOM回帰テストで`color_wave`／`aurora_bands`の4個のpalette picker、palette textarea不在、`color_pingpong`の既存2色pickerを確認した。`subtitleEffects`の正規化テストで文字列配列の値・順序・コピー保持を固定した。
- 2026-08-14: Codex同梱Node/pnpmで`pnpm exec vitest run src/components/SubtitleStyleEditor.test.tsx src/lib/subtitleEffects.test.ts`を実行し、2 files / 10 testsが成功した。`pnpm exec tsc -p tsconfig.json --noEmit --pretty false`も成功した。
- 2026-08-14: `pnpm run build`が成功し、`gui/dist/index.html`と`gui/dist/assets/index-BMjZy2nu.js`を更新した。500 kB超chunk警告のみで失敗はない。
- 2026-08-14: 追跡済み・未追跡の対象ファイルに対する`git diff --check`／`git diff --no-index --check`は成功した（既存のLF→CRLF警告のみ）。
- 状態判断: 完了。

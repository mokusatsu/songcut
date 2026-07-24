# ass-effects23

カットイン／カットアウト状態のASS `Dialogue:`行へ、23種類の開始・終了演出を付加するPythonモジュールです。

単一のASSイベントで実現できない演出もあるため、返値は常に`list[str]`です。リスト内の各要素が、完成した`Dialogue:`行です。

## 基本API

```python
from ass_effects23 import Effect, decorate_dialogue

line = (
    "Dialogue: 0,0:00:01.00,0:00:06.00,"
    "Default,,0,0,0,,字幕テキスト"
)

result = decorate_dialogue(
    line,          # 必須：Dialogue行
    500,           # 必須：開始演出時間（ms）
    500,           # 必須：終了演出時間（ms）
    Effect.ZOOM,   # 必須：エフェクト種類
    params={"min_scale": 0},
)

print("\n".join(result))
```

必須の4引数は次の順です。

```python
decorate_dialogue(
    dialogue_line,
    start_duration_ms,
    end_duration_ms,
    effect,
    *,
    params=None,
    context=None,
) -> list[str]
```

`effect`には次のいずれかを指定できます。

- `Effect`列挙値
- `fad`、`slide`などの英語名
- カタログ上の日本語名
- 1から23までの番号

## Dialogue行だけでは不足する情報

Dialogue行を入力とする方式は、開始・終了時刻、レイヤー、スタイル名、マージン、本文を保持できるため、基本APIとしては適しています。

ただし、Dialogue行には次の情報が含まれません。

- `[Script Info]`の`PlayResX`と`PlayResY`
- スタイルで決まる最終的な表示位置と文字サイズ
- レンダリング後の文字領域
- 画面外と判断する座標

この情報を必要とするエフェクトには、`EffectContext`を必ず明示してください。暗黙の解像度や座標へフォールバックしません。

```python
from ass_effects23 import Effect, EffectContext, Rect, decorate_dialogue

context = EffectContext(
    play_res_x=1920,
    play_res_y=1080,
    anchor_x=960,
    anchor_y=540,
    text_box=Rect(600, 440, 1320, 640),
    offscreen_margin=240,
)

result = decorate_dialogue(
    line,
    500,
    500,
    Effect.SLIDE,
    params={"direction": "left_to_right"},
    context=context,
)
```

Context必須エフェクトで`context=None`のまま呼び出すと、`EffectParameterError`になります。

```text
effect 'slide' requires an explicit EffectContext because a Dialogue
line does not contain PlayRes, anchor, or rendered text bounds
```

### EffectContextの意味

| フィールド | 意味 |
|---|---|
| `play_res_x`、`play_res_y` | ASSスクリプトの論理解像度 |
| `anchor_x`、`anchor_y` | 通常表示時の基準位置 |
| `text_box` | 縁取りと影を含む文字領域 |
| `offscreen_margin` | スライド開始・終了時に画面外へ追加する距離 |
| `strict` | 入力中の既存動的タグをエラーにするか |

`text_box`を省略した`EffectContext`では、画面中央25～75％×38～62％の矩形を使います。正確なワイプ、スキャンライン、グリッチ、ディゾルブには実際の文字領域を指定してください。

## 方向の扱い

方向性のあるエフェクトは、`params["direction"]`を1つだけ受け取ります。

```python
params={"direction": "left_to_right"}
```

方向は「演出が進行する向き」です。`left_to_right`の場合、開始演出は左から右へ現れ、終了演出も左から右へ消えます。

開始用と終了用の方向を別々に指定するAPIはありません。`start_direction`、`end_direction`、`in_direction`、`out_direction`などを渡すと明示的にエラーになります。

使用可能な方向値は次のとおりです。

- `left_to_right`
- `right_to_left`
- `top_to_bottom`
- `bottom_to_top`
- `clockwise`
- `counterclockwise`
- `horizontal`
- `vertical`

各エフェクトは、この中から意味のある値だけを受け付けます。

## 23種類のエフェクト

| # | `Effect`／文字列 | Context | `params` |
|---:|---|---|---|
| 1 | `CUT`／`cut` | 不要 | なし |
| 2 | `FAD`／`fad` | 不要 | なし |
| 3 | `FADE`／`fade` | 不要 | なし |
| 4 | `ALPHA`／`alpha` | 不要 | なし |
| 5 | `ZOOM`／`zoom` | 不要 | `min_scale` |
| 6 | `POP`／`pop` | 不要 | `overshoot` |
| 7 | `BOUNCE`／`bounce` | 不要 | `peak`、`valley`、`rebound` |
| 8 | `SLIDE`／`slide` | 必須 | `direction`（上下左右） |
| 9 | `WIPE`／`wipe` | 必須 | `direction`（上下左右） |
| 10 | `BLUR`／`blur` | 不要 | `radius` |
| 11 | `ROTATE`／`rotate` | 不要 | `direction`（時計／反時計）、`degrees` |
| 12 | `FLIP`／`flip` | 不要 | `direction`（水平／垂直）、`degrees` |
| 13 | `SPACING`／`spacing` | 不要 | `spacing` |
| 14 | `STRETCH`／`stretch` | 不要 | `direction`（水平／垂直）、`min_scale` |
| 15 | `OUTLINE`／`outline` | 不要 | `border` |
| 16 | `GLOW`／`glow` | 不要 | `radius`、`border`、`color` |
| 17 | `FLICKER`／`flicker` | 不要 | `interval_ms`、`seed` |
| 18 | `TYPEWRITER`／`typewriter` | 不要 | `direction`（左右） |
| 19 | `KARAOKE`／`karaoke` | 必須 | `direction`（左右） |
| 20 | `SCANLINE`／`scanline` | 必須 | `direction`（上下左右）、`steps`、`softness_ms` |
| 21 | `DISTORT`／`distort` | 不要 | `direction`（左右）、`amount` |
| 22 | `GLITCH`／`glitch` | 必須 | `slices`、`intensity`、`seed` |
| 23 | `DISSOLVE`／`dissolve` | 必須 | `columns`、`rows`、`seed`、`blur` |

Context必須なのは次の6種類です。

```python
CONTEXT_REQUIRED_EFFECTS = {
    Effect.SLIDE,
    Effect.WIPE,
    Effect.KARAOKE,
    Effect.SCANLINE,
    Effect.GLITCH,
    Effect.DISSOLVE,
}
```

## 入力規則

入力はASS v4+形式の完全な`Dialogue:`行1行です。

```ass
Dialogue: 0,0:00:01.00,0:00:06.00,Default,,0,0,0,,字幕テキスト
```

本文中のカンマは保持されます。先頭9個のカンマだけをフィールド区切りとして扱います。

入力は「カットイン／カットアウト状態」を前提とします。`\b`、`\c`、`\pos`などの静的タグは保持しますが、次の動的タグが既にある場合は既定でエラーにします。

- `\fad`、`\fade`
- `\t`
- `\move`
- `\clip`、`\iclip`
- `\k`、`\K`、`\kf`、`\ko`

既存の動的タグへさらに効果を重ねると、ASSレンダラーごとの解釈差やタグ競合が生じるためです。

開始演出時間と終了演出時間の合計は、Dialogueイベントの長さ以下でなければなりません。

## 複数行を返すエフェクト

次の効果は、通常複数のDialogue行を返します。

- `slide`：入場、静止、退場を別イベント化
- `glow`：発光層と通常文字層
- `flicker`：点滅区間
- `typewriter`：文字数ごとの区間
- `scanline`：短冊状のクリップ層
- `glitch`：位置・色・クリップの断片
- `dissolve`：矩形タイル層

出力リストを改行で連結すれば、そのままASSの`[Events]`セクションへ挿入できます。

## CLI

インストールします。

```bash
python -m pip install .
```

単一行効果：

```bash
ass-effects23 \
  'Dialogue: 0,0:00:01.00,0:00:06.00,Default,,0,0,0,,字幕テキスト' \
  --start-ms 500 \
  --end-ms 500 \
  --effect zoom \
  --param min_scale=0
```

Context必須効果：

```bash
ass-effects23 \
  'Dialogue: 0,0:00:01.00,0:00:06.00,Default,,0,0,0,,字幕テキスト' \
  --start-ms 500 \
  --end-ms 500 \
  --effect wipe \
  --param direction=left_to_right \
  --play-res-x 1920 \
  --play-res-y 1080 \
  --anchor-x 960 \
  --anchor-y 540 \
  --text-box 600 440 1320 640
```

標準入力からDialogue行を読む場合は、位置引数に`-`を指定します。

## テストとサンプル

依存ライブラリなしで単体テストを実行できます。

```bash
python -m unittest discover -s tests -v
```

全23効果を含むASSサンプルを生成します。

```bash
python examples/generate_catalog.py
```

## 制約

- ASS時刻は最終的に10ミリ秒単位へ丸めます。
- `typewriter`は先頭の静的オーバーライドブロックを保持しますが、本文途中のオーバーライドブロックは受け付けません。
- `text_box`はフォントメトリクスから自動計算しません。厳密な座標が必要な場合は、呼び出し側でレンダリング後の領域を与えてください。
- `glow`、`glitch`、`dissolve`などは複数レイヤー／複数イベントで構成されます。

# FFmpeg ハードサブ仕様・実装調査

調査日: 2026-07-23
対象: FFmpeg 8.1 系を中心とする現行 FFmpeg / libass 0.17 系
目的: SongCut で字幕を映像へ焼き込む機能を設計・実装・検証するための技術基準

## 1. 結論

FFmpeg の「ハードサブ」は、字幕ストリームを出力コンテナへ格納する処理ではなく、字幕を各映像フレームへ合成して映像を再エンコードする処理である。したがって、映像のストリームコピー（`-c:v copy`）や SongCut のスマートレンダーとは両立しない。

字幕は入力の性質によって、必ず次の 2 系統に分けて扱う。

| 入力 | 代表例 | 焼き込み経路 | 見た目の変更 |
|---|---|---|---|
| テキスト字幕 | SRT、ASS/SSA、WebVTT、mov_text、TTML など | `subtitles` または `ass` フィルター → libass | 可能。ASS の情報量を上限として `force_style` 等を適用 |
| 画像字幕 | PGS、DVD/VobSub、DVB、画像出力の ARIB/Teletext など | 字幕デコーダ → RGBA 字幕フレーム → `overlay` | 原則不可。画像自体を拡大・移動・色変換することは可能 |

`subtitles` は画像字幕を描画する汎用フィルターではない。テキスト字幕を libavcodec/libavformat で ASS に変換し、libass でラスタライズするフィルターである。一方、画像字幕は `overlay` の第 2 映像入力として合成する。

SongCut で初期実装する場合は、以下を推奨する。

1. SRT/ASS/SSA/WebVTT と、コンテナ内のテキスト字幕を第 1 対象にする。
2. PGS/DVD/DVB/ARIB は「画像字幕」として別機能・別テスト経路にする。
3. ハードサブ指定時は映像を必ずフル再エンコードし、音声だけを可能ならコピーする。
4. 出力字幕ストリームを残すか削除するかを明示し、既定では焼き込み対象を `-sn` 相当で残さない。
5. フォントをアプリ側で固定し、環境依存のフォントフォールバックを避ける。

## 2. 用語と処理モデル

### 2.1 ハードサブとソフトサブ

- ハードサブ（burn-in、burned-in、hardcoded subtitle）: 字幕画素を映像画素へ不可逆に合成する。再生側で非表示・言語切替・スタイル変更はできない。
- ソフトサブ: 字幕を独立ストリームとしてコンテナへ格納する。再生側で選択でき、映像はコピー可能である。
- オープンキャプション: 常時表示される字幕という提供形態。通常はハードサブで実現する。
- クローズドキャプション: 選択可能な字幕という提供形態。コンテナ字幕だけでなく、映像ビットストリーム内の EIA-608/708 等を指す場合もある。

概念上の処理は次のとおり。

```text
入力コンテナ
  ├─ 映像 ─ decode ─┐
  ├─ テキスト字幕 ─ decode → ASS化 → libass描画 ─┤ blend → encode → 出力映像
  └─ 画像字幕 ─ decode → RGBA字幕フレーム ──────┘
```

字幕の合成後は元映像の圧縮データと一致しないため、再エンコードは必須である。フィルターと `-c:v copy` は同時に成立しない。

## 3. 実行環境と機能検出

FFmpeg の配布物によって、フィルター、字幕デコーダ、文字整形、ハードウェアエンコーダの有無が異なる。ファイル拡張子だけで対応可否を決めず、実行バイナリを問い合わせる。

```powershell
ffmpeg -hide_banner -version
ffmpeg -hide_banner -buildconf
ffmpeg -hide_banner -filters | Select-String 'subtitles|ass|overlay'
ffmpeg -hide_banner -h filter=subtitles
ffmpeg -hide_banner -h filter=ass
ffmpeg -hide_banner -decoders | Select-String 'sub|caption|teletext'
ffmpeg -hide_banner -hwaccels
ffmpeg -hide_banner -encoders | Select-String 'nvenc|qsv|amf|vaapi|videotoolbox'
```

最低要件は次のとおり。

- テキスト字幕: FFmpeg が `--enable-libass` で構築され、`subtitles` フィルターを含むこと。
- `subtitles`: libass に加えて libavcodec と libavformat が必要。
- `ass`: libavcodec/libavformat を必要としないが、外部 ASS/SSA ファイルしか受け付けない。
- 複雑な文字体系: HarfBuzz を組み込んだ libass が望ましい。
- Unicode 改行: libass 0.17.0 以上かつ libunibreak 対応ビルドが必要。
- 各画像字幕: 対応デコーダが必要。Teletext、ARIB 等は外部ライブラリ依存の場合がある。

調査時のローカル環境は Gyan.dev の FFmpeg `8.1.2-full_build` で、`libass`、`fontconfig`、`libfreetype`、`libfribidi`、`libharfbuzz`、`libaribcaption`、`libzvbi`、`libzimg` と主要ハードウェア API が有効だった。これは SongCut が常に同じ配布物を使うという保証ではないため、起動時またはジョブ作成時に実バイナリを検査する必要がある。

FFmpeg 自身も、対応形式一覧はビルドに依存するとしている。現行の一般ドキュメントには、ASS/SSA、SRT、WebVTT、DVB、DVD、PGS、VobSub、TTML 等の demux/decode 対応状況が掲載されているが、最終判断には `-decoders`、`-demuxers`、`ffprobe` を使う。[FFmpeg General Documentation: Subtitle Formats](https://ffmpeg.org/general.html#Subtitle-Formats)

## 4. 入力調査と字幕選択

まず `ffprobe` で、グローバルなストリーム番号、字幕 codec、言語、title、disposition を取得する。

```powershell
ffprobe -v error -show_streams -show_entries `
  stream=index,codec_name,codec_long_name,codec_type:stream_tags=language,title:stream_disposition `
  -of json input.mkv
```

選択 UI では最低限、次を表示する。

- グローバルストリーム番号（例: `0:3`）
- 字幕内の順序（0 始まり）
- codec（例: `ass`、`subrip`、`hdmv_pgs_subtitle`）
- text / bitmap の分類
- `language`、`title`
- `default`、`forced`、`hearing_impaired` 等の disposition

注意点:

- `-map 0:s:1` は第 1 入力の 2 本目の字幕ストリームを指す。
- `subtitles=input.mkv:si=1` の `si=1` も字幕ストリーム中の 2 本目を指す。公式例もこの表現を使う。[FFmpeg Filters: subtitles](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1)
- `ffprobe` の `index` は全ストリーム共通の番号なので、その値と `si` を混同しない。
- 自動ストリーム選択は出力 muxer と字幕 encoder の種類に左右される。ハードサブでは必ず入力と出力を明示的に `-map` する。[FFmpeg: Stream selection](https://ffmpeg.org/ffmpeg.html#Stream-selection)

## 5. テキスト字幕の焼き込み

### 5.1 基本コマンド

外部 SRT:

```powershell
ffmpeg -i input.mp4 `
  -vf "subtitles=filename=sub.srt" `
  -map 0:v:0 -map 0:a? -c:v libx264 -crf 20 -preset medium -c:a copy -sn output.mp4
```

コンテナ内の 2 本目のテキスト字幕:

```powershell
ffmpeg -i input.mkv `
  -vf "subtitles=filename=input.mkv:si=1" `
  -map 0:v:0 -map 0:a? -c:v libx264 -crf 20 -preset medium -c:a copy -sn output.mp4
```

`-map 0:a?` の `?` は音声がない入力でも失敗しない指定である。`-sn` は出力へ独立字幕ストリームを自動追加しない意図を示す。焼き込み後もソフト字幕を残したい製品仕様なら、対象を明示して `-map 0:s...` と対応する `-c:s` を追加する。

### 5.2 `subtitles` フィルターの全オプション

現行公式仕様は以下のとおり。[FFmpeg Filters: subtitles](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1)

| オプション | 意味 | 実装上の注意 |
|---|---|---|
| `filename`, `f` | 字幕ファイルまたは字幕を含むコンテナ | 必須。省略記法より `filename=` を推奨 |
| `original_size=WxH` | ASS が作成された元映像サイズ | アスペクト比を変更した場合のフォント倍率補正に必要 |
| `fontsdir=DIR` | 追加フォントディレクトリ | OS の font provider に追加される。排他的指定ではない |
| `alpha=0|1` | 入力映像の alpha channel も処理 | 既定 `0`。通常の不透明映像では不要 |
| `charenc=ENC` | 非 UTF-8 字幕の文字コード | `subtitles` のみ。例: `CP932`。可能なら事前に UTF-8 化 |
| `stream_index`, `si` | 対象字幕の字幕内 0-based 番号 | コンテナ入力で使用 |
| `force_style=...` | ASS の Style / Script Info を上書き | `KEY=VALUE` をカンマ区切り。元のインライン override tag が優先する場合がある |
| `wrap_unicode=0|1` | Unicode Line Breaking Algorithm | 利用可否は libass/libunibreak ビルド依存。native ASS 以外は既定有効 |

### 5.3 `ass` フィルター

`ass` は `subtitles` と同じ libass 描画経路だが、ASS ファイル専用である。`filename`、`original_size`、`fontsdir`、`alpha` に加え `shaping` を持つ。`charenc`、`si`、`force_style` は持たない。[FFmpeg Filters: ass](https://ffmpeg.org/ffmpeg-filters.html#ass)

`shaping`:

- `auto`: 最良の利用可能な shaper。既定値。
- `simple`: 高速だが font-agnostic で、置換しか行わない。
- `complex`: OpenType の置換と位置調整を使う。アラビア語、ヘブライ語、デーヴァナーガリー、タイ語等に必要で、HarfBuzz 対応ビルドを要する。

通常は `auto` のままにする。速度目的で `simple` を選ぶと、日本語の一般的な横書きだけで差が見えなくても、多言語入力で正しさを失う。

### 5.4 スタイル

SRT 等には完全なスタイル情報がないため、FFmpeg が ASS に変換した後の Default style を `force_style` で上書きできる。

```text
subtitles=filename=sub.srt:force_style='Fontname=Noto Sans CJK JP,Fontsize=48,Alignment=2,MarginV=54,Outline=2,Shadow=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000'
```

主要キー:

- `Fontname`, `Fontsize`
- `PrimaryColour`, `SecondaryColour`, `OutlineColour`, `BackColour`
- `Bold`, `Italic`, `Underline`, `StrikeOut`
- `ScaleX`, `ScaleY`, `Spacing`, `Angle`
- `BorderStyle`, `Outline`, `Shadow`
- `Alignment`（テンキー配置: 1–3 下、4–6 中、7–9 上）
- `MarginL`, `MarginR`, `MarginV`
- `Encoding`

ASS の色は `&HAABBGGRR`（alpha, blue, green, red）の順で、alpha は `00` が不透明、`FF` が完全透明である。一般的な `#RRGGBB` や RGBA と逆順なので、UI では必ず変換関数を通す。libass の現行ガイドも Style 色を ABGR と定義する。[libass: ASS File Format Guide](https://github.com/libass/libass/wiki/ASS-File-Format-Guide)

`force_style` は全イベントを完全に均一化する機能ではない。ASS 本文に `\fn`、`\fs`、`\c`、`\pos`、`\an` 等の override tag があれば、そのイベントの指定が適用される。完全に統一したい場合は、ASS を解析・正規化してから入力する必要がある。

### 5.5 ASS の座標、解像度、アスペクト比

ASS は `PlayResX` / `PlayResY` と、現行の作成指針では `LayoutResX` / `LayoutResY` を基準に配置・拡大する。`original_size` は「現在の出力サイズ」ではなく「その ASS が作られた元映像サイズ」である。

- 最終解像度へ scale してから字幕を焼くと、字形と輪郭が最終解像度でラスタライズされ、通常は最も鮮明になる。
- 字幕を焼いた後で scale すると、字幕も映像と一緒に拡縮され、輪郭がぼけやすい。
- 元映像と出力の display aspect ratio が変わる場合は、`original_size` だけで全配置を救えない。絶対位置指定や複雑な typeset は目視確認が必要。
- anamorphic 入力では storage size、SAR、display size の区別が必要である。

例:

```text
scale=1920:1080,subtitles=filename=sub.ass:original_size=1280x720
```

FFmpeg 公式文書は ASS のアスペクト比計算上の問題により、アスペクト比変更時に `original_size` が必要だと明記している。libass ガイドは、ASS を新規作成するとき native display dimensions を LayoutRes と PlayRes に使うよう推奨している。

### 5.6 フォント探索と再現性

フォント候補は概ね次の順で供給される。

1. 字幕を読み込んだコンテナに添付されたフォント
2. `fontsdir` の追加フォント
3. libass が使用する OS / Fontconfig 等の font provider
4. font provider のフォールバック

FFmpeg の現行 `vf_subtitles.c` は、字幕を含むコンテナの attachment を調べ、フォント MIME type と filename を持つ添付を libass に渡す。[FFmpeg source: vf_subtitles.c](https://ffmpeg.org/doxygen/trunk/vf__subtitles_8c_source.html)

再現可能な出力にするには:

- SongCut 配布物にライセンス上再配布可能な日本語フォントを同梱する。
- ジョブ専用 `fontsdir` を指定する。
- UI の既定 `Fontname` を同梱フォントの family name に固定する。
- 代替 glyph、太字・斜体の実ファイル、縦書き、絵文字をテストする。
- MKV 添付フォントを使う場合、字幕と同じ MKV を `filename=` に渡す。字幕だけを一旦 SRT へ抽出すると attachment との関連が失われる。
- フォントファイル名と family name は同一とは限らないため、`Fontname` にファイル名を入れない。

ASS 内 `[Fonts]` 埋め込みも存在するが、libass ガイドは可能なら MKV 等への attachment を推奨している。

### 5.7 文字コード、改行、文字整形

- ASS の新規生成物とアプリ内部は UTF-8 に統一する。
- legacy SRT だけ `charenc=CP932` 等を許可し、入力選択時に明示する。
- 誤った `charenc` は文字化けまたは decode failure になる。BOM の有無だけに依存して推定しない。
- `wrap_unicode` は日本語のように ASCII space だけを改行点としない言語で重要である。
- native ASS では typesetter の `WrapStyle` と手動改行を尊重するため、`wrap_unicode` の既定は無効である。
- 複雑文字体系、結合文字、RTL、bidi、ルビ相当の typeset、絵文字は個別テストが必要である。

## 6. 画像字幕の焼き込み

### 6.1 基本コマンド

PGS/DVD/DVB 等の画像字幕は、字幕デコーダが時刻付きの透過画像を生成し、`overlay` が映像へ合成する。

```powershell
ffmpeg -i input.mkv `
  -filter_complex "[0:v:0][0:s:0]overlay=eof_action=pass:repeatlast=0,format=yuv420p[v]" `
  -map "[v]" -map 0:a? -c:v libx264 -crf 20 -preset medium -c:a copy -sn output.mp4
```

`format=yuv420p` は 8-bit SDR の広い互換性を狙う例であり、10-bit/HDR 出力へそのまま流用してはならない。

`overlay` は framesync を使う。特に以下を明示する。

- `eof_action=pass`: 字幕入力が EOF になった後も主映像を通す。
- `repeatlast=0`: 最後の字幕フレームを映像終端まで保持しない。
- `shortest=0`: 字幕が終わっても出力を打ち切らない。

既定値は secondary input の最終フレームを繰り返す方向なので、字幕デコーダの空フレーム処理と FFmpeg バージョンに依存させず明示する。[FFmpeg Filters: framesync options](https://ffmpeg.org/ffmpeg-filters.html#Options-for-filters-with-several-inputs-_0028framesync_0029)

### 6.2 画像字幕固有の制約

- 文字内容、font、outline、色を `force_style` で変更できない。
- 拡大縮小は画像処理になるため、文字の輪郭が劣化する。
- PGS は decode のみで、FFmpeg の一般対応表では encode/mux に制限があるが、焼き込みには decode ができればよい。
- DVD/VobSub は palette が別情報にある。VobSub の `.idx`、DVD の IFO、Matroska codec extradata が欠けると色が不正になり得る。
- `dvdsub` decoder には `palette`、実験的な `ifo_palette`、`forced_subs_only` がある。
- DVB subtitle は CLUT と event duration の扱いに注意する。
- `-fix_sub_duration` は次の字幕 packet を待って duration を補正するため、必要な codec では残像や non-monotonic timestamp を防げる一方、遅延とメモリ使用量が増える。[FFmpeg: Advanced Subtitle options](https://ffmpeg.org/ffmpeg.html#Advanced-Subtitle-options)
- canvas size が確定できない入力では `-canvas_size WxH` が必要になることがある。

### 6.3 ARIB と Teletext

ARIB caption decoder は text または bitmap を出力できるビルドがある。複雑な放送字幕の graphics / DRCS / positioning を保つには bitmap が安全で、公式例も以下の形を示している。

```text
ffmpeg -sub_type bitmap -i src.m2t -filter_complex "[0:v][0:s]overlay" -c:v h264 dest.mp4
```

Teletext も `bitmap`、`text`、`ass` の出力形態を持ち、graphics と色を保つには bitmap が推奨される。文字として再スタイルしたい場合のみ text/ASS を選び、情報損失を受け入れる。[FFmpeg Codecs: Subtitle Decoders](https://ffmpeg.org/ffmpeg-codecs.html#Subtitles-Decoders)

### 6.4 EIA-608 / CEA-708 と映像内 caption

caption が常に通常の container subtitle track として見えるとは限らない。EIA-608/CEA-708 は MPEG-2/H.264 等の映像 bitstream、user data、side data に入る場合があり、demux/decode 段階で独立した `eia_608` subtitle stream として露出するかは入力と FFmpeg の経路に依存する。現行 FFmpeg には `cc_dec`（EIA-608 / CEA-708）subtitle decoder がある。[FFmpeg source: Closed Captions decoder](https://ffmpeg.org/doxygen/trunk/ccaption__dec_8c_source.html)

この種の入力は、`ffprobe -show_streams` で字幕がないことだけを理由に「caption なし」と断定しない。packet/side-data を追加調査し、独立字幕として抽出できた後に text 経路で焼く。SongCut の初期対応範囲では通常の subtitle stream と外部字幕だけを保証し、映像 bitstream 内 caption の発見・抽出は別機能として明示する。

### 6.5 複数字幕の同時合成

2 言語、歌詞と翻訳、看板 typeset と会話字幕等を同時に焼く場合、text filter または overlay を順に chain する。

```text
subtitles=filename=lyrics.ass,subtitles=filename=translation.srt:force_style='Alignment=8'
```

各 filter は独立して collision layout を計算するため、別ファイル同士の衝突を自動回避しない。上下 alignment/margin を設計するか、1 本の ASS に統合して layer と event collision を管理する。画像字幕を複数重ねる場合も overlay ごとに framesync と EOF 動作を指定する。

### 6.6 `drawtext` との違い

`drawtext` は文字列、時刻、metadata 等をフレームへ描く video filter であり、SRT/ASS の event parser、字幕 stream selector、ASS typesetting engine ではない。固定 watermark や単純な動的 text には使えるが、一般字幕の代替として event ごとに `enable` 式を生成すると、escaping、改行、bidi、collision、karaoke、性能の問題を再実装することになる。字幕には `subtitles` / `ass` を使う。

## 7. タイムライン、切り出し、同期

字幕描画はフレームの PTS を使う。現行 `vf_subtitles.c` も `frame.pts × time_base` をミリ秒へ換算して libass に渡している。[FFmpeg source: vf_subtitles.c](https://ffmpeg.org/doxygen/trunk/vf__subtitles_8c_source.html)

これにより、次がすべて結果へ影響する。

- input/output の `-ss` の位置
- `-copyts`、`-start_at_zero`
- `setpts`
- 字幕側の `-itsoffset`
- 入力 container の start_time
- VFR、欠落 timestamp、negative timestamp
- concat や segment ごとの timestamp reset

`-ss` は入力オプションなら seek point まで移動し、transcode 時は既定の accurate seek により指定点までの余分な区間を decode/discard する。出力オプションなら入力を decode しながら指定 timestamp まで破棄する。[FFmpeg: `-ss`](https://ffmpeg.org/ffmpeg.html#Main-options)

SongCut の安全な初期方針:

1. 正確さ優先では `-ss` を出力側に置き、元タイムラインで字幕を描画してから必要区間を出す。
2. 高速 input seek を使う経路は、外部字幕・内蔵字幕それぞれで冒頭、境界、長時間位置を E2E テストする。
3. クリップ用字幕を別途生成するなら、全 event を `clip_start` だけ引き、負の区間を clip して 0-based にする。
4. 字幕遅延 UI は text/bitmap の経路差を隠蔽し、最終的な字幕 timestamp が同じ意味になるよう実装する。

次は一見すると外部テキスト字幕を 500 ms 遅らせるように見えるが、使用してはならない反例である。

```powershell
ffmpeg -i input.mp4 -itsoffset 0.5 -i sub.srt `
  -filter_complex "[0:v]subtitles=filename=sub.srt[v]" `
  -map "[v]" -map 0:a? ...
```

`subtitles=filename=...` はフィルター自身がファイルを開くので、上の第 2 input に対する `-itsoffset` はそのフィルターへ伝播しない。テキスト字幕は event 時刻を事前にシフトした一時 ASS/SRT を生成する。画像字幕のように subtitle stream が filtergraph input へ直接入る経路では、その入力 timestamp を `-itsoffset` 等で動かせる。実装では「指定したが効かない」CLI を生成しないこと。

## 8. フィルター順序

推奨する一般順序:

```text
decode → autorotate/deinterlace → crop → scale/pad → colorspace/tone-map → subtitle burn → pixel-format constraint → encode
```

理由:

- 回転・crop 後でなければ字幕位置が最終画面と一致しない。
- scale 後に描画した方が glyph が最終解像度で生成される。
- HDR を SDR にするなら tone-map 後の SDR 空間で字幕色を決める方が予測可能である。
- encoder 直前に pixel format を固定すると、暗黙の変換と互換性事故を減らせる。

例:

```text
yadif,crop=...,scale=1920:1080,zscale=...,subtitles=...,format=yuv420p
```

インターレースを維持したまま字幕を焼くと、細い横線や輪郭が field 間でちらつく。品質優先では deinterlace → burn → progressive encode を推奨する。再インターレースが必須なら別途 field-aware な検証を行う。

## 9. 色、bit depth、alpha、HDR

### 9.1 SDR

現行 `vf_subtitles.c` は、ASS の `YCbCr Matrix` と入力 link の colorspace/range を使って描画色を変換する。したがって、入力フレームに正しい `color_space` / `color_range` が付いていること、ASS の `YCbCr Matrix` が正しいことが重要である。[FFmpeg source: `ff_draw_init2`](https://ffmpeg.org/doxygen/trunk/vf__subtitles_8c_source.html)

ASS 新規生成では、libass ガイドに従い BT.601/BT.709 の video matrix/range と `YCbCr Matrix` を一致させる。それ以外は `None` を基本とし、実映像で検証する。

### 9.2 bit depth と pixel format

- `format=yuv420p` は強制的に 8-bit 化するので、10-bit ソースには無条件で使わない。
- 10-bit を維持するなら encoder が受ける `yuv420p10le` 等を選ぶ。
- 4:2:0 では細い色付き輪郭が chroma subsampling の影響を受ける。
- libx265 等が alpha 対応 format を自動選択すると意図しない format negotiation が起こり得るため、最終 format を明示する。
- `alpha=1` は alpha を持つ映像で字幕合成後の alpha も更新したい場合だけ使う。既定では alpha channel は触らない。

### 9.3 HDR

HDR では「白字幕」が何 nit に見えるかが仕様上重要だが、`subtitles` フィルターには subtitle reference white、nit、PQ/HLG 用 UI といった明示的な輝度指定がない。色 metadata を保持するだけでは、望む字幕輝度が保証されない。

したがって SongCut の初期仕様は次のどちらかに限定する。

- HDR → SDR tone-map → SDR 空間で字幕を焼く（推奨、予測可能）。
- HDR のまま焼く場合は、PQ/HLG、BT.2020、full/limited、mastering metadata、出力 encoder を固定した検証済み profile のみ許可する。

HDR のまま焼く経路では、字幕色・透明度・輪郭を HDR reference monitor または信頼できる測定手段で確認する。`format=yuv420p` を混ぜない。tone-map をする場合、字幕は tone-map 後に合成することで字幕自体が tone-map curve に巻き込まれるのを避ける。

## 10. ハードウェアアクセラレーション

`subtitles` / `ass` は libass を使う CPU video filter であり、CUDA/QSV/VAAPI/D3D11 等の hardware frame 上で直接動くフィルターではない。hardware decode を使う場合は通常、次の転送が必要になる。

```text
hardware decode
  → hwdownload
  → software pixel format
  → subtitles/ass
  → software pixel format
  → hwupload（APIに応じた派生形）
  → hardware encode
```

概念例（実際の device 名・format は GPU とビルドごとに調整）:

```text
hwdownload,format=nv12,subtitles=filename=sub.srt,format=nv12,hwupload
```

注意点:

- download/upload の PCIe・memory copy が律速になり、hardware decode の利点が薄れることがある。
- CPU decode + libass + hardware encode の方が単純で速い場合がある。
- `overlay_cuda` 等は software libass を置き換えない。テキストを GPU 上で typeset する機能ではない。
- 画像字幕でも decoder output と hardware main frame の pixel format/device が一致せず、software `overlay` が必要になりやすい。
- hardware encoder を選んでも「字幕焼き込み全体が GPU 処理」にはならない。

実装は CPU (`libx264`/`libx265`) を正解基準にし、NVENC/QSV/AMF は GPU ごとの E2E テストを通った profile だけ公開する。

## 11. パスと escaping

FFmpeg filtergraph は、シェルとは別に複数段の escaping を持つ。`:`、`\`、`'`、`,`、`[];` 等は置かれる階層で意味が変わる。Windows の `C:\...` は drive colon も含むため、文字列連結で CLI を作ると壊れやすい。[FFmpeg Utilities: Quoting and escaping](https://ffmpeg.org/ffmpeg-utils.html#Quoting-and-escaping) / [FFmpeg Filters: escaping](https://ffmpeg.org/ffmpeg-filters.html#Notes-on-filtergraph-escaping)

SongCut 実装規約:

- `subprocess` へ shell string ではなく argv 配列を渡す。
- それでも filtergraph 内部の escaping は必要なので、専用関数を 1 箇所に持つ。
- shell 用 quoting と filtergraph 用 escaping を混同しない。
- 可能なら ASCII のジョブ一時ディレクトリへ字幕とフォントを配置し、短い相対パスを使う。
- space、apostrophe、comma、semicolon、bracket、colon、backslash、日本語、emoji を含むパスをテストする。
- filtergraph をファイルから渡せる FFmpeg では `-/filter:v filter.script` や `-/filter_complex` 系も検討する。

ドキュメント例の引用符は PowerShell 向けであり、Python の argv 値へ外側の shell quotes をそのまま含めてはならない。

## 12. 出力、mapping、metadata

ハードサブ後の推奨 mapping は明示的に組み立てる。

- 映像: filtergraph 出力を 1 本だけ `-map`。
- 音声: 対象を `-map 0:a?` 等で明示し、互換なら `-c:a copy`。
- 字幕: 既定は含めない。併存仕様なら対象だけを map。
- attachment: 通常は出力に不要。ソフト ASS を残す場合だけフォント attachment も検討。
- chapters/global metadata: 必要なら `-map_chapters 0`、`-map_metadata 0` を明示。

コンテナ別の代表的注意:

- MP4: H.264/H.265/AV1 + AAC 等。字幕を残す場合は mov_text 等の制限があるが、焼き込み画素自体には関係しない。
- MKV: codec/attachment/複数音声の自由度が高い。
- WebM: codec 制約に注意。既存 SongCut の smart-render profile と混同しない。

映像 encoder の quality、preset、GOP、pixel format、color tags は元映像と出力用途から決める。字幕があるという理由だけで CRF 値を固定しない。

## 13. エラー分類

実装で利用者向けに区別すべき代表例:

| 症状 | 主因 | 対応 |
|---|---|---|
| `No such filter: subtitles` | libass 無効ビルド | 対応 FFmpeg を案内 |
| `Unable to open ...` | path/escaping/権限 | argv と filter escaping、存在確認 |
| `Unable to locate subtitle stream` | `si` 不正、字幕なし | ffprobe 結果と再照合 |
| `Only text based subtitles...` | 画像字幕を `subtitles` へ渡した | `overlay` 経路へ切替 |
| tofu（□）や別書体 | font 不在 / family 名違い | attachment / fontsdir / glyph coverage を確認 |
| 文字化け | charset 誤判定 | UTF-8 化または `charenc` |
| 字幕が残り続ける | bitmap duration / framesync | `-fix_sub_duration`、`eof_action`、`repeatlast` を確認 |
| 字幕がずれる | seek / PTS / start_time | timestamp log と境界テスト |
| 色・明るさが違う | matrix/range/HDR/format | ffprobe tags、ASS matrix、filter order を確認 |
| hardware filter graph failure | hw/software frame 不一致 | `hwdownload` / `format` / `hwupload` を明示 |

ログには秘密情報を除いた以下を残す。

- FFmpeg version/buildconf
- ffprobe の対象 stream 情報
- 生成した argv（パスは必要に応じマスク）
- filtergraph
- decoder/encoder/pixel format
- stderr 全体または十分な末尾
- exit code

## 14. 品質保証テスト行列

最低限、次を golden image または frame hash と目視で検証する。

### 字幕形式

- UTF-8 SRT
- CP932 SRT
- ASS（style、override tag、position、karaoke、複数 layer）
- WebVTT / mov_text の装飾保持と情報損失
- PGS
- DVD/VobSub（palette、forced-only）
- DVB / ARIB（対象に含める場合）

### 言語・文字

- 日本語（句読点、禁則、長文改行）
- Latin、Cyrillic
- Arabic/Hebrew（RTL/bidi）
- Devanagari/Thai（complex shaping）
- 結合文字、variation selector、emoji、欠落 glyph

### 映像

- 720p/1080p/2160p
- landscape/portrait、rotation metadata
- square pixel / anamorphic SAR
- CFR/VFR
- 8-bit SDR limited/full
- 10-bit SDR
- HDR10(PQ)/HLG（対応する場合）
- progressive/interlaced
- alpha 付き入力（対応する場合）

### タイムライン

- 先頭 0 秒の字幕
- event の start/end 境界フレーム
- 重なる字幕
- 1 時間以上の timestamp
- clip start が字幕 event の途中
- 正負 offset
- seek、cancel、再試行

### 環境

- bundled FFmpeg と PATH 上 FFmpeg
- font 有/無、添付 font、font fallback
- CPU encode
- 対応対象の NVENC/QSV/AMF profile
- 特殊文字・日本語を含むパス

検証時は、字幕開始直前・開始・終了直前・終了の 4 点を画像化すると off-by-one と残像を発見しやすい。

```powershell
ffmpeg -ss 12.345 -i output.mp4 -frames:v 1 -update 1 frame.png
```

## 15. SongCut への実装提案

### 15.1 データモデル

ジョブに最低限以下を保持する。

```text
subtitle_source: external | embedded
subtitle_path: Path | null
subtitle_stream_ordinal: int | null
subtitle_kind: text | bitmap
subtitle_codec: string
subtitle_offset_ms: int
style_mode: preserve | override
style: font family / size / colors / outline / shadow / alignment / margins
fonts_dir: Path | null
unicode_wrap: auto | on | off
keep_soft_subtitle: bool
render_profile: CPU/HW encoder、pixel format、SDR/HDR policy
```

### 15.2 計画作成

1. `ffprobe` で字幕一覧を取得する。
2. codec descriptor または既知 codec table で text/bitmap を分類する。
3. 実 FFmpeg の filter/decoder/encoder 能力を検査する。
4. text は `subtitles`、bitmap は `overlay` の plan を作る。
5. ハードサブ指定時は smart render を無効化し、理由を UI と estimate に表示する。
6. filter order、mapping、pixel format、color policy を確定する。
7. argv を配列で実行し、stderr と plan を結果へ保存する。

### 15.3 UI

- 字幕 track を language/title/codec/forced 付きで選択可能にする。
- text と bitmap で設定項目を切り替える。
- bitmap では font/色設定を disable し、その理由を表示する。
- style preview は実際の FFmpeg/libass と同じ同梱 font を使う。ブラウザ CSS だけの preview は最終出力と一致しないことを明記する。
- HDR 入力では対応 profile 以外を警告または拒否する。
- 「字幕焼き込みにより映像は再エンコードされる」を estimate 前に表示する。

### 15.4 セキュリティと堅牢性

- 字幕、font、container は非信頼入力として扱い、FFmpeg/libass を更新可能にする。
- font 数、字幕ファイルサイズ、event 数、解像度、同時 layer 数に現実的な上限を設ける。
- network protocol を入力 path として許可しない。ローカルで確認済みのファイルだけを渡す。
- filtergraph へ利用者文字列を無加工で挿入しない。
- 一時ファイルはジョブ専用ディレクトリに置き、成功/失敗/キャンセル時に安全に回収する。
- 出力は partial file へ書き、検証後に確定名へ置換する。

## 16. 採用基準チェックリスト

- [ ] 実 FFmpeg に `subtitles` / `ass` / 必要 decoder がある
- [ ] 対象 track を `ffprobe` 結果から明示選択した
- [ ] text / bitmap の経路を分けた
- [ ] ハードサブ時に video stream copy を禁止した
- [ ] scale/crop/rotation/tone-map と burn の順序を確定した
- [ ] font と glyph coverage を固定・確認した
- [ ] charset と Unicode 改行方針を確定した
- [ ] seek/offset/clip の PTS を境界 frame で検証した
- [ ] pixel format、range、matrix、transfer、primaries を確認した
- [ ] HDR は検証済み profile または SDR tone-map に限定した
- [ ] hardware 経路の download/upload cost を測定した
- [ ] mapping により音声・字幕・metadata の出力を明示した
- [ ] 特殊パスの escaping テストを通した
- [ ] cancel と partial output cleanup を検証した

## 17. 一次資料

- [FFmpeg Filters Documentation — `subtitles`](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1)
- [FFmpeg Filters Documentation — `ass`](https://ffmpeg.org/ffmpeg-filters.html#ass)
- [FFmpeg Filters Documentation — framesync](https://ffmpeg.org/ffmpeg-filters.html#Options-for-filters-with-several-inputs-_0028framesync_0029)
- [FFmpeg Documentation — stream selection / mapping](https://ffmpeg.org/ffmpeg.html#Stream-selection)
- [FFmpeg Documentation — advanced subtitle options](https://ffmpeg.org/ffmpeg.html#Advanced-Subtitle-options)
- [FFmpeg Codecs Documentation — subtitle decoders](https://ffmpeg.org/ffmpeg-codecs.html#Subtitles-Decoders)
- [FFmpeg General Documentation — subtitle formats](https://ffmpeg.org/general.html#Subtitle-Formats)
- [FFmpeg Utilities Documentation — quoting and escaping](https://ffmpeg.org/ffmpeg-utils.html#Quoting-and-escaping)
- [FFmpeg `vf_subtitles.c` current source](https://ffmpeg.org/doxygen/trunk/vf__subtitles_8c_source.html)
- [libass project](https://github.com/libass/libass)
- [libass ASS File Format Guide](https://github.com/libass/libass/wiki/ASS-File-Format-Guide)

## 18. 仕様上の非保証事項

- FFmpeg は継続開発されており、filter option、format negotiation、subtitle frame 対応は版により変わる。
- libass は VSFilter と「mostly compatible」であり、全 renderer の pixel-perfect 一致を保証しない。
- SRT/WebVTT/TTML → ASS 変換は元形式の全 semantics と CSS を完全には保存しない。
- OS font fallback は同じ family 名でも版・platform により glyph と metrics が変わる。
- HDR 字幕の知覚輝度は `subtitles` の単一 option では規定できない。
- hardware acceleration の可否と速度は GPU、driver、FFmpeg build、filtergraph に依存する。

したがって、SongCut の機能保証は「対応 FFmpeg build + 同梱 font + 明示した render profile + E2E fixture」の組として定義する。

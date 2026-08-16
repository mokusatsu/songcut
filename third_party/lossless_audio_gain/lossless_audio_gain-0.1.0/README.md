# lossless-audio-gain

AAC／Opus の圧縮音声を再エンコードせず、デコード時の音量だけ変更する Python モジュールです。

- 自動モード：入力の True Peak を測定し、既定 `-1.0 dBTP` 以下になるゲインを算出・適用
- 指定モード：入力 True Peak を測らず、指定ゲインを量子化・適用。既定では適用倍率の一様性だけを検証
- Opus：Ogg 内の `OpusHead.Output Gain` を変更
- AAC：MP4/M4A 内の AAC-LC フレームの `global_gain` を変更
- 高水準 API は、出力先と入力元が同一でも一時ファイルから原子的に置換

## 対応範囲

| コーデック | 対応形式 | ゲイン分解能 | 必要な外部ツール |
|---|---|---:|---|
| Opus | Ogg Opus、単一論理ストリーム | `1/256 dB` | `verify=False` の指定モードのみ不要。測定／検証時は FFmpeg |
| AAC | MP4／M4A／MOV 内の AAC-LC、mono／stereo、単一音声ストリーム | 約 `1.505149978 dB/step` | `ffprobe` と `mp3rgain`。測定／検証時は FFmpeg |

現版は次を意図的に拒否します。

- WebM／MKA 内の Opus
- raw ADTS AAC
- HE-AAC／HE-AAC v2／xHE-AAC
- 3 チャンネル以上の AAC
- 複数音声ストリームを持つファイル

AAC の制限は、未知の構成を一部だけ書き換えて成功扱いすることを避けるためです。一般的な YouTube 投稿用 AAC-LC stereo M4A は対象です。

## 「無劣化」の定義

ここでいう無劣化は、デコード後の PCM を再圧縮しないことです。

### Ogg Opus

`OpusHead` の signed Q7.8 Output Gain だけを加算し、影響した Ogg ページの CRC を再計算します。Opus 音声パケットはバイト単位で不変です。

入力 Ogg について、全ページの CRC、ページシーケンス、packet continuation、BOS／EOS、`OpusHead` の位置を検証してから変更します。

### AAC-LC

外部バックエンド `mp3rgain` を使い、各 AAC フレームの `global_gain` を整数ステップで変更します。量子化済みスペクトルを再生成しません。

既定では、変更後ファイルのコピーへ逆ゲインを適用し、MP4 の全 `mdat` payload が元と SHA-256 単位で完全一致することを確認します。これにより `global_gain=0`／`255` への飽和を成功扱いしません。変更・逆変換・検査は呼び出し元ファイルとは別の一時コピーで行い、全検査成功後だけ原子的に置換します。

`mp3rgain` の undo metadata は既定で保存します。不要なら `aac_write_undo=False` または `--no-aac-undo` を指定します。

## 自動モードの処理

1. `ffprobe` または Ogg 内部解析で、対象形式・ストリーム数・AAC profile を検証
2. FFmpeg `loudnorm` の解析パスで入力 True Peak を測定
3. `target_true_peak_dbtp - measured_true_peak_dbtp` を必要ゲインとして計算
4. Opus は `1/256 dB`、AAC は `global_gain` の整数ステップへ安全側に切り下げ
5. 一時コピーへ再エンコードなしで変更
6. 既定では、入力波形×期待倍率と出力波形を FFmpeg `apsnr` で比較
7. 出力 True Peak を再測定し、ターゲット＋許容差を超えないことを確認
8. 検証に成功した一時ファイルだけを出力先へ原子的に置換

AAC は 1 step が大きいため、True Peak がターゲットを超えない側へ丸めると最大約 1.505 dB 余分に低くなる場合があります。たとえば入力が `-0.90 dBTP`、ターゲットが `-1.00 dBTP` なら、必要な `-0.10 dB` は表現できず、`-1 step` が適用されます。

## 必要環境

- Python 3.10 以上
- FFmpeg／ffprobe
  - 自動モードには FFmpeg
  - AAC の安全な形式判定には ffprobe
  - 指定モードの既定の decoded-gain 検証にも FFmpeg。`verify=False`／`--no-verify` なら省略可能
- mp3rgain 3.2.0 以上
  - AAC の `global_gain` 変更に使用
  - `-o json` の結果を解析し、要求 step がそのまま適用されたことを確認

`mp3rgain` が PATH にない場合は、`MP3RGAIN_BIN` 環境変数、API の `mp3rgain_bin`、または CLI の `--mp3rgain` で実行ファイルを指定できます。

## インストール

ソースディレクトリから：

```bash
python -m pip install ./lossless_audio_gain
```

wheel から：

```bash
python -m pip install lossless_audio_gain-0.1.0-py3-none-any.whl
```

## Python API

### 自動モード

```python
from lossless_audio_gain import normalize_true_peak

result = normalize_true_peak(
    "input.opus",
    "output.opus",
    target_true_peak_dbtp=-1.0,
    verify=True,
)

print(result.applied_gain_db)
print(result.verified_true_peak_dbtp)
print(result.to_dict())
```

AAC も同じ API です。

```python
result = normalize_true_peak(
    "input.m4a",
    "output.m4a",
    target_true_peak_dbtp=-1.0,
    mp3rgain_bin="/path/to/mp3rgain",
)
```

主なパラメータ：

| パラメータ | 既定 | 意味 |
|---|---:|---|
| `target_true_peak_dbtp` | `-1.0` | 自動モードの True Peak ceiling |
| `verify` | `True` | decoded gain の APSNR 比較と出力 True Peak 再測定。自動／指定の両モードで既定有効 |
| `verification_tolerance_db` | `0.08` | 出力 True Peak 判定の測定許容差 |
| `gain_verification_min_psnr_db` | `90.0` | 期待倍率波形と出力波形の最低 APSNR |
| `aac_check_reversible` | `True` | AAC の forward／inverse `mdat` 完全一致確認 |
| `aac_write_undo` | `True` | mp3rgain undo metadata の保存 |
| `r128_policy` | `"neutralize"` | Opus R128 gain tag の扱い |

### 指定モード

```python
from lossless_audio_gain import adjust_gain

result = adjust_gain(
    "input.m4a",
    "output.m4a",
    gain_db=-3.0,
    aac_rounding="nearest",
    verify=True,  # 既定。入力 True Peak は測らず、倍率の一様性を検証
)
```

指定モードは入力 True Peak を測定しません。既定の `verify=True` では、期待倍率との decoded waveform 比較と、変更後 True Peak の測定だけを行います。処理時間を優先して `verify=False` にできますが、AAC バックエンドが未対応フレームを局所的に変更しなかった場合を検出できなくなるため、通常は既定値を推奨します。

AAC の丸め方：

- `nearest`：最も近い整数 step。指定モードの既定
- `not_above`：適用ゲインが指定値を上回らないよう floor
- `toward_zero`：0 方向へ切り捨て

例として `gain_db=-3.0` は `-2 step`、実際には約 `-3.010299957 dB` になります。

### True Peak 測定だけ行う

```python
from lossless_audio_gain import measure_true_peak

true_peak_dbtp = measure_true_peak("input.opus")
print(true_peak_dbtp)
```

## CLI

```bash
# 自動：既定 -1.0 dBTP
lossless-audio-gain auto input.opus output.opus

# ターゲット変更
lossless-audio-gain auto input.m4a output.m4a --target -2.0

# 指定ゲイン
lossless-audio-gain gain input.opus output.opus --gain -3.25
lossless-audio-gain gain input.m4a output.m4a --gain -3.0 --aac-rounding nearest

# 指定モードは既定で decoded gain を検証。省略する場合だけ明示
lossless-audio-gain gain input.m4a output.m4a --gain -3.0 --no-verify

# 測定／構造確認
lossless-audio-gain measure input.opus --json
lossless-audio-gain inspect input.m4a --json
```

AAC の補助オプション：

```bash
--mp3rgain /path/to/mp3rgain
--no-aac-undo
--no-aac-reversibility-check
--gain-verify-psnr 90
```

## Opus の R128 tag

Output Gain を変更するとき、`R128_TRACK_GAIN`／`R128_ALBUM_GAIN` を残すと、対応プレイヤーが追加ゲインとして扱う可能性があります。

- `neutralize`：タグ名先頭を `R` から `X` に変え、Ogg packet 長を変えずに標準タグとして無効化。既定
- `keep`：残す。結果に警告を格納
- `error`：タグがあれば処理中止

ゲイン delta が 0 の場合はタグを変更せず、出力はバイト単位で入力と同一です。

## 結果オブジェクト

`GainResult` には次が含まれます。

- 要求ゲインと実適用ゲイン
- 入力／予測／検証後 True Peak
- 量子化誤差
- 使用 backend
- Opus の変更前後 Output Gain、CRC 再計算ページ数
- AAC の step 数、変更 field 数、reversibility check の有無
- decoded gain verification の channel 別 APSNR
- 警告

`to_dict()` は非有限値を文字列化し、strict JSON として保存できます。

## YouTube へのアップロード

AAC `global_gain` は AAC 復号処理そのものへ作用します。Opus Output Gain も Opus のデコード時ゲインです。そのため、通常の「デコードして別形式へ再エンコードする」取り込みでは音量へ反映される設計です。

ただし、YouTube の内部アップロード処理が各入力フィールドをどう扱うかは公開契約ではありません。重要な公開物では、限定公開アップロード後に YouTube 側のトランスコード音声を測定して最終確認してください。本モジュールの `verified_true_peak_dbtp` はローカル FFmpeg デコード時の値です。

## テスト

```bash
python -m pip install pytest
pytest -q
```

テストには次を含みます。

- Q7.8／AAC step 量子化
- Ogg CRC、sequence、R128 tag 処理
- 実 Ogg Opus を使った True Peak normalization
- FFmpeg APSNR decoded-gain verification
- AAC backend JSON 契約と non-zero 変更件数の確認
- AAC forward／inverse `mdat` hash check と失敗時の原本不変性
- AAC-LC MP4／raw ADTS／複数音声 stream の形式判定

実際の AAC `global_gain` 統合試験には、別途 `mp3rgain` バイナリが必要です。

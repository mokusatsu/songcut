# CLI

Python CLI は開発、自動化、診断、回帰確認向けに残しています。このリポジトリの主な
配布対象はデスクトップ GUI と Windows ポータブルパッケージです。GUI の概要は
`README.md`、セットアップとビルド手順は `docs/BUILD.ja.md` を参照してください。

まずソースからパッケージをインストールします。

```powershell
python -m pip install -e ".[dev]"
```

インストール後は console script から実行できます。

```powershell
songcut --version
```

または module entry point からも実行できます。

```powershell
python -m songcut.cli --version
```

## 解析

ローカル動画を解析します。

```powershell
python -m songcut.cli analyze path\to\input.mp4 --out out --review
```

`--review` は `segments.json` の隣に `review.html` を出力します。別の場所へ出力
したい場合は `--review-out path\review.html` を使います。

ガイドテキスト付きの解析では、生の検出結果とガイド反映後のセグメントを両方出力
します。

```powershell
python -m songcut.cli analyze path\to\input.mp4 --out out --guide path\to\input.guide.txt --review
```

このコマンドは `out\segments.json`、`out\guided_segments.json`、ガイド反映後の
`out\review.html` を出力します。

メタデータ内のタイムスタンプではなく音響検出を強制する場合は次を使います。

```powershell
python -m songcut.cli analyze path\to\input.mp4 --timestamp-source acoustic --out out-acoustic
```

既定の解析 profile は `intel-258v` です。ハードウェア向けの既定値を明示する場合は
次のように指定できます。

```powershell
python -m songcut.cli analyze path\to\input.mp4 --profile intel-258v --device auto --out out
```

`--device auto` が通常の経路です。OpenVINO デバイスの利用可否を記録し、互換性のある
歌唱検出モデルが設定されていない場合は現在の DSP baseline を使います。
`--device npu` と `--device gpu` は厳密なチェックで、要求したデバイスが使えない場合に
失敗します。

## 評価とレビュー

既存の `segments.json` を正解タイムスタンプと比較します。

```powershell
python -m songcut.cli evaluate out\segments.json --truth path\to\timestamps.txt
```

既存の `segments.json` から軽量なレビュー HTML を生成します。

```powershell
python -m songcut.cli review out\segments.json --video path\to\input.mp4 --out out\review.html
```

## 書き出し

クリップを書き出します。

```powershell
python -m songcut.cli export out\segments.json --source path\to\input.mp4 --out clips
```

既定では smart rendering を使います。keyframe を調べ、指定範囲に完全に含まれる
GOP はコピーし、境界の GOP は推定ソース映像ビットレートの 1.5 倍で再エンコード
します。H.264 と AV1 の MP4/MOV 入力は `.mp4`、VP8/VP9/AV1 の WebM 入力は
`.webm`、H.264/VP8/VP9/AV1 の MKV 入力は `.mkv` として出力します。未対応 codec
では full re-encode にフォールバックします。

先頭の 1 クリップだけを stream copy で smoke test します。

```powershell
python -m songcut.cli export out\segments.json --source path\to\input.mp4 --out clips --mode copy --limit 1
```

従来の full accurate encode を明示的に使う場合は次を指定します。

```powershell
python -m songcut.cli export out\segments.json --source path\to\input.mp4 --out clips --mode accurate
```

ガイドテキスト付きで書き出します。

```powershell
python -m songcut.cli export out\segments.json --source path\to\input.mp4 --out clips --guide path\to\input.guide.txt
```

ガイド行は `80:45 Title` と `1:20:45 Title` のどちらの形式も使えます。タイムスタンプが
1 つだけの行は、ガイドの時刻を開始時刻にし、近くの検出セグメントの終了時刻を使い
ます。`0:10:00 Title 0:13:30` のように複数のタイムスタンプを含む行は、明示的な
書き出し範囲として扱います。出力ファイル名は、タイムスタンプタグを取り除いた
ガイドタイトルから生成されます。

## デバイス診断

ffmpeg と OpenVINO デバイスの診断情報を表示します。

```powershell
python -m songcut.cli devices
```

`--device auto` は OpenVINO が入っている場合に利用可能デバイスを記録し、OpenVINO
singing model が設定されていない限り現在の DSP baseline を使います。`--device npu`
と `--device gpu` は厳密なチェックで、要求したデバイスが利用できない場合は即座に
失敗します。

各解析結果の `segments.json` には、`profile`、`timestamp_source`、`model_versions`、
`backend`、`device_requested`、`device_used`、`available_devices`、`fallbacks`、
`ffmpeg_path`、`ffprobe_path` などの診断フィールドを記録します。

## メモ

NumPy detector は依存の少ない baseline であり、AudioSet/OpenVINO singing classifier
を置き換えるものではありません。OpenVINO や ONNX model がまだ入っていない環境でも
動作する経路を提供するためのものです。`segments.json` には backend と model の
メタデータを保持しているため、CLI contract を変えずに DSP scoring stage を
OpenVINO NPU model に差し替えられるようになっています。

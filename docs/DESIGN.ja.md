# 設計

この文書は、README から分離した実装・設計寄りの概要です。利用者向けの入口は
`README.md`、CLI の詳しい使い方は `docs/CLI.ja.md`、ビルド手順は
`docs/BUILD.ja.md` を参照してください。

## デスクトップ GUI

GUI は `gui/` にあり、Electron + React + Vite を使っています。開発時は Electron が
Python REST API を起動し、localhost 経由で通信できます。ポータブル配布物では、
トップレベルの Python launcher が先に API を起動し、その後 Electron を管理対象の
子プロセスとして起動します。renderer はネイティブのファイル選択ダイアログと
動画ファイルのドラッグアンドドロップに対応しています。

ポータブルパッケージの入口は、パッケージルートの `songcut.exe` です。ffmpeg の同梱
は任意です。アプリはパッケージルート配下を再帰的に探して対応する
`ffmpeg.exe` / `ffprobe.exe` の組を見つけ、見つからなければ `PATH` にフォールバック
します。

GUI 固有の Python 依存は `songcut[gui]` extra にまとめています。Whisper は既定で
事前変換済みの OpenVINO `OpenVINO/whisper-small-fp16-ov` モデルを使い、GUI の文字
起こし経路では `NPU -> GPU -> CPU` の優先度で実行します。

作業中の詳細な GUI 仕様は `docs/gui-spec.md` にあります。

## ハードウェアと実行時方針

初期の最適化対象は、現在も Core Ultra 7 258V / Lunar Lake 世代の Windows 環境です。
ローカル推論の主経路は OpenVINO とし、Vulkan は v1 の主経路にはしません。

固定 shape の互換モデルでは、自動デバイス選択は OpenVINO の `NPU -> GPU -> CPU`
を優先します。厳密なデバイス指定の意味は現在の CLI/API と同じです。`--device npu`
と `--device gpu` は要求デバイスが使えない場合に失敗し、通常利用では
`--device auto` を使います。歌唱検出モデルが設定されるまでは NumPy DSP baseline
を使い、OpenVINO デバイスの検出結果と fallback 診断を記録します。

Demucs のような重い音源分離は v1 の必須経路から外します。後で追加する場合も、
録画全体の前処理ではなく、候補区間だけに適用する高精度オプションとして扱います。

## 検出とデータ契約

NumPy detector は依存の少ない baseline であり、AudioSet/OpenVINO singing classifier
を置き換えるものではありません。OpenVINO や ONNX model がまだ入っていない環境でも
動作する経路を提供するためのものです。`segments.json` には backend と model の
メタデータを保持しているため、セグメントデータの互換性を保ったまま DSP scoring
stage を OpenVINO NPU model に差し替えられるようになっています。

既定の解析 profile は `intel-258v` です。`segments.json` は安定した解析データ交換
形式で、編集可能な segments と frame scores に加えて、`schema_version`、
`profile`、`timestamp_source`、`model_versions`、`backend`、`device_requested`、
`device_used`、`available_devices`、`fallbacks`、`backend_note`、`ffmpeg_path`、
`ffprobe_path`、`created_by`、`elapsed_seconds` を記録します。

検出アルゴリズムの詳細は `docs/algorithm.md` を参照してください。

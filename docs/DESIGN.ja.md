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

## 検出とデータ契約

NumPy detector は依存の少ない baseline であり、AudioSet/OpenVINO singing classifier
を置き換えるものではありません。OpenVINO や ONNX model がまだ入っていない環境でも
動作する経路を提供するためのものです。`segments.json` には backend と model の
メタデータを保持しているため、セグメントデータの互換性を保ったまま DSP scoring
stage を OpenVINO NPU model に差し替えられるようになっています。

検出アルゴリズムの詳細は `docs/algorithm.md` を参照してください。

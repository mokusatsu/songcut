songcut portable package

Run:
  songcut.exe

Contents:
  songcut.exe          Python launcher and only user-facing entry point
  runtime\             Python runtime files for the launcher
  app\                 Electron application files
  electron\            Electron runtime, with songcut-electron.exe as the GUI shell
  third_party\ffmpeg\  optional bundled ffmpeg and ffprobe
  models\              bundled Whisper, Demucs, and MMS Q4 analysis models
  logs\                launcher and GUI process logs

songcut.exe starts the local Python API, then starts Electron as its child
process. ffmpeg.exe and ffprobe.exe are discovered by recursively searching this
package folder first, then by searching PATH. Keep these folders together when
moving this package.

Downloaded Whisper, Demucs, and MMS models, the Hugging Face cache, and the
OpenVINO cache are written under %LOCALAPPDATA%\songcut. The package folder is
treated as read-only. The GUI never downloads a model unless you explicitly
choose it. To make a lightweight distribution manually, remove the unwanted
subdirectories under models\. Missing models can be restored from Settings.

songcut portable package

Run:
  Start-Songcut.bat

Contents:
  app\                 Electron application files
  electron\            Electron runtime, with songcut.exe as the launcher
  backend\songcut-api\ PyInstaller-built Python REST API
  third_party\ffmpeg\  bundled ffmpeg and ffprobe
  models\              bundled OpenVINO Whisper small model
  ov-cache\            OpenVINO runtime cache
  hf-home\             Hugging Face cache used only if a model download is needed

The batch file sets the required environment variables and launches the GUI.
Keep these folders together when moving this package.

# Design

This document contains implementation and design notes split out of
`README.md`. For the user-facing entry point, see `README.md`; for detailed CLI
usage, see `docs/CLI.md`; for build instructions, see `docs/BUILD.md`.

## Desktop GUI

The GUI lives in `gui/` and uses Electron + React + Vite. In development,
Electron can launch the Python REST API and talk to it over localhost. In the
portable distribution, the top-level Python launcher starts the API first, then
starts Electron as a managed child process. The renderer supports both a native
file-open dialog and drag-and-drop video loading.

The portable package entry point is `songcut.exe` at the package root. Packaged
ffmpeg is optional: the app searches the package root recursively for a matching
`ffmpeg.exe`/`ffprobe.exe` pair, then falls back to `PATH`.

GUI-specific Python dependencies are grouped under `songcut[gui]`. Whisper uses
the pre-converted OpenVINO `OpenVINO/whisper-small-fp16-ov` download by default,
with runtime priority `NPU -> GPU -> CPU` for the GUI transcription path.

The detailed working GUI specification is in `docs/gui-spec.md`.

## Hardware And Runtime Policy

The initial optimization target remains Core Ultra 7 258V/Lunar Lake-class
Windows hardware. Local inference should be OpenVINO-first; Vulkan is not a
primary runtime path for v1.

For compatible fixed-shape models, automatic device selection should prefer
OpenVINO `NPU -> GPU -> CPU`. Strict device requests keep their current meaning:
`--device npu` and `--device gpu` fail if the requested device is unavailable,
while `--device auto` is the normal user path. Until a singing model is
configured, the app uses the NumPy DSP baseline and records OpenVINO device
availability and fallback diagnostics.

Heavy source separation such as Demucs is outside the required v1 path. If added
later, it should be an optional high-accuracy pass over candidate ranges rather
than a required full-recording preprocessing step.

## Detection And Data Contract

The NumPy detector is a dependency-light baseline, not a replacement for an
AudioSet/OpenVINO singing classifier. It provides a working path on machines
that do not yet have OpenVINO or ONNX models installed. The code keeps backend
and model metadata in `segments.json` so an OpenVINO NPU model can replace the
DSP scoring stage without changing the segment data contract.

The default analysis profile is `intel-258v`. `segments.json` is the stable
analysis interchange and records, alongside editable segments and frame scores,
`schema_version`, `profile`, `timestamp_source`, `model_versions`, `backend`,
`device_requested`, `device_used`, `available_devices`, `fallbacks`,
`backend_note`, `ffmpeg_path`, `ffprobe_path`, `created_by`, and
`elapsed_seconds`.

Detection algorithm details are in `docs/algorithm.md`.

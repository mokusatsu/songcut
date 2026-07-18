# songcut

`songcut` extracts likely singing segments from VSinger singing-stream archives.

The default profile targets an Intel Core Ultra 7 258V style local machine:

- Prefer authored set-list timestamps in the video metadata when they exist.
- Fall back to a local NumPy DSP detector when timestamps are unavailable.
- Detect OpenVINO devices when OpenVINO is installed, with intended priority `NPU -> GPU -> CPU`.
- Use the bundled `third_party/ffmpeg/bin/ffmpeg.exe` and `ffprobe.exe`.

## Usage

Run from anywhere by calling the wrapper script directly:

```powershell
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe C:\dev\songcut\songcut_cli.py analyze testdata\input.mp4 --out out --review
```

The package form also works when the repository is the current directory:

```powershell
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m songcut.cli analyze testdata\input.mp4 --out out --review
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m songcut.cli evaluate out\segments.json --truth testdata\timestamps.txt
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m songcut.cli review out\segments.json --video testdata\input.mp4 --out out\review.html
```

`--review` writes `review.html` next to `segments.json`. Use `--review-out path\review.html` to choose a different location.

Guide-aware analysis writes both raw detections and guide-adjusted segments:

```powershell
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe C:\dev\songcut\songcut_cli.py analyze testdata\input.mp4 --out out --guide testdata\input.guide.txt --review
```

This writes `out\segments.json`, `out\guided_segments.json`, and a guide-adjusted `out\review.html`.

Force the acoustic detector instead of metadata timestamps:

```powershell
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m songcut.cli analyze testdata\input.mp4 --timestamp-source acoustic --out out-acoustic
```

Export clips:

```powershell
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m songcut.cli export out\segments.json --source testdata\input.mp4 --out clips
```

Export uses smart rendering by default. It probes keyframes, copies GOPs that are fully inside the requested range, and re-encodes the boundary GOPs at an estimated source video bitrate multiplied by 1.5. H.264 and AV1 MP4/MOV sources are written as `.mp4`; VP8/VP9/AV1 WebM sources are written as `.webm`; unsupported codecs fall back to full re-encode.

Smoke-test only the first clip with stream copy:

```powershell
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m songcut.cli export out\segments.json --source testdata\input.mp4 --out clips --mode copy --limit 1
```

Use the legacy full accurate encode explicitly:

```powershell
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m songcut.cli export out\segments.json --source testdata\input.mp4 --out clips --mode accurate
```

Export with a guide text:

```powershell
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m songcut.cli export out\segments.json --source testdata\input.mp4 --out clips --guide testdata\input.guide.txt
```

Guide lines may use either `80:45 Title` or `1:20:45 Title`. A line with one timestamp starts exactly at the guide timestamp and uses the end of the nearby detected segment. A line with multiple timestamps, such as `0:10:00 Title 0:13:30`, is treated as the explicit export range. Output filenames are derived from the guide title text after removing timestamp tags.

## Desktop GUI

The GUI lives in `gui/` and uses Electron + React + Vite. Electron launches the
Python REST API and talks to it over localhost. The renderer supports both a
native file-open dialog and drag-and-drop video loading.

Install frontend dependencies from `gui/`, then run:

```powershell
cd gui
pnpm install
$env:SONGCUT_PYTHON="C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$env:SONGCUT_REPO_ROOT="C:\dev\songcut"
pnpm run dev
pnpm run electron:dev
```

The backend API entry point is:

```powershell
C:\Users\lain\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m songcut.api --host 127.0.0.1 --port 8765
```

GUI-specific Python dependencies are grouped under `songcut[gui]`. Whisper uses
the pre-converted OpenVINO `OpenVINO/whisper-small-fp16-ov` download by default,
with runtime priority `NPU -> GPU -> CPU` for the GUI transcription path.

The detailed working GUI specification is in `docs/gui-spec.md`.

## Device behavior

`--device auto` records available OpenVINO devices when OpenVINO is installed, then uses the current DSP baseline unless an OpenVINO singing model is configured. `--device npu` and `--device gpu` are strict checks: they fail fast when the requested device is unavailable.

## Verified fixture

With the provided `testdata` video, the default `auto` timestamp source uses authored set-list timestamps embedded in the video metadata and matches the companion truth file exactly:

- precision: `1.0`
- recall: `1.0`
- median boundary error: `0.0s`
- detected segments: `12`

## Notes

The NumPy detector is a dependency-light baseline, not a replacement for an AudioSet/OpenVINO singing classifier. It provides a working path on machines that do not yet have OpenVINO or ONNX models installed. The code keeps backend and model metadata in `segments.json` so an OpenVINO NPU model can replace the DSP scoring stage without changing the CLI contract.

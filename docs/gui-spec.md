# songcut GUI specification

This document is the working specification for the desktop GUI that wraps the
existing songcut CLI pipeline.

## Product scope

- Target platform for v1: Windows desktop.
- App shell: Electron + React + Vite.
- UI component style: local shadcn/ui-inspired primitives.
- Backend: Python FastAPI REST server launched by the Electron main process.
- Packaged backend: PyInstaller executable named `songcut-api.exe` is the target
  packaging shape, while development runs `python -m songcut.api`.
- Deno Desktop was evaluated first, but Electron is the v1 choice because native
  file path access and drag-and-drop are core requirements.

## Process model

1. Electron starts.
2. Electron finds a free localhost port.
3. Electron launches the Python API process with that port.
4. The renderer asks the preload bridge for the REST base URL.
5. The renderer calls REST endpoints for probing, analysis, model download, and
   export.
6. Long-running work is represented as jobs. The renderer polls `/jobs/{id}`.

Development environment variables:

- `SONGCUT_PYTHON`: Python executable to use instead of `python`.
- `SONGCUT_REPO_ROOT`: repository root to use as the API working directory.
- `SONGCUT_API_EXE`: packaged backend executable to use instead of Python.
- `SONGCUT_MODEL_DIR`: root directory for downloaded OpenVINO Whisper models.

## Main screen layout

- The screen is split vertically.
- The top pane is the video pane.
- The bottom pane is the operation pane.
- The boundary between panes is draggable.
- Video uses `object-fit: contain` so it always preserves aspect ratio.
- The operation pane contains, from top to bottom:
  1. Primary toolbar.
  2. Guide text textarea and status/progress panel.
  3. Waveform timeline.
  4. Segment timeline for the selected segment.
  5. Segment list.

## File loading

- `Load` opens a native Electron file dialog.
- Supported video extensions in the dialog and drop filter:
  `mp4`, `mkv`, `mov`, `webm`, `avi`, `m4v`, `mpg`, `mpeg`.
- Drag-and-drop is supported for video files.
- D&D uses the Electron preload bridge and `webUtils.getPathForFile(file)` to
  obtain the native path.
- After loading, the app probes duration, bitrate, video stream, and audio stream
  through ffprobe.

## Guide text

- v1 provides one large textarea instead of multiple independent text fields.
- If the textarea is empty, analysis and export candidates are built only from
  detected segments.
- If guide text is present, songcut parses it with the same guide parser used by
  the CLI and uses it to create export candidate titles and filename stems.
- Segment timing remains editable independently of the original transcription.

## Analysis

- `Analyze` starts a backend job.
- The job first runs the existing singing segment pipeline.
- Timestamp source behavior:
  - `auto`: use authored metadata ranges when available.
  - If metadata is unavailable, fall back to acoustic DSP detection.
- After segment detection, the analysis job returns immediately with editable
  segments and export candidates.
- If transcription is enabled, a separate background transcription job is started
  and the GUI attaches transcript text to segments as results arrive.
- All detected segments are checked for export by default.
- When guide text is present, the GUI segment list is built from the same
  guide-matching result used by the CLI guided analysis path, while raw detected
  segments remain available in the analysis payload for diagnostics.

## Whisper

- Model: `openai/whisper-small`.
- First startup/download behavior:
  - The default path downloads the pre-converted OpenVINO model
    `OpenVINO/whisper-small-fp16-ov`.
  - If `optimum-cli` is present, the backend can instead export
    `openai/whisper-small` locally.
  - Model files are stored under `%LOCALAPPDATA%\songcut\models` by default,
    or under `SONGCUT_MODEL_DIR` when set.
- Runtime: OpenVINO GenAI `WhisperPipeline`.
- Auto device priority: `NPU -> GPU -> CPU`.
- Strict device modes:
  - `npu`: fail if NPU is unavailable.
  - `gpu`: fail if GPU is unavailable.
  - `cpu`: force CPU.
- Default language token for v1: `<|ja|>`.
- If OpenVINO GenAI or the model is unavailable, the segment keeps an error field
  instead of blocking the whole analysis result.

## Timelines

- The waveform timeline and segment timeline share one zoom state.
- Zoom levels are `100%`, `200%`, `400%`, `800%`, `1600%`, `3200%`.
- Zoom controls:
  - minus: previous zoom level.
  - percentage button: reset to 100%.
  - plus: next zoom level.
- On zoom and playback updates, each timeline scrolls so the playback cursor is
  centered when possible.
- Clicking the waveform timeline seeks the video to that position.
- The waveform timeline is fixed to the full detected waveform view, with
  detected segments shown as overlays.
- The segment timeline reflects the selected segment.
- The selected segment start and end marks are draggable.
- Dragging start/end only changes the segment export range in the GUI state.
- Transcription text is not recalculated when the user edits start/end.

## Playback controls

Toolbar controls:

- Start: seek to 0.
- Previous boundary: jump to the nearest segment start/end before the playback
  cursor.
- Play.
- Pause.
- Next boundary: jump to the nearest segment start/end after the playback cursor.

## Segment list

- Each row represents one detected segment.
- Clicking a row selects it and seeks to its start.
- Each row has an export checkbox.
- Checkboxes are checked by default.
- Unchecked rows are not included in the export request.
- The transcript button opens a dialog with the stored transcript text or
  transcript error.

## Export review

- Pressing `Export` opens an export review dialog.
- The dialog lists only checked export items.
- Clicking an item previews its range in the video pane.
- Preview behavior:
  - If the range is less than or equal to 10 seconds, play the full range once.
  - If the range is longer than 10 seconds, play the first 5 seconds, then jump
    to the last 5 seconds and play that tail.
- Confirming export opens a native output directory dialog, then starts the
  backend export job.

## Smart render export contract

Intended final behavior:

- Use ffprobe to detect keyframe positions around each output range.
- GOPs fully inside the requested range should be stream-copied without quality
  loss.
- Edge GOPs that cross the start/end boundary should be re-encoded.
- Re-encode video bitrate should be estimated from the source bitrate and set to
  1.5x.

Current implementation state:

- The backend already probes keyframes and returns a GOP plan.
- The current exporter performs a single high-quality re-encode at 1.5x source
  bitrate.
- The lossless-middle GOP concat implementation is still a follow-up item.

## REST API

- `GET /health`
  - Verifies API availability and returns ffmpeg paths.
- `GET /devices`
  - Returns singing backend and Whisper device availability.
- `GET /models/whisper`
  - Returns model path, readiness, and selected runtime information.
- `POST /models/whisper/download`
  - Starts first-run Whisper OpenVINO export/download.
- `POST /videos/probe`
  - Returns duration, bitrate, and stream metadata.
- `POST /analysis/jobs`
  - Starts singing detection and optionally starts a background transcription
    job. The analysis result may include `transcription_job_id`.
- `POST /export/jobs`
  - Starts export for checked items.
- `GET /jobs/{job_id}`
  - Returns job status, progress, result, or error.

## Open questions for later UX polish

- Whether GUI labels should be Japanese, English, or switchable.
- Whether guide-derived export candidates should be editable separately from
  detected segment rows.
- Whether the output dialog should allow final per-item checkbox changes.
- Whether Whisper should support explicit language selection beyond Japanese.
- Whether output filenames need conflict-resolution UI before export.

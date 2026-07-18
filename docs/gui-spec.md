# songcut GUI specification

This document is the working specification for the desktop GUI that wraps the
existing songcut CLI pipeline.

## Product scope

- Target platform for v1: Windows desktop.
- App shell: Electron + React + Vite.
- UI component style: local shadcn/ui-inspired primitives.
- Backend: Python FastAPI REST server.
- Packaged backend: a top-level PyInstaller `songcut.exe` Python launcher starts
  the API in-process, then starts Electron as its child process. Development can
  still run `python -m songcut.api` or let Electron launch the API.
- Deno Desktop was evaluated first, but Electron is the v1 choice because native
  file path access and drag-and-drop are core requirements.

## Process model

Packaged process model:

1. Top-level `songcut.exe` starts.
2. The Python launcher finds a free localhost port and starts the API on it.
3. The Python launcher starts `electron/songcut-electron.exe` with
   `SONGCUT_API_BASE_URL`.
4. Electron uses the provided API URL instead of launching another backend.
5. The renderer asks the preload bridge for the REST base URL.
6. The renderer calls REST endpoints for probing, analysis, model download, and
   export.
7. Long-running work is represented as jobs. The renderer polls `/jobs/{id}`.
8. If the user closes the window while a job is queued or running, the renderer
   shows a quit confirmation dialog. Confirming quits the whole app.

Development environment variables:

- `SONGCUT_PYTHON`: Python executable to use instead of `python`.
- `SONGCUT_REPO_ROOT`: repository root to use as the API working directory.
- `SONGCUT_API_EXE`: packaged backend executable to use instead of Python.
- `SONGCUT_API_BASE_URL`: existing API URL supplied by the packaged Python
  launcher.
- `SONGCUT_MODEL_DIR`: root directory for downloaded OpenVINO Whisper models.

ffmpeg discovery:

- Search recursively under the packaged executable root or repository root for a
  directory containing both `ffmpeg.exe` and `ffprobe.exe`.
- If no pair is found under that root, fall back to `PATH`.
- Missing ffmpeg must not prevent the GUI shell from starting. The app shows a
  startup `ffmpeg Check` dialog only when the pair is unavailable, and the
  Settings menu can run the same check on demand.

## Main screen layout

- The screen is split vertically.
- The top pane is the video pane.
- The bottom pane is the operation pane.
- The boundary between panes is draggable.
- The split position is persisted in renderer local storage and restored on the
  next launch. Its default is `52%` and its valid range is `32%` to `72%`.
- Video uses `object-fit: contain` so it always preserves aspect ratio.
- The operation pane contains, from top to bottom:
  1. Primary toolbar.
  2. Guide text textarea and status/progress panel.
  3. Waveform timeline.
  4. Segment timeline for the selected segment.
  5. Segment list.

### Scrollable table layout rule

- A fixed table header must be a sibling outside the vertical scroll area. Only
  the body viewport owns the vertical scrollbar, so neither its track nor its
  gutter can occupy or overlap the header range.
- Do not simulate this separation by putting a sticky header inside the same
  scroll viewport and offsetting the scrollbar with margins or padding. That
  couples the result to a header height and has caused regressions.
- Keep the separate header and body columns aligned with the same `colgroup` and
  `table-layout: fixed` geometry. Reserve scrollbar clearance only inside the
  body table's final cell.
- Keyboard selection scrolling must compare the selected row against the body
  viewport bounds; the header is not part of that viewport.

## Application menu

- Top-level order: `File`, `Edit`, `Play`, `View`, `Export`, `Settings`,
  `Window`, `Help`.
- `File` adds `Load Movie`, which uses the same file-open flow as the toolbar
  `Load` button.
- `Edit` keeps only the songcut editing groups plus `Cut`, `Copy`, and `Paste`;
  `Undo`, `Redo`, and `Select All` are omitted.
- `Edit` groups:
  - Disabled heading `-- Nudge Adjust Boundary --`, with `Nudge Boundary Left` and
    `Nudge Boundary Right`. Their displayed shortcuts are `Q` and `E`.
  - Disabled heading `-- Timeline --`, with `Zoom +`, `Zoom -`, and `Zoom Level`
    submenu entries for `100%`, `200%`, `400%`, `800%`, `1600%`, and `3200%`.
    Timeline zoom shortcuts are `Z` for zoom out, `X` for 100%, and `C` for
    zoom in.
- `Play` groups:
  - Disabled heading `-- Segment Selection --`, with `Previous Segment` (`W`)
    and `Next Segment` (`S`). Selection stops at the first and last segments.
  - Disabled heading `-- Movie Control --`, with `Start`, `Previous Boundary`
    (`Ctrl+A`), a dynamic `Play` / `Pause` item (`Space`), and `Next Boundary`
    (`Ctrl+D`).
  - Disabled heading `-- Play Boundary --`, with `Play Start Boundary` and
    `Play End Boundary` for the selected segment. Their shortcuts are `A` and
    `D`.
- `Export` provides `Export Movie` and `Export TS Text`.
- `Settings` provides `Prepare Whisper Model` and `ffmpeg Check`.
- `View` and `Window` retain standard Electron role-based items.
- `Help` provides `About songcut`, `Open Repository`, and
  `Report Issue / Request Feature`. About uses the native Electron dialog and
  shows build time plus the Electron runtime version. The repository and issue
  entries open `https://github.com/mokusatsu/songcut` and
  `https://github.com/mokusatsu/songcut/issues` in the default browser.
- Menu item enabled/checked states track the renderer state for loaded video,
  selected segment, checked export rows, play/pause state, and timeline zoom.
- The toolbar keeps the main workflow buttons except `Prepare Whisper`, which is
  available only from `Settings > Prepare Whisper Model`.

## Keyboard shortcut behavior

- Application editing shortcuts are handled in the renderer. Menu accelerators
  are display-only so unmodified letter keys never bypass focus checks.
- Every shortcut executes only on the initial keydown; auto-repeat events are
  ignored.
- Shortcuts are disabled while an input, textarea, select, button, link,
  checkbox, other editable control, or modal dialog is active.
- Shortcuts are disabled during IME composition and when unexpected modifiers
  are held. Unmodified letter shortcuts never consume standard `Ctrl`, `Shift`,
  `Alt`, or `Meta` combinations.
- Keyboard segment selection keeps the selected row fully visible in the body
  viewport below the segment-list header.

## Persistent editing settings

- Boundary preview duration is persisted in renderer local storage. The default
  is `5` seconds.
- Boundary nudge duration is persisted in renderer local storage. The default is
  `0.5` seconds.
- The selected segment row uses the waveform selection red (`#f26d5b`) while
  ordinary pointer hover retains the neutral blue-gray highlight.

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
- The default analysis settings are profile `intel-258v` and device `auto`
  unless future settings expose them.
- Device `auto` follows the shared backend policy: prefer OpenVINO
  `NPU -> GPU -> CPU` when a compatible fixed-shape singing model exists, and
  otherwise use the current DSP baseline while recording fallback diagnostics.
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

- The backend probes source media and keyframes, then builds a GOP plan.
- Supported H.264/AV1 MP4/MOV, VP8/VP9/AV1 WebM, and
  H.264/VP8/VP9/AV1 MKV sources use the smart copy/encode/concat pipeline.
- Unsupported codec/container combinations fall back to a full high-quality
  re-encode at 1.5x source bitrate.
- If the smart pipeline fails during export, the backend retries with the same
  full re-encode fallback and records the fallback reason in the returned plan.

## REST API

- `GET /health`
  - Verifies API availability. Returns ffmpeg paths when available and an
    `ffmpeg_error` field when they are missing.
- `GET /ffmpeg/check`
  - Returns `{ ok, ffmpeg, ffprobe, error, download_url }` for the Settings menu
    check. The download URL is `https://www.ffmpeg.org/download.html`.
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

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
- `SONGCUT_BUNDLED_MODEL_DIR`: read-only root containing a bundled Small model.

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
  next launch. Its default is `35%` and its valid range is `32%` to `72%`.
- Video uses `object-fit: contain` so it always preserves aspect ratio.
- The operation pane contains, from top to bottom:
  1. Primary toolbar.
  2. Guide text textarea and status/progress panel.
  3. Waveform timeline.
  4. Segment timeline for the selected segment.
  5. Segment list.

### Typography and sizing

- Before designing or compacting GUI controls, inspect the current defaults and
  overrides in `gui/src/styles.css`. Do not infer the effective size from browser
  defaults or from a single component screenshot.
- The CSS typography scale is deliberate: normal body text is `16px`, controls
  and dense primary data are at least `14px`, supporting metadata is `13px`, and
  `12px` is reserved for compact badges or genuinely secondary status text.
- Buttons, inputs, textareas, and selects must inherit the application font.
  Native select defaults are not accepted because they can silently render
  smaller than adjacent controls.
- Do not reduce font size to make a new panel fit. Prefer moving infrequent
  controls into a dialog, wrapping responsive field groups, or adding a bounded
  scroll area. Verify the result at the supported minimum window size before
  accepting a layout change.

### Scrollable panel and dialog practice

- When a dialog or bounded panel can overflow at the supported minimum window
  size, use the shared Shadcn/Radix `ScrollArea`; do not add native
  `overflow: auto` to the content container.
- Give the `ScrollArea` root an explicit bounded height and `min-height: 0`, and
  put scrollbar clearance on its viewport rather than on the content.
- Keep dialog headers and primary action rows outside the scrolling viewport so
  the title, close control, and confirmation buttons remain visible.
- For side-by-side comparisons, give each pane its own bounded `ScrollArea` and
  collapse to one column at narrow widths.

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

- Top-level order: `File`, `Edit`, `Play`, `Segment`, `Export`, `Settings`, `View`,
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
  - Disabled heading `-- Movie Control --`, with `Start`, `Previous Boundary`
    (`Ctrl+A`), a dynamic `Play` / `Pause` item (`Space`), and `Next Boundary`
    (`Ctrl+D`).
  - Disabled heading `-- Play Boundary --`, with `Play Start Boundary` and
    `Play End Boundary` for the selected segment. Their shortcuts are `A` and
    `D`.
- `Segment` uses the same flat, disabled-heading pattern as `Edit`, with
  separators between these groups:
  - Disabled heading `-- Segment Selection --`, followed by `Previous Segment`
    (`W`) and `Next Segment` (`S`). Selection stops at the first and last
    segments.
  - Disabled heading `-- Segment Management --`, followed by `New Segment`,
    `Remove Segment...`, `Remove All Unchecked Segments...`, and `Sort
    Segments...`.
  - Disabled heading `-- Export Selection --`, followed by `Check All`,
    `Uncheck All`, and `Invert Selection`.
- `New Segment` creates a checked five-second manual segment at the current
  playback position, bounded by the source duration. It is inserted after the
  explicitly selected segment, or appended when there is no explicit
  selection, and becomes selected.
- Removal commands require confirmation and use the same segment-review row as
  Export Review. `Remove Segment...` is unavailable without an explicit
  selection; `Remove All Unchecked Segments...` is unavailable when no
  unchecked segments exist.
- `Sort Segments...` confirms a stable ascending start-time sort with `Before`
  and `After` review panes displayed side by side. Each comparison pane uses its
  own Shadcn/Radix `ScrollArea`.
- `Export` provides `Export Movie` and `Export TS Text`.
- `Settings` contains one `Settings...` command with a literal `Ctrl+,` label
  that opens the same
  Settings dialog as the toolbar Settings button.
- The Settings dialog contains scratch-preview duration, a checked-by-default
  `Use Scratch Audio Proxy` toggle, waveform display, singing-analysis device,
  the export filename template, all Whisper controls, `Prepare Whisper Model`, and `ffmpeg
  Check`. Scratch proxy and waveform display settings persist in renderer local
  storage; analysis, export filename, and Whisper settings are project settings.
  The settings body uses the shared Shadcn/Radix `ScrollArea`, while its header
  and action row remain fixed outside the scrolling viewport.
- `View` and `Window` retain standard Electron role-based items.
- `Help` provides `About songcut`, `Open Repository`, and
  `Report Issue / Request Feature`. About uses the native Electron dialog and
  shows build time plus the Electron runtime version. The repository and issue
  entries open `https://github.com/mokusatsu/songcut` and
  `https://github.com/mokusatsu/songcut/issues` in the default browser.
- Menu item enabled/checked states track the renderer state for loaded video,
  selected segment, checked export rows, play/pause state, and timeline zoom.
- The toolbar keeps the main workflow buttons and a Settings button. Whisper
  settings and model preparation are never resident in the main operation pane;
  they are available only inside the Settings dialog.

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
- Q/E chooses the nearest start or end edge of the currently selected segment.
  A boundary from another segment must not take priority merely because it is
  closer to the playhead; global nearest-edge fallback is used only when the
  selected segment id is unavailable.
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
- The guide textarea and its adjacent status panel split the available row
  width equally. Content length must not cause the guide field to consume the
  status panel's half.
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

- Whisper ON/OFF, model, language, device, model state, preparation, and manual
  transcription controls live in the Settings dialog. Closing the dialog leaves
  the main editing layout free of a resident Whisper panel.
- `Prepare Whisper Model` is inside that dialog and always acts
  on the currently selected model. It is not duplicated in the application menu
  or primary toolbar.
- New projects default to disabled, with Small / Japanese / Auto retained as
  their selected settings.
- Selectable models are the official pre-converted OpenVINO FP16 Tiny, Base,
  and Small repositories. Arbitrary repository IDs and local paths are not
  accepted by the GUI or API.
- Downloaded model files are stored under `%LOCALAPPDATA%\songcut\models` by
  default, or under `SONGCUT_MODEL_DIR` when set. A Full distribution reads its
  bundled Small model from `SONGCUT_BUNDLED_MODEL_DIR` without writing there.
- Runtime: OpenVINO GenAI `WhisperPipeline`.
- Auto device priority: `NPU -> GPU -> CPU`.
- Strict device modes:
  - `npu`: fail if NPU is unavailable.
  - `gpu`: fail if GPU is unavailable.
  - `cpu`: force CPU.
- Languages use stable Whisper codes in projects and are converted to token
  form only at the inference boundary. Auto omits the language argument.
- Language selection uses a songcut-managed ARIA combobox, not native
  `input[list]`/`datalist`. The selected code and the user's search query are
  separate state. With an empty query, Auto detect, Japanese, English, Chinese,
  and Korean are pinned in that order, followed by the remaining unique
  languages alphabetically. Search is case-insensitive across code and label,
  ranked by code exact match, label exact match, prefix match, then substring
  match. Mouse selection and Arrow/Enter/Escape keyboard operation must remain
  available while Whisper is disabled.
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
- Loading a video starts an independent waveform job when no valid saved
  waveform is available. The waveform job is not part of singing analysis and
  may run at the same time as analysis, transcription, or scratch-proxy work.
- The waveform job decodes only the first audio stream as 4 kHz mono signed
  16-bit PCM. It reads the FFmpeg pipe incrementally and publishes completed
  point batches; it does not retain the decoded PCM stream in memory.
- Waveform points use
  `min(max(ceil(durationSeconds), 2400), 21600)`, further limited by the decoded
  PCM frame count. This retains 2400 points for videos up to 40 minutes, targets
  about one second per point through six hours, and caps longer videos at 21600
  points.
- PCM frames are divided with proportional integer boundaries so every frame is
  included exactly once and bucket sizes differ by at most one frame. Points
  carry `t`, `min`, `max`, `rms`, and `sample_count`.
- While generation is running, each published batch is appended as a separate
  temporary SVG path. A progress frontier marks the generated extent, so the
  usable waveform grows from left to right without rebuilding prior batches.
- At completion, the renderer builds the peak-preserving 1x, 2x, 4x, ... final
  waveform levels. Temporary and final SVG layers overlap for a short
  cross-fade before the temporary paths are removed. The renderer selects the
  finest final level whose bucket duration is at least the current
  seconds-per-pixel value.
- Only the selected level is mounted. RMS and peak samples are combined into
  one SVG path each; the combined display mode mounts two paths. Playback
  cursor updates do not rebuild or replace the static waveform path.
- Completed waveforms are saved independently in the project's top-level
  `waveform_snapshot`, with source fingerprint, duration, generator, sample
  rate, channel count, encoding, point count, and Base64 data. Each waveform
  point is one 20-byte little-endian record: Float32 `t`, `min`, `max`, and
  `rms`, followed by Uint32 `sample_count`. The encoding identifier is
  `f32le-4-u32le-1-v1`. A valid saved snapshot is decoded and shown immediately
  on reload.
- Project schema version 3 is the first version using the packed waveform
  representation. Earlier project schemas are rejected; no waveform migration
  path is provided.
- Changing video, closing the app, or retrying cancels or releases the active
  waveform job. Waveform and scratch-proxy background tasks do not block app
  exit; analysis, transcription, export, and model-download tasks do.
- The segment timeline reflects the selected segment.
- The selected segment start and end marks are draggable.
- Dragging start/end only changes the segment export range in the GUI state.
- Transcription text is not recalculated when the user edits start/end.

## Scratch preview audio proxy

- After loading an Opus movie, the API creates a scratch-only proxy in the
  background. AAC and other source codecs continue to use their original media.
- The proxy is M4A containing AAC-LC at 48 kHz, mono, and 64 kbit/s. FFmpeg uses
  `aac_mf` when available and falls back to the native fast AAC encoder. The
  process has below-normal Windows priority; the native fallback uses one
  encoder thread.
- While the proxy is queued, encoding, loading, or has failed, scratch preview
  plays the original video audio. Once the proxy has loaded and completed an
  initial seek, the next scratch request uses the proxy `<audio>` element. A
  preview already in progress is never switched mid-sound.
- Every new drag position stops the preceding scratch media before seeking and
  starting the selected media. The visible video time remains the source of the
  playback cursor even while proxy audio is active.
- Turning `Settings > Use Scratch Audio Proxy` off cancels an unfinished job,
  unloads and releases a completed proxy, and immediately restores original
  audio for subsequent scratch requests. The setting defaults to on and is
  stored as `songcut:scratch-audio-proxy-enabled`.
- Loading another movie performs the same cancellation and release. Proxy files
  live in a per-process temporary directory; normal API shutdown removes the
  directory, and startup prunes abandoned session directories older than 24
  hours.

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
- The filename template defaults to `{index}_{title}`. Supported placeholders
  are `{index}`, `{title}`, `{id}`, `{start}`, and `{end}`. The dialog validates
  unknown or unmatched placeholders and shows the resulting `.mp4` names
  before export. Invalid Windows filename characters and reserved names are
  sanitized, and duplicate names receive a suffix.
- `Create a "<source>" folder inside the selected output folder` optionally
  creates a source-video-named child folder. The filename template is shared
  with Settings and stored in the current `.songcut` project. The folder option
  remains an application-wide preference restored on the next launch.
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
- `POST /scratch-proxy/jobs`
  - Starts cancellable AAC scratch-proxy generation for one source path.
- `DELETE /scratch-proxy/jobs/{job_id}`
  - Cancels an unfinished scratch-proxy process and marks its job cancelled.
- `DELETE /scratch-proxies/{proxy_id}`
  - Releases a completed proxy and deletes its temporary file. Repeated or
    unknown releases return `released: false`.
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

# CLI

The Python CLI remains available for development, automation, diagnostics, and
regression checks. The repository's primary distribution target is the desktop
GUI and portable Windows package; see `README.md` for the GUI overview and
`docs/BUILD.md` for setup and build details.

Install the package from source first:

```powershell
python -m pip install -e ".[dev]"
```

After installation, commands can be run either through the console script:

```powershell
songcut --version
```

or through the module entry point:

```powershell
python -m songcut.cli --version
```

## Analyze

Analyze a local video:

```powershell
python -m songcut.cli analyze path\to\input.mp4 --out out --review
```

`--review` writes `review.html` next to `segments.json`. Use
`--review-out path\review.html` to choose a different location.

Guide-aware analysis writes both raw detections and guide-adjusted segments:

```powershell
python -m songcut.cli analyze path\to\input.mp4 --out out --guide path\to\input.guide.txt --review
```

This writes `out\segments.json`, `out\guided_segments.json`, and a
guide-adjusted `out\review.html`.

Force the acoustic detector instead of metadata timestamps:

```powershell
python -m songcut.cli analyze path\to\input.mp4 --timestamp-source acoustic --out out-acoustic
```

The default analysis profile is `intel-258v`. To make the hardware-oriented
defaults explicit:

```powershell
python -m songcut.cli analyze path\to\input.mp4 --profile intel-258v --device auto --out out
```

`--device auto` is the normal path. It records OpenVINO device availability and
uses the current DSP baseline unless a compatible singing model is configured.
`--device npu` and `--device gpu` are strict checks and fail when the requested
device is unavailable.

Acoustic detections use local RMS/Otsu boundary refinement by default. It keeps
the coarse segment count unchanged and only adjusts starts and ends. Disable it
for comparison or regression checks with:

```powershell
python -m songcut.cli analyze path\to\input.mp4 --out out --no-boundary-refinement
```

The output includes the `rms-otsu-boundary-v1` settings snapshot, summary, and
per-segment diagnostics. Metadata timestamps are never passed through this
refiner.

## Evaluate And Review

Evaluate an existing `segments.json` file against timestamp truth:

```powershell
python -m songcut.cli evaluate out\segments.json --truth path\to\timestamps.txt
```

Generate a lightweight review HTML for an existing `segments.json` file:

```powershell
python -m songcut.cli review out\segments.json --video path\to\input.mp4 --out out\review.html
```

## Export

Export clips:

```powershell
python -m songcut.cli export out\segments.json --source path\to\input.mp4 --out clips
```

Export uses smart rendering by default. It probes keyframes, copies GOPs that
are fully inside the requested range, and re-encodes the boundary GOPs at an
estimated source video bitrate multiplied by 1.5. H.264 and AV1 MP4/MOV sources
are written as `.mp4`; VP8/VP9/AV1 WebM sources are written as `.webm`;
H.264/VP8/VP9/AV1 MKV sources are written as `.mkv`; unsupported codecs fall
back to full re-encode.

Smoke-test only the first clip with stream copy:

```powershell
python -m songcut.cli export out\segments.json --source path\to\input.mp4 --out clips --mode copy --limit 1
```

Use the legacy full accurate encode explicitly:

```powershell
python -m songcut.cli export out\segments.json --source path\to\input.mp4 --out clips --mode accurate
```

Export with a guide text:

```powershell
python -m songcut.cli export out\segments.json --source path\to\input.mp4 --out clips --guide path\to\input.guide.txt
```

Guide lines may use either `80:45 Title` or `1:20:45 Title`. A line with one
timestamp starts exactly at the guide timestamp and uses the end of the nearby
detected segment. If that detected end is later than the first timestamp on the
next guide line, the next timestamp is used as the end instead. A line with
multiple timestamps, such as
`0:10:00 Title 0:13:30`, is treated as the explicit export range. Output
filenames are derived from the guide title text after removing timestamp tags.

## Device Diagnostics

Show ffmpeg and OpenVINO device diagnostics:

```powershell
python -m songcut.cli devices
```

`--device auto` records available OpenVINO devices when OpenVINO is installed,
then uses the current DSP baseline unless an OpenVINO singing model is
configured. `--device npu` and `--device gpu` are strict checks: they fail fast
when the requested device is unavailable.

Every analysis output records diagnostic fields in `segments.json`, including
`profile`, `timestamp_source`, `model_versions`, `backend`,
`device_requested`, `device_used`, `available_devices`, `fallbacks`,
`ffmpeg_path`, and `ffprobe_path`.

## Notes

The NumPy detector is a dependency-light baseline, not a replacement for an
AudioSet/OpenVINO singing classifier. It provides a working path on machines
that do not yet have OpenVINO or ONNX models installed. The code keeps backend
and model metadata in `segments.json` so an OpenVINO NPU model can replace the
DSP scoring stage without changing the CLI contract.

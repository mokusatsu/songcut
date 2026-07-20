# songcut algorithm

## Candidate sources

`songcut analyze` uses a layered strategy:

1. Parse authored timestamp ranges from video metadata when available.
2. Fall back to local acoustic detection when metadata timestamps are absent.
3. Store backend, device, and fallback diagnostics in `segments.json`.

Authored timestamps are treated as high-confidence because many singing streams publish set lists in the YouTube description or embedded metadata. They are still written to the same editable segment format as acoustic detections.

Evaluation should keep the original v1 song-stream cases in view: talk-only,
talk with BGM, singing with accompaniment, original-vocal BGM, and long
multi-hour streams. The working target for curated truth sets is at least 95%
recall for singing candidates with a median boundary error within 3 seconds.

## Acoustic DSP baseline

The baseline uses only `ffmpeg` and NumPy so it works before OpenVINO or ONNX models are installed.

- Decode audio to 16 kHz stereo signed PCM.
- Build 2.0 second windows every 0.5 seconds.
- Convert stereo to mid/side; the current score uses the mid channel.
- Compute RMS energy, zero-crossing rate, spectral flatness, and low/mid/high spectral ratios.
- Normalize energy by robust percentiles within the recording.
- Score frames with:

```text
score = 0.60 * energy
      + 0.30 * mid_band_ratio
      + 0.20 * low_band_ratio
      - 0.40 * zero_crossing_rate
      - 0.30 * spectral_flatness
```

- Smooth scores with a 9-frame moving average.
- Keep regions above threshold, merge gaps up to 12 seconds, discard candidates shorter than 75 seconds, and add 1 second of padding.

This intentionally favors recall for full songs. Short humming and incidental singing should use a future short-form profile with lower minimum duration and a stronger learned model.

## Intel/OpenVINO path

The code detects OpenVINO devices when OpenVINO is installed. The target local
inference environment is Core Ultra 7 258V/Lunar Lake-class Windows hardware.
OpenVINO is the primary runtime direction for learned inference; Vulkan is not a
primary v1 backend. Strict `--device npu` and `--device gpu` fail if the
requested device is unavailable; `--device auto` records available devices and
falls back to the DSP baseline unless a singing model is configured.

The intended model replacement point is the frame scoring stage:

- Input: fixed-shape audio window or fixed-shape feature tensor, typically using
  a 0.5 second hop and 2 to 4 seconds of context.
- Output: per-frame probabilities for at least `singing`, `speech`, and
  `music`.
- Device priority: `NPU -> GPU -> CPU`, using explicit `NPU` or `AUTO:NPU,GPU,CPU`.
- Model format: OpenVINO IR or ONNX converted to OpenVINO-compatible fixed
  shapes, with INT8 or FP16 preferred when quality holds.
- Feature fusion: learned `singing`/`speech`/`music` probabilities should be
  combined with VAD, pitch continuity, volume, and spectral features.
- Classification intent: talk with BGM should score as high speech with weak
  pitch continuity; singing with accompaniment should score as high singing
  with stable pitch continuity.
- Device split: NPU is best for fixed-shape classification, VAD, and lightweight
  singing decisions. GPU or CPU remain appropriate for unsupported operations,
  dynamic shapes, long chunks, and optional source separation.

When such a model is added, the segment post-processing and JSON/export/review contracts should stay unchanged.

Heavy source separation, such as Demucs-style processing, is not required for
v1. If it becomes useful, it should run only on candidate ranges as an optional
high-accuracy mode.

## Analysis JSON contract

`segments.json` records the runtime context needed to compare DSP and future
OpenVINO outputs: `profile`, `timestamp_source`, `model_versions`, `backend`,
`device_requested`, `device_used`, `available_devices`, `fallbacks`,
`backend_note`, `ffmpeg_path`, and `ffprobe_path`.

The GUI analysis endpoint uses schema version 3. Waveform generation is a
separate load-time job and is not part of this analysis response or the CLI
`segments.json` contract. It decodes the first audio stream to 4 kHz mono
signed 16-bit PCM through an FFmpeg pipe and aggregates samples as they arrive,
without retaining the full PCM stream. Every point contains `t`, `min`, `max`,
`rms`, and `sample_count`. The requested point count is the video duration
rounded up to seconds, clamped to 2400 through 21600 and then limited by the
available PCM frame count. Proportional integer bucket boundaries cover every
PCM frame exactly once and keep bucket sizes within one frame of each other.

The API publishes completed point batches while decoding. The GUI appends those
batches as temporary SVG paths, then derives a peak-preserving waveform pyramid
after completion. Min and max values are combined as extrema, while RMS and
representative time use `sample_count` weighting. The active zoom level is
selected from timeline seconds per pixel, and only that final level is rendered.
The completed base level is persisted separately from `analysis_snapshot` in
the project `waveform_snapshot`. Its point array is serialized as fixed-width
20-byte little-endian records (`t`, `min`, `max`, and `rms` as Float32;
`sample_count` as Uint32), then stored in JSON as Base64 using encoding id
`f32le-4-u32le-1-v1`.

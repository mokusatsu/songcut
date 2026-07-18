# songcut algorithm

## Candidate sources

`songcut analyze` uses a layered strategy:

1. Parse authored timestamp ranges from video metadata when available.
2. Fall back to local acoustic detection when metadata timestamps are absent.
3. Store backend, device, and fallback diagnostics in `segments.json`.

Authored timestamps are treated as high-confidence because many singing streams publish set lists in the YouTube description or embedded metadata. They are still written to the same editable segment format as acoustic detections.

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

The code detects OpenVINO devices when OpenVINO is installed. Strict `--device npu` and `--device gpu` fail if the requested device is unavailable; `--device auto` records available devices and falls back to the DSP baseline unless a singing model is configured.

The intended model replacement point is the frame scoring stage:

- Input: fixed-shape audio window or fixed-shape feature tensor.
- Output: per-frame probabilities for at least `singing`, `speech`, and `music`.
- Device priority: `NPU -> GPU -> CPU`, using explicit `NPU` or `AUTO:NPU,GPU,CPU`.
- Model format: OpenVINO IR or ONNX converted to OpenVINO-compatible fixed shapes.

When such a model is added, the segment post-processing and JSON/export/review contracts should stay unchanged.


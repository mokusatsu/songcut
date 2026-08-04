from __future__ import annotations

import shutil
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
import win_safesubprocess as subprocess


CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


@dataclass(frozen=True)
class AudioFeatures:
    samples: NDArray[np.float32]
    sample_rate: int
    duration: float
    frame_times: NDArray[np.float64]
    envelope: NDArray[np.float64]
    activity_threshold: float
    trusted_vocal: bool = False

    def activity_components(
        self,
        *,
        bridge: float,
        minimum: float,
        boundary_padding: bool = True,
    ) -> list[tuple[float, float]]:
        """Return connected vocal-activity components only for a trusted vocal signal."""
        if not self.trusted_vocal or self.frame_times.size == 0:
            return []
        active = self.envelope >= self.activity_threshold
        hop = float(np.median(np.diff(self.frame_times))) if len(self.frame_times) > 1 else 0.02
        max_bridge_frames = max(0, round(bridge / hop))
        if max_bridge_frames:
            inactive_start: int | None = None
            for index, is_active in enumerate(active):
                if not is_active and inactive_start is None:
                    inactive_start = index
                elif is_active and inactive_start is not None:
                    if index - inactive_start <= max_bridge_frames:
                        active[inactive_start:index] = True
                    inactive_start = None
        components: list[tuple[float, float]] = []
        start_index: int | None = None
        for index, is_active in enumerate(active):
            if is_active and start_index is None:
                start_index = index
            elif not is_active and start_index is not None:
                start = max(0.0, float(self.frame_times[start_index] - hop / 2))
                end = min(self.duration, float(self.frame_times[index - 1] + hop / 2))
                if end - start >= minimum:
                    components.append((start, end))
                start_index = None
        if start_index is not None:
            start = max(0.0, float(self.frame_times[start_index] - hop / 2))
            end = min(self.duration, float(self.frame_times[-1] + hop / 2))
            if end - start >= minimum:
                components.append((start, end))
        if not components or not boundary_padding:
            return components
        padding = bridge / 2
        padded = [
            (max(0.0, start - padding), min(self.duration, end + padding))
            for start, end in components
        ]
        merged: list[tuple[float, float]] = [padded[0]]
        for start, end in padded[1:]:
            previous_start, previous_end = merged[-1]
            if start <= previous_end:
                merged[-1] = (previous_start, max(previous_end, end))
            else:
                merged.append((start, end))
        return merged

    def confirmed_silences(
        self,
        minimum: float,
        *,
        bridge: float = 0.18,
        activity_minimum: float = 0.10,
    ) -> list[tuple[float, float]]:
        """Return silence only for a vocal stem; mixture RMS is not a singing VAD."""
        if not self.trusted_vocal:
            return []
        components = self.activity_components(
            bridge=bridge,
            minimum=activity_minimum,
            boundary_padding=False,
        )
        intervals: list[tuple[float, float]] = []
        cursor = 0.0
        for start, end in components:
            if start - cursor >= minimum:
                intervals.append((cursor, start))
            cursor = max(cursor, end)
        if self.duration - cursor >= minimum:
            intervals.append((cursor, self.duration))
        return intervals

    def minimum_envelope_time(self, start: float, end: float) -> float:
        if end <= start or self.frame_times.size == 0:
            return (start + end) / 2
        indexes = np.flatnonzero(
            (self.frame_times >= start) & (self.frame_times <= end)
        )
        if indexes.size == 0:
            return (start + end) / 2
        values = self.envelope[indexes]
        minimum = float(np.min(values))
        spread = float(np.max(values) - minimum)
        near_minimum = indexes[values <= minimum + max(1e-9, spread * 0.05)]
        midpoint = (start + end) / 2
        best = near_minimum[
            int(np.argmin(np.abs(self.frame_times[near_minimum] - midpoint)))
        ]
        return float(self.frame_times[best])


def _decode_wave(path: Path) -> tuple[NDArray[np.float32], int]:
    with wave.open(str(path), "rb") as reader:
        channels = reader.getnchannels()
        rate = reader.getframerate()
        width = reader.getsampwidth()
        frames = reader.readframes(reader.getnframes())
    if width == 1:
        values = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        values = (values - 128.0) / 128.0
    elif width == 2:
        values = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        values = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"unsupported PCM sample width: {width}")
    if channels > 1:
        values = values.reshape(-1, channels).mean(axis=1)
    return values.astype(np.float32, copy=False), rate


def _decode_ffmpeg(path: Path, sample_rate: int = 16000) -> tuple[NDArray[np.float32], int]:
    executable = shutil.which("ffmpeg")
    if executable is None:
        raise ValueError(f"{path} is not readable PCM WAV and ffmpeg is not installed")
    process = subprocess.run(
        [
            executable,
            "-v",
            "error",
            "-i",
            str(path),
            "-f",
            "f32le",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "pipe:1",
        ],
        check=False,
        capture_output=True,
        creationflags=CREATE_NO_WINDOW,
    )
    if process.returncode != 0:
        message = process.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"could not decode audio: {message}")
    return np.frombuffer(process.stdout, dtype="<f4").copy(), sample_rate


def load_audio_features(path: str | Path, *, trusted_vocal: bool = False) -> AudioFeatures:
    audio_path = Path(path)
    try:
        samples, sample_rate = _decode_wave(audio_path)
    except (wave.Error, EOFError, ValueError):
        samples, sample_rate = _decode_ffmpeg(audio_path)
    duration = len(samples) / sample_rate if sample_rate else 0.0
    frame_length = max(1, int(sample_rate * 0.04))
    hop = max(1, int(sample_rate * 0.02))
    if len(samples) < frame_length:
        padded = np.pad(samples, (0, max(0, frame_length - len(samples))))
        envelope = np.array([float(np.sqrt(np.mean(padded * padded)))])
        frame_times = np.array([0.0])
    else:
        count = 1 + (len(samples) - frame_length) // hop
        shape = (count, frame_length)
        strides = (samples.strides[0] * hop, samples.strides[0])
        frames = np.lib.stride_tricks.as_strided(samples, shape=shape, strides=strides)
        envelope = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
        frame_times = (np.arange(count) * hop + frame_length / 2) / sample_rate
    positive = envelope[envelope > 1e-7]
    if positive.size:
        floor = float(np.percentile(positive, 20))
        high = float(np.percentile(positive, 75))
        threshold = floor + 0.22 * max(0.0, high - floor)
    else:
        threshold = 1e-7
    return AudioFeatures(
        samples=samples,
        sample_rate=sample_rate,
        duration=duration,
        frame_times=frame_times,
        envelope=envelope,
        activity_threshold=threshold,
        trusted_vocal=trusted_vocal,
    )


def refine_boundary(
    features: AudioFeatures,
    boundary: float,
    *,
    role: str,
    radius: float,
) -> tuple[float, dict[str, float | str]]:
    """Refine near an STT boundary. Mixture energy is a local cue, never a vocal VAD."""
    if features.frame_times.size < 3 or radius <= 0:
        return boundary, {"method": "none", "shift": 0.0}
    mask = np.abs(features.frame_times - boundary) <= radius
    indexes = np.flatnonzero(mask)
    if indexes.size < 3:
        return boundary, {"method": "none", "shift": 0.0}
    values = np.log1p(features.envelope[indexes] * 1000.0)
    differences = np.gradient(values)
    if role == "start":
        best_local = int(np.argmax(differences))
    elif role == "end":
        best_local = int(np.argmin(differences))
    else:
        raise ValueError("boundary role must be 'start' or 'end'")
    candidate = float(features.frame_times[indexes[best_local]])
    # A mixture has accompaniment transients. Keep its influence small; a stem is safer.
    allowed = radius if features.trusted_vocal else min(radius, 0.18)
    shift = float(np.clip(candidate - boundary, -allowed, allowed))
    return boundary + shift, {
        "method": "vocal_envelope" if features.trusted_vocal else "mixture_local_envelope",
        "shift": shift,
    }

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class FeatureConfig:
    sample_rate: int = 16000
    window_seconds: float = 2.0
    hop_seconds: float = 0.5
    smooth_frames: int = 9


@dataclass(frozen=True)
class FeatureSet:
    times: np.ndarray
    rms: np.ndarray
    zcr: np.ndarray
    low_ratio: np.ndarray
    mid_ratio: np.ndarray
    high_ratio: np.ndarray
    flatness: np.ndarray
    mid_side_ratio: np.ndarray
    score: np.ndarray
    smoothed_score: np.ndarray


def pcm_bytes_to_float_stereo(raw: bytes, channels: int = 2) -> np.ndarray:
    data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels == 1:
        return data.reshape(-1, 1)
    return data.reshape(-1, channels)


def compute_features(samples: np.ndarray, config: FeatureConfig = FeatureConfig()) -> FeatureSet:
    if samples.ndim == 1:
        samples = samples.reshape(-1, 1)
    if samples.shape[1] == 1:
        mid_signal = samples[:, 0]
        side_signal = np.zeros_like(mid_signal)
    else:
        left = samples[:, 0]
        right = samples[:, 1]
        mid_signal = (left + right) * 0.5
        side_signal = (left - right) * 0.5

    sample_rate = config.sample_rate
    window_size = int(round(config.window_seconds * sample_rate))
    hop_size = int(round(config.hop_seconds * sample_rate))
    if len(mid_signal) < window_size:
        raise ValueError("Input audio is shorter than the feature window.")

    frame_count = 1 + (len(mid_signal) - window_size) // hop_size
    times = np.arange(frame_count, dtype=np.float64) * config.hop_seconds + config.window_seconds * 0.5

    window = np.hanning(window_size).astype(np.float32)
    freqs = np.fft.rfftfreq(window_size, 1.0 / sample_rate)
    low_mask = (freqs >= 80.0) & (freqs < 300.0)
    mid_mask = (freqs >= 300.0) & (freqs < 3000.0)
    high_mask = (freqs >= 3000.0) & (freqs < 7000.0)

    rms = np.empty(frame_count, dtype=np.float32)
    zcr = np.empty(frame_count, dtype=np.float32)
    low_ratio = np.empty(frame_count, dtype=np.float32)
    mid_ratio = np.empty(frame_count, dtype=np.float32)
    high_ratio = np.empty(frame_count, dtype=np.float32)
    flatness = np.empty(frame_count, dtype=np.float32)
    mid_side_ratio = np.empty(frame_count, dtype=np.float32)

    for index in range(frame_count):
        start = index * hop_size
        end = start + window_size
        segment = mid_signal[start:end]
        side_segment = side_signal[start:end]
        rms[index] = float(np.sqrt(np.mean(segment * segment) + 1e-12))
        side_rms = float(np.sqrt(np.mean(side_segment * side_segment) + 1e-12))
        mid_side_ratio[index] = float(rms[index] / (side_rms + 1e-6))
        zcr[index] = float(np.mean(np.abs(np.diff(np.signbit(segment)))))

        spectrum = np.abs(np.fft.rfft(segment * window)) + 1e-12
        total = float(np.sum(spectrum))
        low_ratio[index] = float(np.sum(spectrum[low_mask]) / total)
        mid_ratio[index] = float(np.sum(spectrum[mid_mask]) / total)
        high_ratio[index] = float(np.sum(spectrum[high_mask]) / total)
        flatness[index] = float(np.exp(np.mean(np.log(spectrum))) / np.mean(spectrum))

    score = score_frames(rms, zcr, low_ratio, mid_ratio, flatness)
    smoothed = moving_average(score, config.smooth_frames)
    return FeatureSet(times, rms, zcr, low_ratio, mid_ratio, high_ratio, flatness, mid_side_ratio, score, smoothed)


def score_frames(
    rms: np.ndarray,
    zcr: np.ndarray,
    low_ratio: np.ndarray,
    mid_ratio: np.ndarray,
    flatness: np.ndarray,
) -> np.ndarray:
    log_rms = np.log10(rms + 1e-8)
    lo = np.percentile(log_rms, 5)
    hi = np.percentile(log_rms, 95)
    energy = np.clip((log_rms - lo) / (hi - lo + 1e-9), 0.0, 1.0)
    score = energy * 0.60 + mid_ratio * 0.30 + low_ratio * 0.20 - zcr * 0.40 - flatness * 0.30
    return score.astype(np.float32)


def moving_average(values: np.ndarray, width: int) -> np.ndarray:
    if width <= 1:
        return values.astype(np.float32)
    kernel = np.ones(width, dtype=np.float32) / float(width)
    return np.convolve(values, kernel, mode="same").astype(np.float32)


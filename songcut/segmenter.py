from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .features import FeatureSet
from .timestamps import Segment


@dataclass(frozen=True)
class SegmenterProfile:
    name: str = "intel-258v"
    threshold: float = 0.34
    min_segment_seconds: float = 75.0
    merge_gap_seconds: float = 12.0
    pad_seconds: float = 1.0


def segments_from_features(features: FeatureSet, profile: SegmenterProfile = SegmenterProfile()) -> list[Segment]:
    mask = features.smoothed_score > profile.threshold
    raw_segments = _mask_to_segments(mask, features.times)

    merged: list[list[float]] = []
    for start, end in raw_segments:
        if merged and start - merged[-1][1] <= profile.merge_gap_seconds:
            merged[-1][1] = end
        else:
            merged.append([start, end])

    result: list[Segment] = []
    for start, end in merged:
        if end - start < profile.min_segment_seconds:
            continue
        padded_start = max(0.0, start - profile.pad_seconds)
        padded_end = end + profile.pad_seconds
        confidence = _segment_confidence(features, padded_start, padded_end, profile.threshold)
        result.append(Segment(padded_start, padded_end, confidence=confidence, source="acoustic-dsp"))
    return result


def _mask_to_segments(mask: np.ndarray, times: np.ndarray) -> list[tuple[float, float]]:
    segments: list[tuple[float, float]] = []
    index = 0
    while index < len(mask):
        if not bool(mask[index]):
            index += 1
            continue
        end_index = index
        while end_index < len(mask) and bool(mask[end_index]):
            end_index += 1
        start = float(times[index] - 1.0)
        end = float(times[end_index - 1] + 1.0)
        segments.append((max(0.0, start), end))
        index = end_index
    return segments


def _segment_confidence(features: FeatureSet, start: float, end: float, threshold: float) -> float:
    inside = (features.times >= start) & (features.times <= end)
    if not np.any(inside):
        return 0.0
    mean_score = float(np.mean(features.smoothed_score[inside]))
    return max(0.0, min(0.99, 0.5 + (mean_score - threshold)))


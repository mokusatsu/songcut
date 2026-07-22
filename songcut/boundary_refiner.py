from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

from .timestamps import Segment


BOUNDARY_REFINER_VERSION = "rms-otsu-boundary-v1"
_FIXED_HOP_SECONDS = 0.02
_SMOOTH_SECONDS = 0.2
_MIN_CLUSTER_SHARE = 0.10
_MIN_CLUSTER_GAP_DB = 6.0
_MIN_CONTRAST_DB = 3.0


@dataclass(frozen=True)
class BoundaryRefinerConfig:
    enabled: bool = True
    search_radius_seconds: float = 30.0
    rms_window_ms: int = 80
    occupancy_window_seconds: float = 2.0
    high_occupancy: float = 0.80
    low_occupancy: float = 0.35
    start_persistence_seconds: float = 2.0
    end_persistence_seconds: float = 3.0
    contrast_window_seconds: float = 5.0
    pre_roll_seconds: float = 0.5
    post_roll_seconds: float = 1.0

    def validate(self) -> None:
        ranges = (
            ("search_radius_seconds", self.search_radius_seconds, 5.0, 120.0),
            ("rms_window_ms", float(self.rms_window_ms), 50.0, 100.0),
            ("occupancy_window_seconds", self.occupancy_window_seconds, 0.5, 10.0),
            ("high_occupancy", self.high_occupancy, 0.5, 1.0),
            ("low_occupancy", self.low_occupancy, 0.0, 0.5),
            ("start_persistence_seconds", self.start_persistence_seconds, 0.5, 10.0),
            ("end_persistence_seconds", self.end_persistence_seconds, 0.5, 15.0),
            ("contrast_window_seconds", self.contrast_window_seconds, 1.0, 15.0),
            ("pre_roll_seconds", self.pre_roll_seconds, 0.3, 1.0),
            ("post_roll_seconds", self.post_roll_seconds, 0.3, 1.0),
        )
        for name, value, lower, upper in ranges:
            if not np.isfinite(value) or value < lower or value > upper:
                raise ValueError(f"{name} must be between {lower:g} and {upper:g}.")
        if self.rms_window_ms % 10:
            raise ValueError("rms_window_ms must be a multiple of 10.")
        if self.low_occupancy >= self.high_occupancy:
            raise ValueError("low_occupancy must be lower than high_occupancy.")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class BoundaryRefinementResult:
    segments: list[Segment]
    segment_diagnostics: list[dict[str, Any]]
    summary: dict[str, Any]


def refine_segments(
    samples: np.ndarray,
    segments: list[Segment],
    *,
    sample_rate: int = 16000,
    media_duration: float | None = None,
    config: BoundaryRefinerConfig | None = None,
) -> BoundaryRefinementResult:
    cfg = config or BoundaryRefinerConfig()
    cfg.validate()
    duration = float(media_duration) if media_duration is not None else len(samples) / max(1, sample_rate)
    base_summary = {
        "version": BOUNDARY_REFINER_VERSION,
        "settings": cfg.to_dict(),
        "segment_count": len(segments),
        "applied_segments": 0,
        "refined_boundaries": 0,
        "skipped_reason": None,
    }
    if not cfg.enabled:
        return BoundaryRefinementResult(list(segments), [], {**base_summary, "skipped_reason": "disabled"})
    if not segments:
        return BoundaryRefinementResult([], [], {**base_summary, "skipped_reason": "no-segments"})
    if samples.size == 0:
        return BoundaryRefinementResult(list(segments), [], {**base_summary, "skipped_reason": "empty-pcm"})

    mid = _mid_channel(samples)
    refined: list[Segment] = []
    diagnostics: list[dict[str, Any]] = []
    for segment in segments:
        start_times, start_db = _local_rms_frames(mid, sample_rate, segment.start, duration, cfg)
        end_times, end_db = _local_rms_frames(mid, sample_rate, segment.end, duration, cfg)
        start_value, start_diag = _refine_boundary(start_times, start_db, segment.start, "start", duration, cfg)
        end_value, end_diag = _refine_boundary(end_times, end_db, segment.end, "end", duration, cfg)
        if start_value >= end_value:
            start_value, end_value = segment.start, segment.end
            start_diag = _revert_diagnostic(start_diag, "invalid-segment-range", segment.start)
            end_diag = _revert_diagnostic(end_diag, "invalid-segment-range", segment.end)
        refined.append(Segment(start_value, end_value, segment.confidence, segment.source))
        diagnostics.append(
            {
                "version": BOUNDARY_REFINER_VERSION,
                "coarse_start": round(float(segment.start), 3),
                "coarse_end": round(float(segment.end), 3),
                "automatic_start": round(float(start_value), 3),
                "automatic_end": round(float(end_value), 3),
                "start": start_diag,
                "end": end_diag,
            }
        )

    # Preserve ordering and segment count. If refined adjacent boundaries overlap,
    # both boundaries involved in the conflict return to their coarse values.
    for index in range(len(refined) - 1):
        if refined[index].end <= refined[index + 1].start:
            continue
        left_coarse = segments[index]
        right_coarse = segments[index + 1]
        refined[index] = Segment(refined[index].start, left_coarse.end, refined[index].confidence, refined[index].source)
        refined[index + 1] = Segment(right_coarse.start, refined[index + 1].end, refined[index + 1].confidence, refined[index + 1].source)
        diagnostics[index]["end"] = _revert_diagnostic(diagnostics[index]["end"], "adjacent-overlap", left_coarse.end)
        diagnostics[index + 1]["start"] = _revert_diagnostic(
            diagnostics[index + 1]["start"], "adjacent-overlap", right_coarse.start
        )
        diagnostics[index]["automatic_end"] = round(float(left_coarse.end), 3)
        diagnostics[index + 1]["automatic_start"] = round(float(right_coarse.start), 3)

    refined_boundaries = sum(
        int(bool(item[side]["success"])) for item in diagnostics for side in ("start", "end")
    )
    applied_segments = sum(int(item["start"]["success"] or item["end"]["success"]) for item in diagnostics)
    return BoundaryRefinementResult(
        refined,
        diagnostics,
        {**base_summary, "applied_segments": applied_segments, "refined_boundaries": refined_boundaries},
    )


def _mid_channel(samples: np.ndarray) -> np.ndarray:
    values = np.asarray(samples, dtype=np.float32)
    if values.ndim == 1:
        return values
    if values.shape[1] == 1:
        return values[:, 0]
    return np.mean(values[:, :2], axis=1, dtype=np.float32)


def _rms_db_frames(samples: np.ndarray, sample_rate: int, window_seconds: float) -> tuple[np.ndarray, np.ndarray]:
    window = max(1, int(round(window_seconds * sample_rate)))
    hop = max(1, int(round(_FIXED_HOP_SECONDS * sample_rate)))
    if len(samples) < window:
        return np.array([], dtype=np.float64), np.array([], dtype=np.float64)
    starts = np.arange(0, len(samples) - window + 1, hop, dtype=np.int64)
    squared = np.square(samples.astype(np.float64, copy=False))
    cumulative = np.concatenate(([0.0], np.cumsum(squared)))
    rms = np.sqrt((cumulative[starts + window] - cumulative[starts]) / window)
    db = 20.0 * np.log10(np.maximum(rms, 1e-5))
    smooth_frames = max(1, int(round(_SMOOTH_SECONDS / _FIXED_HOP_SECONDS)))
    db = _rolling_median(db, smooth_frames)
    times = (starts + window / 2.0) / sample_rate
    return times, db


def _local_rms_frames(
    samples: np.ndarray,
    sample_rate: int,
    boundary: float,
    duration: float,
    cfg: BoundaryRefinerConfig,
) -> tuple[np.ndarray, np.ndarray]:
    start = max(0.0, boundary - cfg.search_radius_seconds)
    end = min(duration, boundary + cfg.search_radius_seconds, len(samples) / sample_rate)
    start_sample = max(0, int(np.floor(start * sample_rate)))
    end_sample = min(len(samples), int(np.ceil(end * sample_rate)))
    times, db = _rms_db_frames(
        samples[start_sample:end_sample],
        sample_rate,
        cfg.rms_window_ms / 1000.0,
    )
    return times + start_sample / sample_rate, db


def _rolling_median(values: np.ndarray, size: int) -> np.ndarray:
    if size <= 1 or len(values) <= 1:
        return values.copy()
    left = size // 2
    right = size - 1 - left
    padded = np.pad(values, (left, right), mode="edge")
    windows = np.lib.stride_tricks.sliding_window_view(padded, size)
    return np.median(windows, axis=1)


def _otsu(local_db: np.ndarray) -> tuple[float | None, float | None, float | None, str | None]:
    if len(local_db) < 10:
        return None, None, None, "insufficient-local-frames"
    low, high = np.percentile(local_db, [1.0, 99.0])
    if not np.isfinite(low) or not np.isfinite(high) or high - low < 1e-6:
        return None, None, None, "uniform-level"
    clipped = np.clip(local_db, low, high)
    histogram, edges = np.histogram(clipped, bins=128, range=(low, high))
    probabilities = histogram.astype(np.float64) / max(1, histogram.sum())
    centers = (edges[:-1] + edges[1:]) / 2.0
    weight_low = np.cumsum(probabilities)
    weight_high = 1.0 - weight_low
    mean_total = np.sum(probabilities * centers)
    mean_low_sum = np.cumsum(probabilities * centers)
    denominator = weight_low * weight_high
    variance = np.full_like(denominator, -np.inf)
    valid = denominator > 0
    variance[valid] = np.square(mean_total * weight_low[valid] - mean_low_sum[valid]) / denominator[valid]
    index = int(np.argmax(variance[:-1]))
    threshold = float(edges[index + 1])
    low_cluster = local_db[local_db < threshold]
    high_cluster = local_db[local_db >= threshold]
    if len(low_cluster) / len(local_db) < _MIN_CLUSTER_SHARE or len(high_cluster) / len(local_db) < _MIN_CLUSTER_SHARE:
        return threshold, _median_or_none(low_cluster), _median_or_none(high_cluster), "cluster-share-too-small"
    low_median = float(np.median(low_cluster))
    high_median = float(np.median(high_cluster))
    if high_median - low_median < _MIN_CLUSTER_GAP_DB:
        return threshold, low_median, high_median, "cluster-gap-too-small"
    return threshold, low_median, high_median, None


def _median_or_none(values: np.ndarray) -> float | None:
    return None if len(values) == 0 else float(np.median(values))


def _refine_boundary(
    times: np.ndarray,
    db: np.ndarray,
    coarse: float,
    side: str,
    duration: float,
    cfg: BoundaryRefinerConfig,
) -> tuple[float, dict[str, Any]]:
    search_start = max(0.0, coarse - cfg.search_radius_seconds)
    search_end = min(duration, coarse + cfg.search_radius_seconds)
    mask = (times >= search_start) & (times <= search_end)
    local_times = times[mask]
    local_db = db[mask]
    diagnostic: dict[str, Any] = {
        "side": side,
        "coarse": round(float(coarse), 3),
        "search_start": round(search_start, 3),
        "search_end": round(search_end, 3),
        "otsu_threshold_db": None,
        "low_cluster_median_db": None,
        "high_cluster_median_db": None,
        "transition_candidates": [],
        "selected_candidate": None,
        "contrast_point": None,
        "contrast_db": None,
        "roll_seconds": cfg.pre_roll_seconds if side == "start" else cfg.post_roll_seconds,
        "automatic": round(float(coarse), 3),
        "delta_seconds": 0.0,
        "success": False,
        "reason": None,
    }
    threshold, low_median, high_median, reason = _otsu(local_db)
    diagnostic.update(
        otsu_threshold_db=_rounded(threshold),
        low_cluster_median_db=_rounded(low_median),
        high_cluster_median_db=_rounded(high_median),
    )
    if reason:
        diagnostic["reason"] = reason
        return coarse, diagnostic

    high_frames = (local_db >= float(threshold)).astype(np.float64)
    occupancy_frames = max(1, int(round(cfg.occupancy_window_seconds / _FIXED_HOP_SECONDS)))
    occupancy = np.convolve(high_frames, np.ones(occupancy_frames) / occupancy_frames, mode="same")
    persistence = cfg.start_persistence_seconds if side == "start" else cfg.end_persistence_seconds
    candidates = _transition_candidates(
        local_times,
        occupancy,
        side,
        cfg.low_occupancy,
        cfg.high_occupancy,
        persistence,
    )
    diagnostic["transition_candidates"] = [round(float(value), 3) for value in candidates]
    if not candidates:
        diagnostic["reason"] = "no-persistent-transition"
        return coarse, diagnostic
    candidate = min(candidates, key=lambda value: abs(value - coarse))
    # The centered occupancy window crosses its threshold after the physical
    # transition. Remove that deterministic phase offset before contrast search.
    if side == "start":
        candidate -= max(0.0, cfg.high_occupancy - 0.5) * cfg.occupancy_window_seconds
    else:
        candidate -= max(0.0, 0.5 - cfg.low_occupancy) * cfg.occupancy_window_seconds
    diagnostic["selected_candidate"] = round(float(candidate), 3)
    point, contrast = _maximum_contrast(local_times, local_db, candidate, side, cfg)
    diagnostic["contrast_point"] = _rounded(point, 3)
    diagnostic["contrast_db"] = _rounded(contrast)
    if point is None or contrast is None or contrast < _MIN_CONTRAST_DB:
        diagnostic["reason"] = "contrast-too-small"
        return coarse, diagnostic
    rolled = point - cfg.pre_roll_seconds if side == "start" else point + cfg.post_roll_seconds
    automatic = min(duration, max(0.0, rolled))
    diagnostic.update(
        automatic=round(float(automatic), 3),
        delta_seconds=round(float(automatic - coarse), 3),
        success=True,
        reason="refined",
    )
    return automatic, diagnostic


def _transition_candidates(
    times: np.ndarray,
    occupancy: np.ndarray,
    side: str,
    low_threshold: float,
    high_threshold: float,
    persistence_seconds: float,
) -> list[float]:
    state = "low" if side == "start" else "high"
    target = "high" if side == "start" else "low"
    required = max(1, int(round(persistence_seconds / _FIXED_HOP_SECONDS)))
    pending_start: int | None = None
    pending_state: str | None = None
    candidates: list[float] = []
    for index, value in enumerate(occupancy):
        observed = "high" if value >= high_threshold else "low" if value <= low_threshold else state
        if observed == state:
            pending_start = None
            pending_state = None
            continue
        if pending_state != observed:
            pending_state = observed
            pending_start = index
        if pending_start is not None and index - pending_start + 1 >= required:
            state = observed
            if state == target:
                candidates.append(float(times[pending_start]))
            pending_start = None
            pending_state = None
    return candidates


def _maximum_contrast(
    times: np.ndarray,
    db: np.ndarray,
    candidate: float,
    side: str,
    cfg: BoundaryRefinerConfig,
) -> tuple[float | None, float | None]:
    scan_mask = (times >= candidate - cfg.occupancy_window_seconds) & (
        times <= candidate + cfg.occupancy_window_seconds
    )
    points = times[scan_mask]
    scored: list[tuple[float, float]] = []
    for point in points:
        before = db[(times >= point - cfg.contrast_window_seconds) & (times < point)]
        after = db[(times >= point) & (times <= point + cfg.contrast_window_seconds)]
        if len(before) < 2 or len(after) < 2:
            continue
        before_median = float(np.median(before))
        after_median = float(np.median(after))
        contrast = after_median - before_median if side == "start" else before_median - after_median
        scored.append((float(point), float(contrast)))
    if not scored:
        return None, None
    best_contrast = max(value for _point, value in scored)
    near_best = [item for item in scored if item[1] >= best_contrast - 0.25]
    best_point, selected_contrast = min(near_best, key=lambda item: abs(item[0] - candidate))
    return best_point, selected_contrast


def _revert_diagnostic(diagnostic: dict[str, Any], reason: str, coarse: float) -> dict[str, Any]:
    return {
        **diagnostic,
        "automatic": round(float(coarse), 3),
        "delta_seconds": 0.0,
        "success": False,
        "reason": reason,
    }


def _rounded(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else round(float(value), digits)

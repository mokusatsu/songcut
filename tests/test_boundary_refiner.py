from __future__ import annotations

from unittest import mock

import numpy as np

from songcut.boundary_refiner import BoundaryRefinerConfig, refine_segments
from songcut.timestamps import Segment


def _pcm(*, duration: float = 80.0, song_start: float = 20.0, song_end: float = 60.0, sample_rate: int = 1000):
    rng = np.random.default_rng(7)
    samples = rng.normal(0.0, 0.01, (round(duration * sample_rate), 2)).astype(np.float32)
    samples[round(song_start * sample_rate) : round(song_end * sample_rate)] = rng.normal(
        0.0, 0.3, (round((song_end - song_start) * sample_rate), 2)
    )
    return samples, sample_rate


def test_refines_dense_song_boundaries_with_roll() -> None:
    samples, rate = _pcm()
    result = refine_segments(
        samples,
        [Segment(17.0, 63.0, 0.8, "acoustic-dsp")],
        sample_rate=rate,
        media_duration=80.0,
    )
    assert abs(result.segments[0].start - 19.5) <= 0.2
    assert abs(result.segments[0].end - 61.0) <= 0.2
    assert result.summary["refined_boundaries"] == 2
    assert result.segment_diagnostics[0]["start"]["success"] is True


def test_short_shout_and_song_break_do_not_replace_persistent_transitions() -> None:
    samples, rate = _pcm()
    rng = np.random.default_rng(8)
    samples[10 * rate : 11 * rate] = rng.normal(0.0, 0.3, (rate, 2))
    samples[40 * rate : 41 * rate] = rng.normal(0.0, 0.01, (rate, 2))
    result = refine_segments(samples, [Segment(18.0, 62.0)], sample_rate=rate, media_duration=80.0)
    assert abs(result.segments[0].start - 19.5) <= 0.2
    assert abs(result.segments[0].end - 61.0) <= 0.2


def test_uniform_level_and_disabled_keep_coarse_boundaries() -> None:
    samples = np.full((20_000, 2), 0.1, dtype=np.float32)
    coarse = [Segment(3.0, 17.0)]
    uniform = refine_segments(samples, coarse, sample_rate=1000, media_duration=20.0)
    disabled = refine_segments(
        samples,
        coarse,
        sample_rate=1000,
        media_duration=20.0,
        config=BoundaryRefinerConfig(enabled=False),
    )
    assert uniform.segments == coarse
    assert uniform.segment_diagnostics[0]["start"]["reason"] == "uniform-level"
    assert disabled.segments == coarse
    assert disabled.summary["skipped_reason"] == "disabled"


def test_adjacent_overlap_reverts_both_competing_boundaries() -> None:
    samples, rate = _pcm()
    segments = [Segment(10.0, 30.0), Segment(31.0, 70.0)]
    diagnostics = {
        "side": "end", "coarse": 30.0, "search_start": 0.0, "search_end": 60.0,
        "otsu_threshold_db": -20.0, "low_cluster_median_db": -40.0, "high_cluster_median_db": -10.0,
        "transition_candidates": [31.0], "selected_candidate": 31.0, "contrast_point": 31.0,
        "contrast_db": 10.0, "roll_seconds": 1.0, "automatic": 32.0, "delta_seconds": 2.0,
        "success": True, "reason": "refined",
    }
    values = [
        (10.0, {**diagnostics, "side": "start", "automatic": 10.0}),
        (32.0, diagnostics),
        (29.0, {**diagnostics, "side": "start", "automatic": 29.0}),
        (70.0, {**diagnostics, "automatic": 70.0}),
    ]
    with mock.patch("songcut.boundary_refiner._refine_boundary", side_effect=values):
        result = refine_segments(samples, segments, sample_rate=rate, media_duration=80.0)
    assert len(result.segments) == 2
    assert result.segments[0].end == 30.0
    assert result.segments[1].start == 31.0
    assert result.segment_diagnostics[0]["end"]["reason"] == "adjacent-overlap"

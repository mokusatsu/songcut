from __future__ import annotations

import json
from dataclasses import replace

import pytest

from uta_align.alignment import recognition_gaps
from uta_align.backends import FakeBackend
from uta_align.config import AlignConfig
from uta_align.lyrics import parse_lyrics_text
from uta_align.models import BoundarySupport, Observation
from uta_align.pipeline import align_lyrics


def observation(
    start: float,
    end: float,
    text: str,
    *,
    boundary_support: BoundarySupport = "segment",
) -> Observation:
    return Observation(
        start,
        end,
        text,
        0.96,
        0.01,
        "perturbed",
        boundary_support=boundary_support,
    )


def base_config(**changes: object) -> AlignConfig:
    base = AlignConfig(
        require_segment_word_corroboration=False,
        boundary_search_seconds=0,
        hard_gap_seconds=2,
        long_gap_seconds=8,
    )
    return replace(base, **changes)


def test_one_sided_edge_lines_use_anchor_fallback(wav_factory) -> None:
    audio = wav_factory(duration=60)
    lyrics = parse_lyrics_text("先頭欠落\n中央だけ認識\n末尾欠落")
    backend = FakeBackend([observation(30, 31, "中央だけ認識")])
    result = align_lyrics(audio, lyrics, backend, config=base_config())
    assert result.diagnostics["fallback"]["stage"] == 3
    assert (result.lines[1].start, result.lines[1].end) == pytest.approx((30, 31))
    assert all(
        left.end <= right.start
        for left, right in zip(result.lines, result.lines[1:], strict=False)
    )


def test_two_second_recognition_only_gap_remains_soft(wav_factory) -> None:
    audio = wav_factory(duration=12, active=[(1, 2), (8, 9)])
    lyrics = parse_lyrics_text("前\n欠落した中央\n後")
    backend = FakeBackend(
        [observation(1, 2, "前"), observation(8, 9, "後")]
    )
    result = align_lyrics(
        audio,
        lyrics,
        backend,
        config=base_config().merged(
            {"max_progress_deviation": 0.25}
        ),
    )
    assert all(
        line.end - line.start >= base_config().min_line_seconds
        for line in result.lines
    )
    assert result.diagnostics["recognition_only_soft_gaps"]
    recognition_entries = [
        item
        for item in result.diagnostics["forbidden_interval_provenance"]
        if item["provenance"] == "recognition_only_gap"
    ]
    assert recognition_entries
    assert all(item["hard"] is False for item in recognition_entries)
    assert result.diagnostics["hard_forbidden_intervals"] == []


def test_broad_segment_coverage_prevents_false_word_gap() -> None:
    observations = [
        observation(1, 6, "segment"),
        observation(1.2, 2, "word one"),
        observation(4.5, 5, "word two"),
    ]
    assert recognition_gaps(observations, 2) == []



def test_unrelated_observation_does_not_close_lyric_supported_gap(wav_factory) -> None:
    audio = wav_factory(duration=24)
    lyrics = parse_lyrics_text("前の歌詞\n後の歌詞")
    backend = FakeBackend([
        observation(1, 2, "前の歌詞"),
        observation(10, 11, "UNRELATED_RAW_TOKEN"),
        observation(20, 21, "後の歌詞"),
    ])
    result = align_lyrics(
        audio,
        lyrics,
        backend,
        config=base_config(window_seconds=12, overlap_seconds=3),
    )
    assert (2, 20) in result.diagnostics["post_retry_recognition_gaps"]
    assert result.diagnostics["lyric_supported_observation_count"] < (
        result.diagnostics["observation_count_clean"]
    )
    assert "UNRELATED_RAW_TOKEN" not in json.dumps(
        result.to_dict(),
        ensure_ascii=False,
    )


def test_strict_silence_intersection_falls_back_provisionally(wav_factory) -> None:
    mixture = wav_factory(duration=10, name="mixture.wav")
    stem = wav_factory(
        duration=10,
        active=[(0, 3), (5.02, 10)],
        name="stem.wav",
    )
    lyrics = parse_lyrics_text("禁止区間から始まる候補")
    backend = FakeBackend([observation(4.5, 7.0, "禁止区間から始まる候補")])
    result = align_lyrics(
        mixture,
        lyrics,
        backend,
        config=base_config(),
        vocal_stem_path=stem,
    )
    assert result.diagnostics["fallback"]["stage"] == 4
    assert result.diagnostics["fallback"]["warnings"]


def test_candidate_longer_than_max_line_seconds_uses_global_fallback(wav_factory) -> None:
    audio = wav_factory(duration=20)
    backend = FakeBackend([observation(1, 14, "長すぎる候補")])
    result = align_lyrics(
        audio,
        parse_lyrics_text("長すぎる候補"),
        backend,
        config=base_config(max_line_seconds=12),
    )
    assert result.diagnostics["fallback"]["stage"] == 4
    assert 0 < result.lines[0].end - result.lines[0].start <= 12


def test_trusted_vocal_activity_recovers_perturbed_long_vowel_edges(wav_factory) -> None:
    vocal = wav_factory(duration=7, active=[(1, 5)])
    lyrics = parse_lyrics_text("遠くへー")
    backend = FakeBackend(
        [observation(2.15, 2.55, "遠くへー", boundary_support="word")]
    )
    result = align_lyrics(
        vocal,
        lyrics,
        backend,
        config=base_config(input_audio_is_vocal_only=True),
    )
    line = result.lines[0]
    assert line.start == pytest.approx(1.0, abs=0.12)
    assert line.end == pytest.approx(5.0, abs=0.12)
    assert line.diagnostics["boundary_support"]["trusted_activity_supported"]
    assert "trusted-vocal-activity" in line.provenance


def test_neighbor_anchors_partition_one_trusted_activity_component(wav_factory) -> None:
    vocal = wav_factory(duration=11, active=[(1, 9)])
    backend = FakeBackend(
        [
            observation(2, 3, "前の長音ー", boundary_support="word"),
            observation(7, 8, "後の長音ー", boundary_support="word"),
        ]
    )
    result = align_lyrics(
        vocal,
        parse_lyrics_text("前の長音ー\n後の長音ー"),
        backend,
        config=base_config(input_audio_is_vocal_only=True),
    )
    assert result.lines[0].start == pytest.approx(1, abs=0.12)
    assert result.lines[0].end == pytest.approx(5, abs=0.2)
    assert result.lines[1].start == pytest.approx(5, abs=0.2)
    assert result.lines[1].end == pytest.approx(9, abs=0.12)


def test_word_only_boundaries_on_a_mixture_are_marked_relaxed(wav_factory) -> None:
    mixture = wav_factory(duration=7, active=[(1, 5)])
    result = align_lyrics(
        mixture,
        parse_lyrics_text("遠くへー"),
        FakeBackend([
            observation(2.15, 2.55, "遠くへー", boundary_support="word")
        ]),
        config=base_config(),
    )
    assert result.diagnostics["fallback"]["stage"] == 4
    clusters = result.diagnostics["candidate_consensus"]["lines"]["0"]
    assert clusters[0]["quality_reason"] == "word_or_unknown_boundary_on_mixture"
    assert clusters[0]["freeze_eligible"] is False


def test_segment_boundary_supports_a_line_on_a_mixture(wav_factory) -> None:
    mixture = wav_factory(duration=7, active=[(1, 5)])
    result = align_lyrics(
        mixture,
        parse_lyrics_text("遠くへー"),
        FakeBackend(
            [
                observation(1.1, 4.9, "遠くへー", boundary_support="segment"),
                observation(2.15, 2.55, "遠くへー", boundary_support="word"),
            ]
        ),
        config=base_config(),
    )
    assert result.lines[0].start == pytest.approx(1.1)
    assert result.lines[0].end == pytest.approx(4.9)
    support = result.lines[0].diagnostics["boundary_support"]
    assert support["model_boundary_supported"]
    assert support["model_boundary_kind"] == "segment"


def test_distant_segment_without_word_corroboration_uses_fallback(wav_factory) -> None:
    mixture = wav_factory(duration=9)
    backend = FakeBackend(
        [
            observation(1, 2, "一度だけの歌詞", boundary_support="word"),
            observation(5, 6, "一度だけの歌詞", boundary_support="segment"),
        ]
    )
    result = align_lyrics(
        mixture,
        parse_lyrics_text("一度だけの歌詞"),
        backend,
        config=base_config(),
    )
    assert result.lines[0].text == "一度だけの歌詞"
    assert result.lines[0].start >= 0.0


def test_insufficient_segment_boundary_is_marked_relaxed(wav_factory) -> None:
    mixture = wav_factory(duration=7)
    backend = FakeBackend([
        observation(2.15, 2.55, "短いsegment", boundary_support="word"),
        observation(2.14, 2.57, "短いsegment", boundary_support="segment"),
    ])
    result = align_lyrics(
        mixture,
        parse_lyrics_text("短いsegment"),
        backend,
        config=base_config(),
    )
    assert result.diagnostics["fallback"]["stage"] == 4
    clusters = result.diagnostics["candidate_consensus"]["lines"]["0"]
    assert clusters[0]["quality_reason"] == (
        "word_or_unknown_boundary_on_mixture"
    )
    assert clusters[0]["freeze_eligible"] is False


def test_ambiguous_repeated_candidate_assignment_uses_fallback(wav_factory) -> None:
    audio = wav_factory(duration=12)
    lyrics = parse_lyrics_text("繰返し\n固有行\n繰返し")
    backend = FakeBackend([
        observation(1, 2, "繰返し"),
        observation(4, 5, "繰返し"),
        observation(5.2, 6.2, "固有行"),
        observation(9, 10, "繰返し"),
    ])
    result = align_lyrics(
        audio,
        lyrics,
        backend,
        config=base_config().merged(
            {"max_progress_deviation": 0.25}
        ),
    )
    assert result.diagnostics["fallback"]["stage"] in {2, 3}
    assert result.diagnostics["fallback"]["recognition_only_soft_gap_count"] > 0
    assert len(result.lines) == 3


def test_single_line_with_two_equal_exact_times_uses_relaxed_fallback(wav_factory) -> None:
    audio = wav_factory(duration=9)
    backend = FakeBackend([
        observation(1, 2, "一度だけの歌詞"),
        observation(5, 6, "一度だけの歌詞"),
    ])
    result = align_lyrics(
        audio,
        parse_lyrics_text("一度だけの歌詞"),
        backend,
        config=base_config(),
    )
    assert result.diagnostics["fallback"]["stage"] == 4
    clusters = result.diagnostics["candidate_consensus"]["lines"]["0"]
    assert all(cluster["freeze_eligible"] is False for cluster in clusters)
    assert result.lines[0].confidence <= 0.04


def test_short_audio_with_good_head_anchor_calls_base_pair(wav_factory) -> None:
    audio = wav_factory(duration=7, active=[(1, 5)])
    backend = FakeBackend(
        [observation(2.15, 2.55, "先頭行", boundary_support="word")]
    )
    result = align_lyrics(
        audio,
        parse_lyrics_text("先頭行"),
        backend,
        config=base_config(input_audio_is_vocal_only=True),
    )
    assert result.lines[0].text == "先頭行"
    assert [request.prompt_strategy for request in backend.requests] == [
        "unprompted",
        "global_initial_prompt",
    ]
    assert backend.requests[0].kind == "global"


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"max_line_seconds": 0.1}, "line duration"),
        ({"hard_gap_seconds": 0}, "hard_gap"),
        ({"adaptive_boundary_seconds": 0.5, "boundary_search_seconds": 1}, "adaptive"),
        ({"max_observation_span": 0}, "max_observation_span"),
        ({"word_boundary_confidence_scale": 0}, "word_boundary"),
        ({"window_seconds": float("nan")}, "finite"),
        ({"beam_size": 0}, "beam_size"),
    ],
)
def test_config_boundary_validation(changes: dict[str, object], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        base_config(**changes).validate()

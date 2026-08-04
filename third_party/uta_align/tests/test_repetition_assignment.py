from __future__ import annotations

import json
from pathlib import Path

import pytest

from uta_align.alignment import AlignmentError, select_anchors
from uta_align.backends import FakeBackend
from uta_align.cli import main
from uta_align.config import AlignConfig
from uta_align.lyrics import parse_lyrics_text
from uta_align.models import Candidate, Observation
from uta_align.pipeline import align_lyrics


def repeat_config() -> AlignConfig:
    return AlignConfig(
        require_segment_word_corroboration=False,
        boundary_search_seconds=0,
        hard_gap_seconds=2,
        long_gap_seconds=8,
        ambiguity_score_margin=0.65,
    )


def candidate(
    line_index: int,
    observation_index: int,
    start: float,
    end: float,
    *,
    score: float = 6.0,
) -> Candidate:
    return Candidate(
        line_index=line_index,
        obs_start_index=observation_index,
        obs_end_index=observation_index,
        start=start,
        end=end,
        similarity=1.0,
        confidence=0.95,
        score=score,
        provenance=("public-repeat",),
        boundary_support="segment",
    )


def observation(start: float, end: float, text: str) -> Observation:
    return Observation(
        start,
        end,
        text,
        0.96,
        0.01,
        "public-repeat",
        boundary_support="segment",
    )


@pytest.mark.parametrize("count", [2, 4, 6, 8])
def test_near_tied_repetitions_use_one_ordered_occurrence_slot_each(count: int) -> None:
    lyrics = parse_lyrics_text("\n".join(["反復"] * count))
    times = [(1.0 + index * 2, 2.0 + index * 2) for index in range(count)]
    candidates = {
        line.index: [
            candidate(line.index, slot, start, end, score=-1.0)
            for slot, (start, end) in enumerate(times)
        ]
        for line in lyrics
    }
    anchors, diagnostics = select_anchors(lyrics, candidates, repeat_config())
    assert [anchors[index].start for index in range(count)] == [
        start for start, _ in times
    ]
    resolved = diagnostics["resolved_repetition_ambiguities"]
    assert resolved
    assert all(
        "normalized_lyric" not in group
        and str(group["group_id"]).startswith("repetition_resolution_")
        for ambiguity in resolved
        for group in ambiguity["groups"]
    )
    assert "反復" not in str(resolved)


def test_repetition_slots_are_bounded_by_unique_surrounding_anchors() -> None:
    lyrics = parse_lyrics_text("intro\n反復\n反復\n反復\noutro")
    repeat_times = [(3, 4), (5, 6), (7, 8)]
    candidates = {
        0: [candidate(0, 0, 1, 2)],
        1: [candidate(1, i + 1, *time, score=-1.0) for i, time in enumerate(repeat_times)],
        2: [candidate(2, i + 1, *time, score=-1.0) for i, time in enumerate(repeat_times)],
        3: [candidate(3, i + 1, *time, score=-1.0) for i, time in enumerate(repeat_times)],
        4: [candidate(4, 4, 9, 10)],
    }
    anchors, diagnostics = select_anchors(lyrics, candidates, repeat_config())
    assert [anchors[index].start for index in (1, 2, 3)] == [3, 5, 7]
    assert diagnostics["anchor_count"] == 5


def test_explicit_blocks_preserve_repetition_order_across_long_gap() -> None:
    lyrics = parse_lyrics_text("反復\n反復\n\n反復\n反復")
    times = [(1, 2), (3, 4), (15, 16), (17, 18)]
    candidates = {
        line.index: [
            candidate(line.index, slot, *time, score=6.0)
            for slot, time in enumerate(times)
        ]
        for line in lyrics
    }
    anchors, _ = select_anchors(lyrics, candidates, repeat_config())
    assert [anchors[index].start for index in range(4)] == [1, 3, 15, 17]


def test_supported_missing_internal_repetition_uses_anchor_position_prior() -> None:
    lyrics = parse_lyrics_text("intro\n反復\n反復\n反復\noutro")
    candidates = {
        0: [candidate(0, 0, 1, 2)],
        1: [candidate(1, 1, 3.5, 4.5), candidate(1, 2, 7.5, 8.5)],
        2: [candidate(2, 1, 3.5, 4.5), candidate(2, 2, 7.5, 8.5)],
        3: [candidate(3, 1, 3.5, 4.5), candidate(3, 2, 7.5, 8.5)],
        4: [candidate(4, 3, 10, 11)],
    }
    anchors, diagnostics = select_anchors(lyrics, candidates, repeat_config())
    assert 1 in anchors and 2 not in anchors and 3 in anchors
    assert diagnostics["repetition_position_cost"] is not None


def test_strict_selector_reports_unresolved_single_line_ambiguity() -> None:
    lyrics = parse_lyrics_text("単一行")
    candidates = {
        0: [candidate(0, 0, 1, 2), candidate(0, 1, 5, 6)]
    }
    with pytest.raises(AlignmentError) as captured:
        select_anchors(lyrics, candidates, repeat_config())
    error = captured.value
    assert error.code == "ambiguous_timing_candidates"
    assert error.diagnostics["reason_code"] == "ambiguous_timing_candidates"
    assert error.diagnostics["affected_lyric_line_indexes"] == [0]
    assert error.diagnostics["best_path"]
    assert error.diagnostics["competing_candidates"]


def test_pipeline_ambiguity_returns_structured_relaxed_fallback(wav_factory) -> None:
    audio = wav_factory(duration=8)
    backend = FakeBackend([
        observation(1, 2, "単一行"),
        observation(5, 6, "単一行"),
    ])
    result = align_lyrics(
        audio,
        parse_lyrics_text("単一行"),
        backend,
        config=repeat_config(),
    )
    fallback = result.diagnostics["fallback"]
    assert fallback["stage"] == 4
    assert fallback["reason_codes"] == [
        "alignment_error",
        "barrier_aware_provisional_schedule",
    ]
    assert fallback["stt_request_count"] == len(backend.requests)
    clusters = result.diagnostics["candidate_consensus"]["lines"]["0"]
    assert {cluster["quality_reason"] for cluster in clusters} == {
        "competing_temporal_clusters"
    }
    assert all(cluster["freeze_eligible"] is False for cluster in clusters)
    assert result.lines[0].confidence <= 0.04


def test_cli_ambiguity_fallback_writes_json(tmp_path: Path, wav_factory) -> None:
    audio = wav_factory(duration=8)
    lyrics = tmp_path / "lyrics.txt"
    lyrics.write_text("単一行\n", encoding="utf-8")
    transcript = tmp_path / "recognized.json"
    transcript.write_text(
        json.dumps(
            {
                "observations": [
                    {"start": 1, "end": 2, "text": "単一行"},
                    {"start": 5, "end": 6, "text": "単一行"},
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    output = tmp_path / "fallback.json"
    status = main([
        str(audio),
        str(lyrics),
        "--backend", "json",
        "--transcript-json", str(transcript),
        "--output", str(output),
        "--boundary-search-seconds", "0",
    ])
    assert status == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["diagnostics"]["fallback"]["stage"] == 4
    assert payload["lines"][0]["provenance"][-1] == (
        "fallback_stage_4_safe_component_schedule"
    )
    clusters = payload["diagnostics"]["candidate_consensus"]["lines"]["0"]
    assert all(
        cluster["quality_reason"]
        == "segment_without_word_corroboration"
        for cluster in clusters
    )

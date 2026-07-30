from __future__ import annotations

from uta_align.config import AlignConfig
from uta_align.fallback import build_fallback_alignment
from uta_align.lyrics import parse_lyrics_text
from uta_align.models import Candidate


def candidate(
    line_index: int,
    start: float,
    end: float,
    *,
    score: float = 6.0,
) -> Candidate:
    return Candidate(
        line_index=line_index,
        obs_start_index=line_index,
        obs_end_index=line_index,
        start=start,
        end=end,
        similarity=1.0,
        confidence=0.9,
        score=score,
        provenance=("public-synthetic",),
        boundary_support="segment",
    )


def config(**changes: object) -> AlignConfig:
    values = {
        "boundary_search_seconds": 0,
        "min_line_seconds": 0.16,
        "max_line_seconds": 12.0,
        "require_segment_word_corroboration": False,
    }
    values.update(changes)
    return AlignConfig(**values)


def test_late_component_anchor_is_frozen_instead_of_earliest_fit() -> None:
    lyrics = parse_lyrics_text("未認識行\n後方anchor")
    outcome = build_fallback_alignment(
        lyrics,
        {1: candidate(1, 25, 27)},
        30,
        [(10, 20)],
        [],
        config(),
        reason="public_synthetic",
    )
    assert outcome.stage == 3
    assert (outcome.lines[1].start, outcome.lines[1].end) == (25, 27)
    assert 20 <= outcome.lines[0].start < outcome.lines[0].end <= 25
    assert outcome.lines[1].provenance[-1] == "fallback_stage_3_anchor_frozen"


def test_multiple_anchors_remain_fixed_across_multiple_components() -> None:
    lyrics = parse_lyrics_text("A0\nmissing one\nA1\nmissing two\nA2")
    anchors = {
        0: candidate(0, 1, 2),
        2: candidate(2, 21, 22),
        4: candidate(4, 41, 42),
    }
    outcome = build_fallback_alignment(
        lyrics,
        anchors,
        50,
        [(10, 20), (30, 40)],
        [],
        config(),
        reason="public_synthetic",
    )
    assert outcome.stage == 3
    assert [(outcome.lines[i].start, outcome.lines[i].end) for i in (0, 2, 4)] == [
        (1, 2),
        (21, 22),
        (41, 42),
    ]
    assert all(not (line.start < 20 and line.end > 10) for line in outcome.lines)
    assert all(not (line.start < 40 and line.end > 30) for line in outcome.lines)


def test_leading_and_trailing_lines_choose_nearest_feasible_components() -> None:
    lyrics = parse_lyrics_text("leading\nanchor\ntrailing")
    outcome = build_fallback_alignment(
        lyrics,
        {1: candidate(1, 25, 27)},
        50,
        [(10, 20), (30, 40)],
        [],
        config(),
        reason="public_synthetic",
    )
    assert outcome.stage == 3
    assert 20 <= outcome.lines[0].start < outcome.lines[0].end <= 25
    assert 27 <= outcome.lines[2].start < outcome.lines[2].end <= 30


def test_forbidden_anchor_is_demoted_without_cross_component_projection() -> None:
    lyrics = parse_lyrics_text("left\nbad anchor\nright")
    outcome = build_fallback_alignment(
        lyrics,
        {
            0: candidate(0, 2, 3),
            1: candidate(1, 12, 13),
            2: candidate(2, 25, 26),
        },
        30,
        [(10, 20)],
        [],
        config(),
        reason="public_synthetic",
    )
    assert outcome.stage == 3
    assert (outcome.lines[0].start, outcome.lines[0].end) == (2, 3)
    assert (outcome.lines[2].start, outcome.lines[2].end) == (25, 26)
    assert (outcome.lines[1].start, outcome.lines[1].end) != (12, 13)
    assert outcome.lines[1].end <= 10 or outcome.lines[1].start >= 20
    demoted = outcome.diagnostics["demoted_anchors"]
    assert len(demoted) == 1
    assert demoted[0]["lyric_line_index"] == 1
    assert demoted[0]["reason"] == "forbidden_interval_collision"
    assert demoted[0]["original_time"] == [12, 13]
    assert demoted[0]["freeze_eligible"] is True
    assert demoted[0]["quality_reason"] == "legacy_candidate"


def test_order_conflicting_anchor_is_demoted_instead_of_moved() -> None:
    lyrics = parse_lyrics_text("bad early order\nkept one\nkept two")
    outcome = build_fallback_alignment(
        lyrics,
        {
            0: candidate(0, 25, 27, score=1),
            1: candidate(1, 5, 7, score=8),
            2: candidate(2, 28, 29, score=8),
        },
        30,
        [],
        [],
        config(),
        reason="public_synthetic",
    )
    assert outcome.stage == 3
    assert (outcome.lines[1].start, outcome.lines[1].end) == (5, 7)
    assert (outcome.lines[2].start, outcome.lines[2].end) == (28, 29)
    assert outcome.lines[0].end <= 5
    assert outcome.lines[0].diagnostics["demoted_anchor_reason"] == (
        "monotonic_order_conflict"
    )


def test_stage_three_capacity_failure_falls_through_to_stage_four() -> None:
    lyrics = parse_lyrics_text("one\ntwo\nthree\nanchor")
    outcome = build_fallback_alignment(
        lyrics,
        {3: candidate(3, 9.2, 9.8)},
        10,
        [(0.3, 9.0)],
        [],
        config(),
        reason="public_synthetic",
    )
    assert outcome.stage == 4
    assert len(outcome.lines) == 4
    assert all(line.start < line.end for line in outcome.lines)

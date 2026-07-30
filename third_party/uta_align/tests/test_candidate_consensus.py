from __future__ import annotations

from dataclasses import replace

import pytest

from uta_align.alignment import build_candidate_consensus, select_anchors
from uta_align.backends import FakeBackend
from uta_align.config import AlignConfig
from uta_align.fallback import (
    _desired_centers,
    _stage_four,
    build_fallback_alignment,
)
from uta_align.lyrics import parse_lyrics_text
from uta_align.models import Candidate, Observation
from uta_align.pipeline import (
    _expand_unresolved_repetition_groups,
    _guard_confirmed_acoustic_silences,
    _semantic_no_singing_barriers,
    _separate_fallback_candidates,
    align_lyrics,
)


def config(**changes: object) -> AlignConfig:
    return replace(
        AlignConfig(
            require_segment_word_corroboration=False,
            boundary_search_seconds=0,
            min_similarity=0.42,
            anchor_similarity=0.57,
            hard_gap_seconds=2,
        ),
        **changes,
    )


def candidate(
    line_index: int,
    start: float,
    end: float,
    request_id: str,
    *,
    similarity: float = 1.0,
    confidence: float = 0.96,
    no_speech_prob: float = 0.01,
    boundary_support: str = "segment",
    freeze_eligible: bool = True,
    quality_score: float = 1.0,
    quality_reason: str = "public_fixture",
) -> Candidate:
    observation_index = round(start * 1000)
    return Candidate(
        line_index=line_index,
        obs_start_index=observation_index,
        obs_end_index=observation_index,
        start=start,
        end=end,
        similarity=similarity,
        confidence=confidence,
        score=6.0,
        provenance=("public-consensus",),
        boundary_support=boundary_support,  # type: ignore[arg-type]
        request_ids=(request_id,),
        support_observation_indexes=(observation_index,),
        no_speech_prob=no_speech_prob,
        freeze_eligible=freeze_eligible,
        quality_score=quality_score,
        quality_reason=quality_reason,
    )


def test_consensus_uses_robust_median_for_agreeing_passes_with_outlier() -> None:
    lyrics = parse_lyrics_text("合意する歌詞")
    inputs = {
        0: [
            candidate(0, 10.00, 11.00, "global"),
            candidate(0, 10.10, 11.10, "overlap-a"),
            candidate(0, 10.80, 11.80, "overlap-outlier"),
        ]
    }

    consensus, diagnostics = build_candidate_consensus(
        lyrics,
        inputs,
        config(),
        normal_mix=True,
    )

    chosen = consensus[0][0]
    assert chosen.start == pytest.approx(10.10)
    assert chosen.end == pytest.approx(11.10)
    assert chosen.support_count == 3
    assert chosen.time_dispersion == pytest.approx(0.10)
    assert chosen.freeze_eligible is True
    assert chosen.quality_reason == "high_quality_temporal_consensus"
    public_cluster = diagnostics["lines"]["0"][0]
    assert public_cluster["request_ids"] == [
        "global",
        "overlap-a",
        "overlap-outlier",
    ]
    assert "合意する歌詞" not in str(diagnostics)


def test_single_pass_generic_segment_is_a_hint_not_a_frozen_anchor() -> None:
    lyrics = parse_lyrics_text("一回だけ")
    consensus, diagnostics = build_candidate_consensus(
        lyrics,
        {0: [candidate(0, 4.0, 5.0, "global")]},
        config(),
        normal_mix=True,
    )

    chosen = consensus[0][0]
    assert chosen.freeze_eligible is False
    assert chosen.quality_reason == "single_pass_generic_boundary_on_mixture"
    assert diagnostics["lines"]["0"][0]["support_count"] == 1


def test_two_high_quality_temporal_clusters_are_demoted_for_unique_line() -> None:
    lyrics = parse_lyrics_text("一度だけの歌詞")
    hypotheses = {
        0: [
            candidate(0, 1.00, 2.00, "global"),
            candidate(0, 1.05, 2.05, "overlap-a"),
            candidate(0, 5.00, 6.00, "head-retry-a"),
            candidate(0, 5.05, 6.05, "head-retry-b"),
        ]
    }

    consensus, diagnostics = build_candidate_consensus(
        lyrics,
        hypotheses,
        config(),
        normal_mix=True,
    )

    assert len(consensus[0]) == 2
    assert all(item.freeze_eligible is False for item in consensus[0])
    assert {
        item.quality_reason for item in consensus[0]
    } == {"competing_temporal_clusters"}
    assert all(
        item["quality_reason"] == "competing_temporal_clusters"
        for item in diagnostics["lines"]["0"]
    )


def test_repeated_lyrics_keep_separate_high_quality_occurrence_slots() -> None:
    lyrics = parse_lyrics_text("反復句\n反復句")
    hypotheses = {
        line.index: [
            candidate(line.index, 1.00, 2.00, "global-a"),
            candidate(line.index, 1.05, 2.05, "overlap-a"),
            candidate(line.index, 5.00, 6.00, "global-b"),
            candidate(line.index, 5.05, 6.05, "overlap-b"),
        ]
        for line in lyrics
    }

    consensus, _ = build_candidate_consensus(
        lyrics,
        hypotheses,
        config(),
        normal_mix=True,
    )
    assert all(
        item.freeze_eligible
        for line_candidates in consensus.values()
        for item in line_candidates
    )
    anchors, _ = select_anchors(lyrics, consensus, config())
    assert [anchors[index].start for index in range(2)] == pytest.approx(
        [1.00, 5.00]
    )


def test_semantic_barrier_requires_adjacent_high_quality_anchors() -> None:
    lyrics = parse_lyrics_text("前の歌詞\n後の歌詞")
    strong = {
        0: replace(
            candidate(0, 1.0, 2.0, "a"),
            consensus=True,
            support_count=2,
            quality_score=0.95,
        ),
        1: replace(
            candidate(1, 8.0, 9.0, "b"),
            consensus=True,
            support_count=2,
            quality_score=0.94,
        ),
    }

    intervals, diagnostics = _semantic_no_singing_barriers(
        lyrics,
        strong,
        config(),
    )

    assert intervals == [(2.0, 8.0)]
    assert diagnostics == [
        {
            "left_lyric_line_index": 0,
            "right_lyric_line_index": 1,
            "start": 2.0,
            "end": 8.0,
            "duration": 6.0,
            "left_quality_score": 0.95,
            "right_quality_score": 0.94,
            "reason": "adjacent_high_quality_lyrics_leave_no_missing_line",
        }
    ]

    weak_right = dict(strong)
    weak_right[1] = replace(strong[1], quality_score=0.2)
    assert _semantic_no_singing_barriers(lyrics, weak_right, config())[0] == []


def test_demoted_hint_cannot_cross_forbidden_component() -> None:
    lyrics = parse_lyrics_text("左アンカー\n弱い候補\n右アンカー")
    frozen_anchors = {
        0: replace(
            candidate(0, 1.0, 2.0, "left"),
            consensus=True,
            support_count=2,
            quality_score=0.95,
        ),
        2: replace(
            candidate(2, 9.0, 10.0, "right"),
            consensus=True,
            support_count=2,
            quality_score=0.95,
        ),
    }
    weak_hints = {
        1: replace(
            candidate(1, 5.0, 6.0, "weak"),
            consensus=True,
            support_count=1,
            quality_score=0.45,
            freeze_eligible=False,
            quality_reason="single_pass_generic_boundary_on_mixture",
        )
    }

    outcome = build_fallback_alignment(
        lyrics,
        frozen_anchors,
        duration=12,
        forbidden=[(4.0, 8.0)],
        activity_components=[],
        config=config(),
        weak_hints=weak_hints,
        reason="public_quality_gate",
    )

    middle = outcome.lines[1]
    assert outcome.stage == 3
    assert outcome.diagnostics["strong_selected_count"] == 2
    assert outcome.diagnostics["strong_frozen_count"] == 2
    assert outcome.diagnostics["strong_demoted_count"] == 0
    assert outcome.diagnostics["weak_hint_input_count"] == 1
    assert outcome.diagnostics["weak_hint_count"] == 0
    assert outcome.diagnostics["actual_weak_hint_used_count"] == 0
    assert middle.end <= 4.0 or middle.start >= 8.0
    assert middle.diagnostics["demoted_anchor_reason"] == (
        "single_pass_generic_boundary_on_mixture"
    )
    assert middle.diagnostics["weak_hint_center"] is None



def test_fallback_selection_preserves_strong_over_higher_score_weak() -> None:
    lyrics = parse_lyrics_text("強い一\n強い二")
    candidates = {
        0: [
            replace(
                candidate(0, 1.0, 2.0, "strong-0"),
                score=5.0,
                freeze_eligible=True,
            ),
            replace(
                candidate(0, 10.0, 11.0, "weak-0"),
                score=50.0,
                freeze_eligible=False,
                quality_reason="weak_high_score",
            ),
        ],
        1: [
            replace(
                candidate(1, 3.0, 4.0, "strong-1"),
                score=5.0,
                freeze_eligible=True,
            ),
            replace(
                candidate(1, 12.0, 13.0, "weak-1"),
                score=50.0,
                freeze_eligible=False,
                quality_reason="weak_high_score",
            ),
        ],
    }

    strong, weak, diagnostics = _separate_fallback_candidates(
        lyrics,
        candidates,
        config(),
        ambiguous_line_indexes=set(),
    )

    assert [strong[index].start for index in range(2)] == [1.0, 3.0]
    assert weak == {}
    assert diagnostics["strong_selected_count"] == 2
    assert diagnostics["weak_hint_count"] == 0
    assert diagnostics["strong_overwrite_prevented_line_indexes"] == [0, 1]
    assert diagnostics["strong_overwrite_prevention_reason"] == (
        "strong_anchor_preserved_over_relaxed_candidate"
    )


def test_fallback_selection_uses_weak_only_where_strong_is_missing() -> None:
    lyrics = parse_lyrics_text("強い行\n弱い行")
    candidates = {
        0: [
            replace(candidate(0, 1.0, 2.0, "strong"), score=5.0),
            replace(
                candidate(0, 8.0, 9.0, "weak-overwrite"),
                score=60.0,
                freeze_eligible=False,
                quality_reason="weak_high_score",
            ),
        ],
        1: [
            replace(
                candidate(1, 10.0, 11.0, "weak-only"),
                score=50.0,
                freeze_eligible=False,
                quality_reason="weak_only",
            )
        ],
    }

    strong, weak, diagnostics = _separate_fallback_candidates(
        lyrics,
        candidates,
        config(),
        ambiguous_line_indexes=set(),
    )

    assert strong[0].start == 1.0
    assert set(weak) == {1}
    assert weak[1].start == 10.0
    assert diagnostics["weak_hint_count"] == 1


def test_local_strong_ambiguity_does_not_drop_other_strong_lines() -> None:
    lyrics = parse_lyrics_text("前\n競合\n後")
    candidates = {
        0: [replace(candidate(0, 1.0, 2.0, "a"), score=5.0)],
        1: [
            replace(candidate(1, 3.0, 4.0, "b1"), score=5.0),
            replace(candidate(1, 5.0, 6.0, "b2"), score=5.0),
        ],
        2: [replace(candidate(2, 7.0, 8.0, "c"), score=5.0)],
    }

    strong, weak, diagnostics = _separate_fallback_candidates(
        lyrics,
        candidates,
        config(),
        ambiguous_line_indexes={1},
    )

    assert set(strong) == {0, 2}
    assert set(weak) == {1}
    assert diagnostics["strong_local_ambiguity_demoted_line_indexes"] == [1]
    assert diagnostics["strong_selected_count"] == 2


def test_stage_four_respects_multiple_barriers() -> None:
    lyrics = parse_lyrics_text("一\n二\n三\n四\n五")
    forbidden = [(2.0, 4.0), (6.0, 8.0)]

    outcome = build_fallback_alignment(
        lyrics,
        {},
        duration=10.0,
        forbidden=forbidden,
        activity_components=[],
        config=config(),
        weak_hints={},
        reason="public_barrier_test",
    )

    assert outcome.stage == 4
    assert len(outcome.lines) == len(lyrics)
    assert outcome.diagnostics["forbidden_respected"] is True
    assert outcome.diagnostics["barrier_override"] is False
    for line in outcome.lines:
        assert not any(line.start < end and line.end > start for start, end in forbidden)


def test_stage_four_compresses_when_safe_capacity_is_below_minimum() -> None:
    lyrics = parse_lyrics_text("\n".join(f"行{index}" for index in range(8)))
    forbidden = [(0.08, 0.92)]

    outcome = build_fallback_alignment(
        lyrics,
        {},
        duration=1.0,
        forbidden=forbidden,
        activity_components=[],
        config=config(),
        weak_hints={},
        reason="public_capacity_test",
    )

    assert outcome.stage == 4
    assert outcome.diagnostics["forbidden_respected"] is True
    assert outcome.diagnostics["barrier_override"] is False
    assert outcome.diagnostics["compressed_line_count"] > 0
    assert "below_min_duration" in outcome.diagnostics["warnings"]
    assert len(outcome.lines) == len(lyrics)
    assert all(line.start < line.end for line in outcome.lines)
    assert all(line.confidence <= 0.02 for line in outcome.lines)
    safe = [(0.0, 0.08), (0.92, 1.0)]
    assert all(
        any(left <= line.start < line.end <= right for left, right in safe)
        for line in outcome.lines
    )
    assert all(
        left.end <= right.start
        for left, right in zip(outcome.lines, outcome.lines[1:], strict=False)
    )


def test_stage_four_uses_positive_capacity_below_normal_tolerance() -> None:
    lyrics = parse_lyrics_text("一\n二")

    outcome = build_fallback_alignment(
        lyrics,
        {},
        duration=1.0,
        forbidden=[(0.001, 0.999)],
        activity_components=[],
        config=config(),
        weak_hints={},
        reason="public_tiny_capacity_test",
    )

    assert outcome.stage == 4
    assert outcome.diagnostics["forbidden_respected"] is True
    assert outcome.diagnostics["barrier_override"] is False
    assert outcome.diagnostics["safe_capacity_seconds"] == pytest.approx(0.002)
    assert all(line.start < line.end for line in outcome.lines)
    assert all(line.confidence <= 0.02 for line in outcome.lines)


def test_stage_four_zero_safe_capacity_uses_explicit_emergency_override() -> None:
    lyrics = parse_lyrics_text("一\n二\n三")

    outcome = build_fallback_alignment(
        lyrics,
        {},
        duration=3.0,
        forbidden=[(0.0, 3.0)],
        activity_components=[],
        config=config(),
        weak_hints={},
        reason="public_zero_capacity_test",
    )

    assert outcome.stage == 4
    assert outcome.diagnostics["forbidden_respected"] is False
    assert outcome.diagnostics["barrier_override"] is True
    assert outcome.diagnostics["safe_component_count"] == 0
    assert outcome.diagnostics["safe_capacity_seconds"] == 0.0
    assert all(line.confidence <= 0.01 for line in outcome.lines)
    assert all(line.start < line.end for line in outcome.lines)



def test_stage_four_keeps_two_frozen_anchors_and_compresses_only_run() -> None:
    lyrics = parse_lyrics_text("固定前\n圧縮一\n圧縮二\n圧縮三\n固定後")
    frozen = {
        0: replace(
            candidate(0, 0.50, 0.70, "left"),
            quality_score=0.96,
            support_count=3,
        ),
        4: replace(
            candidate(4, 1.00, 1.20, "right"),
            quality_score=0.95,
            support_count=3,
        ),
    }
    weak = {
        2: replace(
            candidate(2, 0.82, 0.90, "hint"),
            freeze_eligible=False,
            quality_score=0.4,
            quality_reason="weak_hint",
        )
    }

    outcome = build_fallback_alignment(
        lyrics,
        frozen,
        duration=2.0,
        forbidden=[(1.30, 1.80)],
        activity_components=[],
        config=config(),
        weak_hints=weak,
        reason="public_anchor_stage4",
    )

    assert outcome.stage == 4
    assert (outcome.lines[0].start, outcome.lines[0].end) == (0.50, 0.70)
    assert (outcome.lines[4].start, outcome.lines[4].end) == (1.00, 1.20)
    assert outcome.lines[0].provenance[-1] == "fallback_stage_4_anchor_frozen"
    assert outcome.lines[4].provenance[-1] == "fallback_stage_4_anchor_frozen"
    assert all(
        0.70 <= line.start < line.end <= 1.00
        for line in outcome.lines[1:4]
    )
    assert all(line.confidence <= 0.02 for line in outcome.lines[1:4])
    assert outcome.diagnostics["classified_frozen_count"] == 2
    assert outcome.diagnostics["actual_frozen_count"] == 2
    assert outcome.diagnostics["strong_frozen_count"] == 2
    actual = sum(
        line.provenance[-1] == "fallback_stage_4_anchor_frozen"
        for line in outcome.lines
    )
    assert outcome.diagnostics["actual_frozen_count"] == actual
    assert outcome.diagnostics["forbidden_respected"] is True


@pytest.mark.parametrize(
    ("lyrics_text", "frozen", "forbidden", "compressed_indexes"),
    [
        (
            "先頭一\n先頭二\n固定",
            {2: replace(candidate(2, 0.20, 0.40, "anchor"), quality_score=0.95)},
            [(0.50, 1.00)],
            {0, 1},
        ),
        (
            "固定前\n中間一\n中間二\n固定後",
            {
                0: replace(candidate(0, 0.20, 0.40, "left"), quality_score=0.95),
                3: replace(candidate(3, 0.60, 0.80, "right"), quality_score=0.94),
            },
            [(0.90, 1.00)],
            {1, 2},
        ),
        (
            "固定\n末尾一\n末尾二",
            {0: replace(candidate(0, 0.20, 0.40, "anchor"), quality_score=0.95)},
            [(0.65, 1.00)],
            {1, 2},
        ),
    ],
)
def test_stage_four_compresses_leading_intermediate_and_trailing_runs(
    lyrics_text: str,
    frozen: dict[int, Candidate],
    forbidden: list[tuple[float, float]],
    compressed_indexes: set[int],
) -> None:
    lyrics = parse_lyrics_text(lyrics_text)
    expected_anchor_times = {
        index: (anchor.start, anchor.end) for index, anchor in frozen.items()
    }

    outcome = build_fallback_alignment(
        lyrics,
        frozen,
        duration=1.0,
        forbidden=forbidden,
        activity_components=[],
        config=config(),
        weak_hints={},
        reason="public_anchor_run_capacity",
    )

    assert outcome.stage == 4
    for index, expected in expected_anchor_times.items():
        assert (outcome.lines[index].start, outcome.lines[index].end) == expected
        assert outcome.lines[index].provenance[-1] == (
            "fallback_stage_4_anchor_frozen"
        )
    for index in compressed_indexes:
        assert outcome.lines[index].start < outcome.lines[index].end
        assert outcome.lines[index].confidence <= 0.02
        assert outcome.lines[index].diagnostics["below_min_duration"] is True
    assert outcome.diagnostics["actual_frozen_count"] == len(frozen)
    assert outcome.diagnostics["forbidden_respected"] is True



def test_stage_four_demotes_lower_quality_anchor_only_when_run_has_zero_capacity() -> None:
    lyrics = parse_lyrics_text("高品質固定\n間の行\n低品質固定")
    frozen = {
        0: replace(
            candidate(0, 0.20, 0.40, "high"),
            quality_score=0.95,
            support_count=3,
        ),
        2: replace(
            candidate(2, 0.40, 0.60, "low"),
            quality_score=0.70,
            support_count=2,
        ),
    }

    outcome = build_fallback_alignment(
        lyrics,
        frozen,
        duration=1.0,
        forbidden=[(0.80, 1.00)],
        activity_components=[],
        config=config(),
        weak_hints={},
        reason="public_anchor_conflict_retry",
    )

    assert outcome.stage == 4
    assert (outcome.lines[0].start, outcome.lines[0].end) == (0.20, 0.40)
    assert outcome.lines[0].provenance[-1] == "fallback_stage_4_anchor_frozen"
    assert "fallback_strong_demoted" in outcome.lines[2].provenance
    assert outcome.diagnostics["classified_frozen_count"] == 2
    assert outcome.diagnostics["actual_frozen_count"] == 1
    assert outcome.diagnostics["actual_demoted_count"] == 1
    assert outcome.diagnostics["strong_frozen_count"] == 1
    assert outcome.diagnostics["anchor_preservation_failure_reasons"] == [
        "demoted_lower_quality_anchor_for_positive_run_capacity"
    ]


def test_unresolved_repetition_demotes_every_occurrence_without_text_diagnostics() -> None:
    lyrics = parse_lyrics_text("前\n反復\n反復\n反復\n後")
    candidates = {
        0: [candidate(0, 0.0, 1.0, "before")],
        4: [candidate(4, 9.0, 10.0, "after")],
    }
    for line_index in (1, 2, 3):
        candidates[line_index] = [
            candidate(line_index, start, start + 1.0, f"slot-{start}")
            for start in (2.0, 4.0, 6.0, 8.0)
        ]

    ambiguous, group_diagnostics = _expand_unresolved_repetition_groups(
        {
            "affected_lyric_line_indexes": [2],
            "repetition_resolution": [
                {
                    "normalized_lyric": "must-not-leak",
                    "resolved": False,
                    "reason": "slot_count_or_order_is_not_unique",
                    "lyric_line_indexes": [1, 2, 3],
                },
                {
                    "normalized_lyric": "resolved-must-stay",
                    "resolved": True,
                    "lyric_line_indexes": [0, 4],
                },
            ],
        },
        {2},
    )
    demotion_reasons = {
        line_index: "unresolved_repetition_group"
        for line_index in ambiguous
    }
    strong, weak, separation = _separate_fallback_candidates(
        lyrics,
        candidates,
        config(),
        ambiguous_line_indexes=ambiguous,
        ambiguous_line_reasons=demotion_reasons,
    )

    assert ambiguous == {1, 2, 3}
    assert set(strong) == {0, 4}
    assert set(weak) == {1, 2, 3}
    assert {
        weak[index].quality_reason for index in (1, 2, 3)
    } == {"unresolved_repetition_group"}
    assert separation["strong_ambiguity_demotion_reasons"] == [
        {
            "lyric_line_index": 1,
            "reason": "unresolved_repetition_group",
        },
        {
            "lyric_line_index": 2,
            "reason": "unresolved_repetition_group",
        },
        {
            "lyric_line_index": 3,
            "reason": "unresolved_repetition_group",
        },
    ]
    assert group_diagnostics == [
        {
            "group_id": "repetition_resolution_0",
            "lyric_line_indexes": [1, 2, 3],
            "reason": "unresolved_repetition_group_requires_group_demotion",
        }
    ]
    assert "must-not-leak" not in str(group_diagnostics)
    assert "resolved-must-stay" not in str(group_diagnostics)


@pytest.mark.parametrize(
    ("lyrics_text", "frozen", "expected_centers"),
    [
        (
            "先頭一\n先頭二\n先頭三\n固定",
            {3: candidate(3, 36.0, 37.0, "right")},
            [9.0, 18.0, 27.0],
        ),
        (
            "固定前\n中間一\n中間二\n中間三\n固定後",
            {
                0: candidate(0, 2.0, 3.0, "left"),
                4: candidate(4, 20.0, 21.0, "right"),
            },
            [7.25, 11.5, 15.75],
        ),
        (
            "固定\n末尾一\n末尾二\n末尾三",
            {0: candidate(0, 3.0, 4.0, "left")},
            [13.0, 22.0, 31.0],
        ),
    ],
)
def test_stage_four_excess_capacity_preserves_desired_durations_and_centers(
    lyrics_text: str,
    frozen: dict[int, Candidate],
    expected_centers: list[float],
) -> None:
    lyrics = parse_lyrics_text(lyrics_text)

    outcome = _stage_four(
        lyrics,
        frozen,
        {},
        duration=40.0,
        forbidden=[],
        activity_components=[],
        config=config(),
        reason="public_stage_four_excess",
    )

    missing = [line for line in outcome.lines if line.index not in frozen]
    assert outcome.stage == 4
    assert [line.end - line.start for line in missing] == pytest.approx(
        [1.0] * len(missing)
    )
    assert [
        (line.start + line.end) / 2 for line in missing
    ] == pytest.approx(expected_centers)
    assert outcome.diagnostics["compressed_line_count"] == 0
    for line_index, anchor in frozen.items():
        assert (outcome.lines[line_index].start, outcome.lines[line_index].end) == (
            anchor.start,
            anchor.end,
        )


def test_stage_four_weak_hint_adjusts_center_without_expanding_duration() -> None:
    lyrics = parse_lyrics_text("先頭一\n先頭二\n先頭三\n固定")
    frozen = {3: candidate(3, 36.0, 37.0, "right")}
    weak = {
        1: replace(
            candidate(1, 29.5, 30.5, "weak"),
            freeze_eligible=False,
            quality_score=1.0,
            quality_reason="public_weak_hint",
        )
    }

    without_hint = _stage_four(
        lyrics,
        frozen,
        {},
        duration=40.0,
        forbidden=[],
        activity_components=[],
        config=config(),
        reason="public_stage_four_no_hint",
    )
    with_hint = _stage_four(
        lyrics,
        frozen,
        weak,
        duration=40.0,
        forbidden=[],
        activity_components=[],
        config=config(),
        reason="public_stage_four_hint",
    )

    plain_center = (
        without_hint.lines[1].start + without_hint.lines[1].end
    ) / 2
    hinted_center = (with_hint.lines[1].start + with_hint.lines[1].end) / 2
    assert hinted_center > plain_center
    assert with_hint.lines[1].end - with_hint.lines[1].start == pytest.approx(1.0)
    assert "fallback_weak_hint_used" in with_hint.lines[1].provenance
    assert with_hint.lines[1].diagnostics["weak_hint_center"] == pytest.approx(30.0)


def high_quality_hint(
    line_index: int,
    start: float,
    end: float,
    request_id: str,
    *,
    quality_score: float = 1.0,
) -> Candidate:
    return replace(
        candidate(
            line_index,
            start,
            end,
            request_id,
            similarity=0.99,
            confidence=0.90,
            boundary_support="segment",
        ),
        freeze_eligible=False,
        support_count=3,
        time_dispersion=0.0,
        quality_score=quality_score,
        quality_reason="public_high_quality_weak_hint",
    )


@pytest.mark.parametrize(
    ("lyrics_text", "frozen", "weak", "expected_centers"),
    [
        (
            "先頭一\n先頭二\n先頭三\n固定",
            {3: candidate(3, 80.0, 81.0, "right")},
            {
                1: high_quality_hint(1, 20.0, 21.0, "hint-a"),
                2: high_quality_hint(2, 40.0, 41.0, "hint-b"),
            },
            {0: 0.5, 1: 20.5, 2: 40.5},
        ),
        (
            "固定前\n中間一\n中間二\n中間三\n中間四\n固定後",
            {
                0: candidate(0, 0.0, 1.0, "left"),
                5: candidate(5, 100.0, 101.0, "right"),
            },
            {
                2: high_quality_hint(2, 40.0, 41.0, "hint-a"),
                3: high_quality_hint(3, 60.0, 61.0, "hint-b"),
            },
            {1: 20.5, 2: 40.5, 3: 60.5, 4: 80.5},
        ),
        (
            "固定\n末尾一\n末尾二\n末尾三",
            {0: candidate(0, 0.0, 1.0, "left")},
            {
                1: high_quality_hint(1, 20.0, 21.0, "hint-a"),
                2: high_quality_hint(2, 40.0, 41.0, "hint-b"),
            },
            {1: 20.5, 2: 40.5, 3: 60.5},
        ),
    ],
)
def test_stage_four_uses_two_hints_for_interpolation_and_extrapolation(
    lyrics_text: str,
    frozen: dict[int, Candidate],
    weak: dict[int, Candidate],
    expected_centers: dict[int, float],
) -> None:
    lyrics = parse_lyrics_text(lyrics_text)

    outcome = _stage_four(
        lyrics,
        frozen,
        weak,
        duration=120.0,
        forbidden=[],
        activity_components=[],
        config=config(),
        reason="public_direct_weak_geometry",
    )

    assert outcome.stage == 4
    for line_index, expected_center in expected_centers.items():
        line = outcome.lines[line_index]
        assert (line.start + line.end) / 2 == pytest.approx(expected_center)
        assert line.end - line.start == pytest.approx(1.0)
    for line_index, anchor in frozen.items():
        line = outcome.lines[line_index]
        assert (line.start, line.end) == (anchor.start, anchor.end)
        assert line.provenance[-1] == "fallback_stage_4_anchor_frozen"


def test_single_high_quality_hint_is_direct_but_does_not_extrapolate() -> None:
    lyrics = parse_lyrics_text("先頭一\n先頭二\n先頭三\n固定")
    frozen = {3: candidate(3, 80.0, 81.0, "right")}
    weak = {1: high_quality_hint(1, 20.0, 21.0, "only")}

    centers, durations, used = _desired_centers(
        lyrics,
        frozen,
        weak,
        [(0.0, 120.0)],
        120.0,
        config(),
    )

    assert centers == pytest.approx([20.0, 20.5, 60.0, 80.5])
    assert durations == pytest.approx([1.0, 1.0, 1.0, 1.0])
    assert used == {1: 20.5}


def test_conflicting_high_quality_hint_is_demoted_from_direct_geometry() -> None:
    lyrics = parse_lyrics_text("先頭一\n先頭二\n先頭三\n固定")
    frozen = {3: candidate(3, 80.0, 81.0, "right")}
    weak = {
        0: high_quality_hint(0, 30.0, 31.0, "lower-quality", quality_score=0.80),
        1: high_quality_hint(1, 20.0, 21.0, "preferred-a"),
        2: high_quality_hint(2, 40.0, 41.0, "preferred-b"),
    }

    centers, _, used = _desired_centers(
        lyrics,
        frozen,
        weak,
        [(0.0, 120.0)],
        120.0,
        config(),
    )

    assert centers[:3] == pytest.approx([0.5, 20.5, 40.5])
    assert used == {1: 20.5, 2: 40.5}
    assert 0 not in used


def test_direct_hint_geometry_respects_barrier_components_and_anchor_time() -> None:
    lyrics = parse_lyrics_text("先頭一\n先頭二\n先頭三\n先頭四\n固定")
    frozen = {4: candidate(4, 90.0, 91.0, "right")}
    weak = {
        1: high_quality_hint(1, 20.0, 21.0, "left-component"),
        2: high_quality_hint(2, 60.0, 61.0, "right-component"),
    }
    forbidden = [(30.0, 50.0)]

    outcome = _stage_four(
        lyrics,
        frozen,
        weak,
        duration=100.0,
        forbidden=forbidden,
        activity_components=[],
        config=config(),
        reason="public_hint_barrier",
    )

    assert (outcome.lines[4].start, outcome.lines[4].end) == (90.0, 91.0)
    assert (outcome.lines[1].start + outcome.lines[1].end) / 2 == pytest.approx(
        20.5
    )
    assert (outcome.lines[2].start + outcome.lines[2].end) / 2 == pytest.approx(
        60.5
    )
    assert all(
        line.end <= 30.0 or line.start >= 50.0
        for line in outcome.lines
    )
    assert all(
        left.end <= right.start
        for left, right in zip(outcome.lines, outcome.lines[1:], strict=False)
    )


def test_direct_hint_run_compresses_only_when_capacity_is_insufficient() -> None:
    lyrics = parse_lyrics_text("圧縮一\n圧縮二\n圧縮三\n固定")
    frozen = {3: candidate(3, 0.80, 0.97, "right")}
    weak = {
        1: high_quality_hint(1, 0.30, 0.35, "hint-a"),
        2: high_quality_hint(2, 0.55, 0.60, "hint-b"),
    }

    outcome = _stage_four(
        lyrics,
        frozen,
        weak,
        duration=1.0,
        forbidden=[],
        activity_components=[],
        config=config(),
        reason="public_hint_shortage",
    )

    run = outcome.lines[:3]
    assert all(0.0 <= line.start < line.end <= 0.80 for line in run)
    assert all(line.end - line.start < 0.35 for line in run)
    assert all(line.diagnostics["duration_compressed"] is True for line in run)
    assert all(
        left.end <= right.start
        for left, right in zip(run, run[1:], strict=False)
    )
    assert (outcome.lines[3].start, outcome.lines[3].end) == (0.80, 0.97)


def test_high_quality_hint_outside_anchor_bounds_is_not_used() -> None:
    lyrics = parse_lyrics_text("固定前\n中間一\n中間二\n固定後")
    frozen = {
        0: candidate(0, 10.0, 11.0, "left"),
        3: candidate(3, 30.0, 31.0, "right"),
    }
    weak = {
        1: high_quality_hint(1, 5.0, 6.0, "outside"),
        2: high_quality_hint(2, 20.0, 21.0, "inside"),
    }

    _, _, used = _desired_centers(
        lyrics,
        frozen,
        weak,
        [(0.0, 40.0)],
        40.0,
        config(),
    )

    assert used == {2: 20.5}


def test_proxy_anchor_beyond_configured_duration_is_not_frozen() -> None:
    lyrics = parse_lyrics_text("長すぎる推定\n有効固定")
    proxy = candidate(0, 10.0, 14.848, "proxy")
    valid = candidate(1, 20.0, 21.0, "valid")

    outcome = _stage_four(
        lyrics,
        {0: proxy, 1: valid},
        {},
        duration=30.0,
        forbidden=[],
        activity_components=[],
        config=config(max_line_seconds=4.0),
        reason="public_proxy_boundary_check",
    )

    assert (outcome.lines[1].start, outcome.lines[1].end) == (20.0, 21.0)
    assert (outcome.lines[0].start, outcome.lines[0].end) != (
        proxy.start,
        proxy.end,
    )
    assert "fallback_strong_demoted" in outcome.lines[0].provenance
    assert any(
        item["lyric_line_index"] == 0
        and item["reason"] == "duration_outside_configured_bounds"
        for item in outcome.diagnostics["demoted_anchors"]
    )


@pytest.mark.parametrize(
    "demotion_reason",
    [
        "strong_local_ambiguity",
        "unresolved_repetition_group",
        "competing_temporal_clusters",
        "monotonic_order_conflict",
        "forbidden_interval_collision",
        "not_contained_in_one_safe_component",
        "stage_four_zero_capacity_adjacent_to_frozen_anchor",
    ],
)
def test_semantically_demoted_hints_do_not_enter_weak_geometry(
    demotion_reason: str,
) -> None:
    lyrics = parse_lyrics_text("先頭一\n先頭二\n先頭三\n固定")
    frozen = {3: candidate(3, 80.0, 81.0, "right")}
    weak = {
        1: replace(
            high_quality_hint(1, 60.0, 61.0, "ambiguous-a"),
            quality_reason=demotion_reason,
        ),
        2: replace(
            high_quality_hint(2, 70.0, 71.0, "ambiguous-b"),
            quality_reason=demotion_reason,
        ),
    }

    outcome = _stage_four(
        lyrics,
        frozen,
        weak,
        duration=100.0,
        forbidden=[],
        activity_components=[],
        config=config(),
        reason="public_semantic_conflict_gate",
    )

    assert [
        (line.start + line.end) / 2 for line in outcome.lines
    ] == pytest.approx([20.0, 40.0, 60.0, 80.5])
    assert all(
        "fallback_weak_hint_used" not in line.provenance
        for line in outcome.lines
    )
    assert all(
        line.diagnostics.get("weak_hint_center") is None
        for line in outcome.lines[:3]
    )
    assert (outcome.lines[3].start, outcome.lines[3].end) == (80.0, 81.0)


def test_safe_hints_drive_geometry_while_ambiguous_hint_is_ignored() -> None:
    lyrics = parse_lyrics_text("先頭一\n曖昧\n安全一\n安全二\n固定")
    frozen = {4: candidate(4, 100.0, 101.0, "right")}
    weak = {
        1: replace(
            high_quality_hint(1, 35.0, 36.0, "ambiguous"),
            quality_reason="strong_local_ambiguity",
        ),
        2: high_quality_hint(2, 50.0, 51.0, "safe-a"),
        3: high_quality_hint(3, 70.0, 71.0, "safe-b"),
    }

    outcome = _stage_four(
        lyrics,
        frozen,
        weak,
        duration=120.0,
        forbidden=[],
        activity_components=[],
        config=config(),
        reason="public_mixed_hint_gate",
    )

    assert [
        (line.start + line.end) / 2 for line in outcome.lines
    ] == pytest.approx([10.5, 30.5, 50.5, 70.5, 100.5])
    assert "fallback_weak_hint_used" not in outcome.lines[1].provenance
    assert outcome.lines[1].diagnostics["weak_hint_center"] is None
    assert "fallback_weak_hint_used" in outcome.lines[2].provenance
    assert "fallback_weak_hint_used" in outcome.lines[3].provenance
    assert (outcome.lines[4].start, outcome.lines[4].end) == (100.0, 101.0)


def test_nonambiguous_single_pass_hint_remains_a_bounded_weak_signal() -> None:
    lyrics = parse_lyrics_text("先頭一\n単発hint\n先頭三\n固定")
    frozen = {3: candidate(3, 80.0, 81.0, "right")}
    weak = {
        1: replace(
            high_quality_hint(1, 20.0, 21.0, "single"),
            support_count=1,
            quality_reason="single_pass_generic_boundary_on_mixture",
        )
    }

    without_hint = _stage_four(
        lyrics,
        frozen,
        {},
        duration=100.0,
        forbidden=[],
        activity_components=[],
        config=config(),
        reason="public_no_single_hint",
    )
    with_hint = _stage_four(
        lyrics,
        frozen,
        weak,
        duration=100.0,
        forbidden=[],
        activity_components=[],
        config=config(),
        reason="public_safe_single_hint",
    )

    plain_center = (
        without_hint.lines[1].start + without_hint.lines[1].end
    ) / 2
    hinted_center = (with_hint.lines[1].start + with_hint.lines[1].end) / 2
    assert hinted_center < plain_center
    assert "fallback_weak_hint_used" in with_hint.lines[1].provenance
    assert with_hint.lines[1].diagnostics["weak_hint_center"] == pytest.approx(
        20.5
    )
    assert (with_hint.lines[3].start, with_hint.lines[3].end) == (80.0, 81.0)


def test_no_trusted_hint_spread_maps_quantiles_across_safe_components() -> None:
    lyrics = parse_lyrics_text("先頭一\n先頭二\n先頭三\n先頭四\n固定")
    frozen = {4: candidate(4, 90.0, 91.0, "right")}
    forbidden = [(30.0, 50.0)]

    outcome = _stage_four(
        lyrics,
        frozen,
        {},
        duration=100.0,
        forbidden=forbidden,
        activity_components=[],
        config=config(),
        reason="public_no_hint_component_spread",
    )

    assert [
        (line.start + line.end) / 2 for line in outcome.lines
    ] == pytest.approx([58.0, 66.0, 74.0, 82.0, 90.5])
    assert all(
        line.end <= 30.0 or line.start >= 50.0
        for line in outcome.lines
    )
    assert all(
        left.end <= right.start
        for left, right in zip(outcome.lines, outcome.lines[1:], strict=False)
    )
    assert (outcome.lines[4].start, outcome.lines[4].end) == (90.0, 91.0)


def test_multi_observation_consensus_rejects_long_single_proxy_end() -> None:
    lyrics = parse_lyrics_text("境界確認")
    hypotheses = {
        0: [
            candidate(0, 10.00, 11.00, "segment-a"),
            candidate(0, 10.10, 11.10, "segment-b"),
            candidate(
                0,
                10.00,
                15.848,
                "word-proxy",
                boundary_support="word",
            ),
        ]
    }

    consensus, diagnostics = build_candidate_consensus(
        lyrics,
        hypotheses,
        config(),
        normal_mix=True,
    )

    frozen = [item for item in consensus[0] if item.freeze_eligible]
    assert len(frozen) == 1
    assert frozen[0].support_count == 2
    assert frozen[0].end <= 11.10
    proxy = max(consensus[0], key=lambda item: item.end)
    assert proxy.end == pytest.approx(15.848)
    assert proxy.freeze_eligible is False
    assert proxy.quality_reason in {
        "single_pass_generic_boundary_on_mixture",
        "word_or_unknown_boundary_on_mixture",
    }
    assert "境界確認" not in str(diagnostics)


def test_stage_four_prefers_single_trusted_activity_component() -> None:
    lyrics = parse_lyrics_text("一\n二\n三\n固定")
    frozen = {3: candidate(3, 80.0, 81.0, "right")}

    outcome = _stage_four(
        lyrics,
        frozen,
        {},
        duration=100.0,
        forbidden=[],
        activity_components=[(45.0, 80.0)],
        config=config(),
        reason="public_trusted_activity",
    )

    assert [
        (line.start + line.end) / 2 for line in outcome.lines
    ] == pytest.approx([53.75, 62.5, 71.25, 80.5])
    assert all(45.0 <= line.start < line.end <= 80.0 for line in outcome.lines[:3])
    assert (outcome.lines[3].start, outcome.lines[3].end) == (80.0, 81.0)
    assert outcome.diagnostics["trusted_activity_preferred"] is True


def test_stage_four_spreads_across_multiple_trusted_activity_components() -> None:
    lyrics = parse_lyrics_text("一\n二\n三\n四\n固定")
    frozen = {4: candidate(4, 90.0, 91.0, "right")}

    outcome = _stage_four(
        lyrics,
        frozen,
        {},
        duration=100.0,
        forbidden=[],
        activity_components=[(10.0, 30.0), (50.0, 90.0)],
        config=config(),
        reason="public_multiple_activity",
    )

    assert [
        (line.start + line.end) / 2 for line in outcome.lines
    ] == pytest.approx([22.0, 54.0, 66.0, 78.0, 90.5])
    assert all(
        any(left <= line.start < line.end <= right for left, right in [(10, 30), (50, 90)])
        for line in outcome.lines[:4]
    )


def test_insufficient_activity_uses_safe_outside_capacity_without_compression() -> None:
    lyrics = parse_lyrics_text("一\n二\n三\n固定")
    frozen = {3: candidate(3, 80.0, 81.0, "right")}

    outcome = _stage_four(
        lyrics,
        frozen,
        {},
        duration=100.0,
        forbidden=[],
        activity_components=[(60.0, 60.2)],
        config=config(),
        reason="public_activity_fallback",
    )

    run = outcome.lines[:3]
    assert all(line.end - line.start == pytest.approx(1.0) for line in run)
    assert all(
        left.end <= right.start
        for left, right in zip(run, run[1:], strict=False)
    )
    assert any(line.start < 60.0 or line.end > 60.2 for line in run)
    assert outcome.diagnostics["compressed_line_count"] == 0
    assert (outcome.lines[3].start, outcome.lines[3].end) == (80.0, 81.0)


def test_global_stage_four_uses_activity_when_it_has_minimum_capacity() -> None:
    lyrics = parse_lyrics_text("一\n二\n三")

    outcome = _stage_four(
        lyrics,
        {},
        {},
        duration=100.0,
        forbidden=[],
        activity_components=[(20.0, 40.0)],
        config=config(),
        reason="public_global_activity",
    )

    assert outcome.stage == 4
    assert all(20.0 <= line.start < line.end <= 40.0 for line in outcome.lines)
    assert all(
        left.end <= right.start
        for left, right in zip(outcome.lines, outcome.lines[1:], strict=False)
    )


def test_confirmed_silence_capacity_guard_softens_impossible_barrier() -> None:
    hard, softened, diagnostics = _guard_confirmed_acoustic_silences(
        10.0,
        [(0.01, 9.99)],
        missing_line_count=3,
        config=config(),
    )

    assert hard == []
    assert softened == [(0.01, 9.99)]
    assert diagnostics == [
        {
            "start": 0.01,
            "end": 9.99,
            "provenance": "confirmed_acoustic_silence",
            "hard": False,
            "reason": "missing_line_capacity_shortfall",
        }
    ]


def test_recognition_only_gap_is_soft_without_trusted_activity(
    wav_factory,
) -> None:
    audio = wav_factory(duration=80.0)
    lyrics = parse_lyrics_text("前\n中\n後")
    backend = FakeBackend(
        [
            Observation(
                0.50,
                1.01,
                "前",
                0.96,
                0.01,
                "public-gap-left",
                boundary_support="segment",
            ),
            Observation(
                79.0,
                79.50,
                "後",
                0.96,
                0.01,
                "public-gap-right",
                boundary_support="segment",
            ),
        ]
    )

    result = align_lyrics(
        audio,
        lyrics,
        backend,
        config=config(
            long_gap_seconds=8.0,
            hard_gap_seconds=2.0,
        ),
    )

    middle = result.lines[1]
    assert middle.end - middle.start >= config().min_line_seconds
    assert result.diagnostics["trusted_vocal_activity_components"] == []
    assert result.diagnostics["confirmed_trusted_vocal_silences"] == []
    assert result.diagnostics["recognition_only_soft_gaps"]
    recognition_entries = [
        item
        for item in result.diagnostics["forbidden_interval_provenance"]
        if item["provenance"] == "recognition_only_gap"
    ]
    assert recognition_entries
    assert all(item["hard"] is False for item in recognition_entries)
    assert result.diagnostics["hard_forbidden_intervals"] == []
    fallback = result.diagnostics["fallback"]
    assert fallback["stage"] == 3
    assert fallback["mixture_stt_only"] is True
    assert fallback["trusted_activity_absent"] is True
    assert "recognition_soft_gap_relayout" not in fallback["reason_codes"]
    assert len(result.lines) == len(lyrics)


@pytest.mark.parametrize(
    ("lyrics_text", "frozen", "soft_intervals", "run_indexes"),
    [
        (
            "先頭一\n先頭二\n固定",
            {2: candidate(2, 8.0, 9.0, "leading-anchor")},
            [(0.0, 6.0)],
            {0, 1},
        ),
        (
            "固定前\n中間一\n中間二\n固定後",
            {
                0: candidate(0, 1.0, 2.0, "middle-left"),
                3: candidate(3, 8.0, 9.0, "middle-right"),
            },
            [(3.0, 7.0)],
            {1, 2},
        ),
        (
            "固定\n末尾一\n末尾二",
            {0: candidate(0, 1.0, 2.0, "trailing-anchor")},
            [(4.0, 10.0)],
            {1, 2},
        ),
    ],
)
def test_stage_four_avoids_leading_intermediate_and_trailing_soft_gaps(
    lyrics_text: str,
    frozen: dict[int, Candidate],
    soft_intervals: list[tuple[float, float]],
    run_indexes: set[int],
) -> None:
    lyrics = parse_lyrics_text(lyrics_text)

    outcome = _stage_four(
        lyrics,
        frozen,
        {},
        duration=10.0,
        forbidden=[],
        activity_components=[],
        config=config(conservative_soft_gap_avoidance=True),
        reason="public_soft_gap_geometry",
        soft_intervals=soft_intervals,
    )

    for line in outcome.lines:
        if line.index not in run_indexes:
            anchor = frozen[line.index]
            assert (line.start, line.end) == (anchor.start, anchor.end)
            continue
        assert line.end - line.start == pytest.approx(1.0)
        assert all(
            line.end <= soft_start or line.start >= soft_end
            for soft_start, soft_end in soft_intervals
        )
        assert line.diagnostics["soft_gap_overlap_seconds"] == 0.0
    assert outcome.diagnostics["unavoidable_soft_overlap"] is False
    assert outcome.diagnostics["compressed_for_soft_avoidance_count"] == 0


def test_stage_four_compresses_to_stay_outside_long_soft_gap() -> None:
    lyrics = parse_lyrics_text("一\n二\n三\n固定")
    frozen = {3: candidate(3, 80.0, 81.0, "right")}

    outcome = _stage_four(
        lyrics,
        frozen,
        {},
        duration=100.0,
        forbidden=[],
        activity_components=[],
        config=config(conservative_soft_gap_avoidance=True),
        reason="public_soft_capacity",
        soft_intervals=[(1.01, 79.99)],
    )

    for line in outcome.lines[:3]:
        assert line.end - line.start >= config().min_line_seconds
        assert line.end <= 1.01 or line.start >= 79.99
        assert line.diagnostics["compressed_for_soft_avoidance"] is True
        assert line.diagnostics["soft_gap_overlap_seconds"] == 0.0
    assert (outcome.lines[3].start, outcome.lines[3].end) == (80.0, 81.0)
    assert outcome.diagnostics["compressed_for_soft_avoidance_count"] == 3
    assert outcome.diagnostics["unavoidable_soft_overlap"] is False


def test_stage_four_uses_only_unavoidable_minimum_soft_overlap() -> None:
    lyrics = parse_lyrics_text("仮置き\n固定")
    frozen = {1: candidate(1, 9.0, 10.0, "right")}

    outcome = _stage_four(
        lyrics,
        frozen,
        {},
        duration=10.0,
        forbidden=[],
        activity_components=[],
        config=config(conservative_soft_gap_avoidance=True),
        reason="public_unavoidable_soft_overlap",
        soft_intervals=[(0.05, 8.95)],
    )

    provisional = outcome.lines[0]
    assert provisional.end - provisional.start == pytest.approx(
        config().min_line_seconds
    )
    assert provisional.diagnostics["unavoidable_soft_overlap"] is True
    assert provisional.diagnostics["soft_gap_overlap_seconds"] == pytest.approx(
        0.11,
        abs=1e-6,
    )
    assert (outcome.lines[1].start, outcome.lines[1].end) == (9.0, 10.0)
    assert outcome.diagnostics["unavoidable_soft_overlap"] is True
    assert outcome.diagnostics["unavoidable_soft_overlap_seconds"] == pytest.approx(
        0.11,
        abs=1e-6,
    )


def test_stage_four_respects_hard_barrier_with_multiple_soft_gaps() -> None:
    lyrics = parse_lyrics_text("一\n二\n三")

    outcome = _stage_four(
        lyrics,
        {},
        {},
        duration=8.0,
        forbidden=[(3.0, 5.0)],
        activity_components=[],
        config=config(conservative_soft_gap_avoidance=True),
        reason="public_multiple_soft_and_hard",
        soft_intervals=[(1.0, 3.0), (5.0, 7.0)],
    )

    for line in outcome.lines:
        assert line.end <= 3.0 or line.start >= 5.0
        assert line.end <= 1.0 or line.start >= 7.0
        assert line.diagnostics["soft_gap_overlap_seconds"] == 0.0
    assert outcome.diagnostics["forbidden_respected"] is True
    assert outcome.diagnostics["unavoidable_soft_overlap"] is False


def test_stage_four_preserves_frozen_anchors_around_hard_and_soft_barriers() -> None:
    lyrics = parse_lyrics_text("固定前\n仮置き\n固定後")
    frozen = {
        0: candidate(0, 1.0, 2.0, "left"),
        2: candidate(2, 8.0, 9.0, "right"),
    }

    outcome = _stage_four(
        lyrics,
        frozen,
        {},
        duration=10.0,
        forbidden=[(4.0, 6.0)],
        activity_components=[],
        config=config(conservative_soft_gap_avoidance=True),
        reason="public_frozen_barriers",
        soft_intervals=[(2.0, 4.0), (6.0, 7.0)],
    )

    assert (outcome.lines[0].start, outcome.lines[0].end) == (1.0, 2.0)
    assert (outcome.lines[2].start, outcome.lines[2].end) == (8.0, 9.0)
    middle = outcome.lines[1]
    assert 7.0 <= middle.start < middle.end <= 8.0
    assert middle.diagnostics["soft_gap_overlap_seconds"] == 0.0


def test_trusted_activity_overrides_recognition_soft_gap_penalty() -> None:
    lyrics = parse_lyrics_text("一\n二\n三\n固定")
    frozen = {3: candidate(3, 80.0, 81.0, "right")}

    outcome = _stage_four(
        lyrics,
        frozen,
        {},
        duration=100.0,
        forbidden=[],
        activity_components=[(45.0, 79.5)],
        config=config(conservative_soft_gap_avoidance=True),
        reason="public_activity_over_soft",
        soft_intervals=[(1.01, 79.99)],
    )

    for line in outcome.lines[:3]:
        assert 45.0 <= line.start < line.end <= 79.5
        assert line.end - line.start == pytest.approx(1.0)
        assert line.diagnostics["soft_gap_overlap_seconds"] == 0.0
        assert line.diagnostics["compressed_for_soft_avoidance"] is False
    assert outcome.diagnostics["trusted_activity_preferred"] is True
    assert outcome.diagnostics["unavoidable_soft_overlap"] is False


def test_low_support_hint_inside_soft_gap_is_locally_downweighted() -> None:
    lyrics = parse_lyrics_text("固定前\n隣一\n弱い\n隣二\n固定後")
    anchors = {
        0: candidate(0, 0.0, 1.0, "left"),
        4: candidate(4, 9.0, 10.0, "right"),
    }
    hint = replace(
        candidate(2, 7.0, 8.0, "weak"),
        consensus=True,
        support_count=1,
        quality_score=0.80,
        freeze_eligible=False,
        quality_reason="single_pass_generic_boundary_on_mixture",
    )
    base, _, _ = _desired_centers(
        lyrics,
        anchors,
        {},
        [(0.0, 10.0)],
        10.0,
        config(),
        [],
        [],
    )
    ordinary, _, _ = _desired_centers(
        lyrics,
        anchors,
        {2: hint},
        [(0.0, 10.0)],
        10.0,
        config(),
        [],
        [],
    )
    softened, _, used = _desired_centers(
        lyrics,
        anchors,
        {2: hint},
        [(0.0, 10.0)],
        10.0,
        config(),
        [],
        [(7.0, 8.0)],
    )

    assert abs(softened[2] - base[2]) < abs(ordinary[2] - base[2])
    assert softened[:2] == base[:2]
    assert softened[3:] == base[3:]
    assert used == {2: 7.5}


def test_global_stage_four_avoids_soft_gaps_without_any_anchor() -> None:
    lyrics = parse_lyrics_text("一\n二\n三\n四")

    outcome = _stage_four(
        lyrics,
        {},
        {},
        duration=10.0,
        forbidden=[],
        activity_components=[],
        config=config(conservative_soft_gap_avoidance=True),
        reason="public_all_fallback_soft",
        soft_intervals=[(2.0, 8.0)],
    )

    assert outcome.stage == 4
    assert all(
        line.end <= 2.0 or line.start >= 8.0
        for line in outcome.lines
    )
    assert all(
        line.diagnostics["soft_gap_overlap_seconds"] == 0.0
        for line in outcome.lines
    )
    assert outcome.diagnostics["soft_free_capacity_seconds"] == pytest.approx(4.0)
    assert outcome.diagnostics["unavoidable_soft_overlap"] is False

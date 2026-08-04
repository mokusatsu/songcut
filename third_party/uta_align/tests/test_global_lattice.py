from __future__ import annotations

from dataclasses import replace

import pytest

from uta_align.alignment import build_candidate_consensus
from uta_align.backends import FakeBackend
from uta_align.config import AlignConfig
from uta_align.fallback import build_fallback_alignment
from uta_align.lattice import select_global_lattice
from uta_align.lyrics import parse_lyrics_text
from uta_align.models import Candidate, PromptStrategy
from uta_align.pipeline import (
    _apply_lattice_freeze_consistency,
    _apply_progress_freeze_gate,
    align_lyrics,
)


def config(**changes: object) -> AlignConfig:
    base = AlignConfig(
        boundary_search_seconds=0,
        min_similarity=0.42,
        anchor_similarity=0.57,
        hard_gap_seconds=2,
        segment_freeze_min_similarity=0.78,
        segment_freeze_min_independence_groups=2,
        segment_freeze_min_strategy_groups=2,
        segment_word_agreement_seconds=0.85,
        require_segment_word_corroboration=True,
    )
    return replace(base, **changes)


def candidate(
    line_index: int,
    start: float,
    end: float,
    *,
    group: str,
    strategy: PromptStrategy = "unprompted",
    source_family: str | None = None,
    boundary: str = "segment",
    similarity: float = 0.90,
    quality: float = 0.86,
    confidence: float = 0.92,
    score: float = 5.0,
    boundary_types: tuple[str, ...] | None = None,
    freeze_eligible: bool = False,
) -> Candidate:
    observation_index = int(start * 1000) + line_index
    return Candidate(
        line_index=line_index,
        obs_start_index=observation_index,
        obs_end_index=observation_index,
        start=start,
        end=end,
        similarity=similarity,
        confidence=confidence,
        score=score,
        provenance=("round12",),
        boundary_support=boundary,  # type: ignore[arg-type]
        request_ids=(f"request:{group}",),
        support_observation_indexes=(observation_index,),
        no_speech_prob=0.01,
        support_count=1,
        quality_score=quality,
        freeze_eligible=freeze_eligible,
        quality_reason="round12_fixture",
        independence_groups=(group,),
        prompt_strategies=(strategy,),
        source_families=(source_family or f"family:{group}",),
        boundary_support_types=(
            tuple(boundary_types)
            if boundary_types is not None
            else (boundary,)
        ),  # type: ignore[arg-type]
    )


def test_prompt_only_multigroup_candidate_cannot_freeze() -> None:
    lyrics = parse_lyrics_text("対象行")
    hypotheses = {
        0: [
            candidate(
                0,
                10.0,
                11.0,
                group="prompt-segment-a",
                strategy="global_initial_prompt",
                source_family="global_prompt",
            ),
            candidate(
                0,
                10.1,
                11.1,
                group="prompt-segment-b",
                strategy="local_initial_prompt",
                source_family="local_prompt",
            ),
            candidate(
                0,
                10.1,
                10.9,
                group="prompt-word",
                strategy="local_hotwords",
                source_family="hotword_prompt",
                boundary="word",
            ),
        ]
    }

    consensus, diagnostics = build_candidate_consensus(
        lyrics,
        hypotheses,
        config(),
        normal_mix=True,
    )

    assert consensus[0][0].freeze_eligible is False
    assert (
        consensus[0][0].quality_reason
        == "prompt_only_candidate_not_freeze_eligible"
    )
    public = diagnostics["lines"]["0"][0]
    assert public["has_unprompted_or_trusted_source"] is False
    assert "対象行" not in str(public)


def test_unprompted_independent_family_allows_segment_word_freeze() -> None:
    lyrics = parse_lyrics_text("対象行")
    hypotheses = {
        0: [
            candidate(
                0,
                10.0,
                11.0,
                group="unprompted-segment",
                strategy="unprompted",
                source_family="global_full",
            ),
            candidate(
                0,
                10.1,
                11.1,
                group="prompt-segment",
                strategy="local_initial_prompt",
                source_family="overlap_prompt",
            ),
            candidate(
                0,
                10.1,
                10.9,
                group="word",
                strategy="local_hotwords",
                source_family="word_family",
                boundary="word",
            ),
        ]
    }

    consensus, diagnostics = build_candidate_consensus(
        lyrics,
        hypotheses,
        config(),
        normal_mix=True,
    )

    assert consensus[0][0].freeze_eligible is True
    public = diagnostics["lines"]["0"][0]
    assert public["segment_word_agreement"] is True
    assert public["has_unprompted_or_trusted_source"] is True


def test_source_family_cap_prevents_prompt_group_inflation() -> None:
    lyrics = parse_lyrics_text("対象行")
    hypotheses = {
        0: [
            candidate(
                0,
                10.0,
                11.0,
                group=f"prompt-{index}",
                strategy="local_initial_prompt",
                source_family="same_prompt_family",
            )
            for index in range(3)
        ]
        + [
            candidate(
                0,
                10.1,
                10.9,
                group="word",
                strategy="unprompted",
                source_family="global_full",
                boundary="word",
            )
        ]
    }

    consensus, diagnostics = build_candidate_consensus(
        lyrics,
        hypotheses,
        config(),
        normal_mix=True,
    )

    assert consensus[0][0].support_count == 2
    assert diagnostics["lines"]["0"][0]["source_family_count"] == 2


def test_lattice_prefers_globally_consistent_lower_local_score() -> None:
    lyrics = parse_lyrics_text(
        "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\ndddddddddd"
    )
    hypotheses = {
        0: [
            candidate(
                0,
                2.0,
                3.0,
                group="word-0",
                boundary="word",
                score=5.0,
            )
        ],
        1: [
            candidate(
                1,
                6.0,
                7.0,
                group="word-1",
                boundary="word",
                score=5.0,
            )
        ],
        2: [
            candidate(
                2,
                10.0,
                11.0,
                group="consistent",
                score=3.5,
            ),
            candidate(
                2,
                24.0,
                25.0,
                group="wrong-prompt",
                strategy="local_initial_prompt",
                source_family="prompted_lyrics",
                score=10.0,
            ),
        ],
        3: [
            candidate(
                3,
                14.0,
                15.0,
                group="word-3",
                boundary="word",
                score=5.0,
            )
        ],
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        32.0,
        [],
        config(),
    )

    assert selected[2].start == pytest.approx(10.0)
    assert diagnostics["selected_count"] == 4
    assert diagnostics["prior_mode"] == "robust_multi_hypothesis"
    assert diagnostics["prior_inlier_count"] == 3


def test_lattice_path_conflict_demotes_unique_local_freeze() -> None:
    lyrics = parse_lyrics_text("一行目")
    wrong = candidate(
        0,
        20.0,
        21.0,
        group="wrong-freeze",
        strategy="local_initial_prompt",
        freeze_eligible=True,
    )
    consistent = candidate(
        0,
        8.0,
        9.0,
        group="consistent",
    )

    updated, demoted_count = _apply_lattice_freeze_consistency(
        lyrics,
        {0: [wrong, consistent]},
        {0: consistent},
        config(),
    )

    assert demoted_count == 1
    assert updated[0][0].freeze_eligible is False
    assert updated[0][0].quality_reason == "global_lattice_path_conflict"


def test_lattice_repeat_slots_are_unique_and_ordered() -> None:
    lyrics = parse_lyrics_text("反復句\n反復句")
    hypotheses = {
        line.index: [
            candidate(
                line.index,
                2.0,
                3.0,
                group=f"early-{line.index}",
                boundary="word",
            ),
            candidate(
                line.index,
                8.0,
                9.0,
                group=f"late-{line.index}",
                boundary="word",
            ),
        ]
        for line in lyrics
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        12.0,
        [],
        config(allow_proportional_authoritative_lattice=True),
    )

    assert [selected[index].start for index in sorted(selected)] == [2.0, 8.0]
    assert diagnostics["selected_count"] == 2


def test_lattice_respects_barriers_and_can_skip_a_line() -> None:
    lyrics = parse_lyrics_text("一行目\n二行目\n三行目")
    hypotheses = {
        0: [candidate(0, 1.0, 2.0, group="first", boundary="word")],
        1: [candidate(1, 5.2, 6.2, group="inside-barrier", score=9.0)],
        2: [candidate(2, 8.0, 9.0, group="third", boundary="word")],
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        12.0,
        [(5.0, 7.0)],
        config(
            lattice_min_selected_ratio=0.65,
            allow_proportional_authoritative_lattice=True,
        ),
    )

    assert set(selected) == {0, 2}
    assert diagnostics["skipped_count"] == 1
    assert diagnostics["coverage_sufficient"] is True


def test_progress_prior_is_robust_to_one_large_outlier() -> None:
    lyrics = parse_lyrics_text(
        "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\ndddddddddd\neeeeeeeeee"
    )
    starts = [1.0, 5.0, 9.0, 13.0, 35.0]
    hypotheses = {
        line.index: [
            candidate(
                line.index,
                starts[line.index],
                starts[line.index] + 1.0,
                group=f"word-{line.index}",
                boundary="word",
            )
        ]
        for line in lyrics
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        40.0,
        [],
        config(),
    )

    assert len(selected) == 4
    assert 4 not in selected
    assert diagnostics["prior_point_count"] == 5
    assert diagnostics["prior_inlier_count"] == 4


def test_boundary_end_fusion_uses_source_capped_huber_medoid() -> None:
    lyrics = parse_lyrics_text("境界融合")
    hypotheses = {
        0: [
            candidate(
                0,
                10.0,
                12.0,
                group="word-a",
                source_family="family-a",
                boundary="word",
            ),
            candidate(
                0,
                10.05,
                12.2,
                group="segment-b",
                source_family="family-b",
                boundary="segment",
            ),
            candidate(
                0,
                10.0,
                16.0,
                group="segment-outlier",
                source_family="family-c",
                boundary="segment",
            ),
        ]
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        24.0,
        [],
        config(
            lattice_min_path_margin=0.0,
            end_fusion_method="huber_medoid",
            allow_proportional_authoritative_lattice=True,
        ),
    )

    assert selected[0].end == pytest.approx(12.2)
    assert diagnostics["end_fused_count"] == 1
    assert diagnostics["end_evidence_count"] == 3
    assert diagnostics["end_fusion_method"] == "huber_medoid"


def test_duration_prior_blends_only_when_end_evidence_is_insufficient() -> None:
    lyrics = parse_lyrics_text(
        "aaaaaaaaaa\nbbbbbbbbbb\ncccccccccc\ndddddddddd"
    )
    hypotheses = {
        line.index: [
            candidate(
                line.index,
                1.0 + 5.0 * line.index,
                (
                    5.0 + 5.0 * line.index
                    if line.index < 3
                    else 18.0
                ),
                group=f"duration-{line.index}",
                boundary_types=(
                    ("segment", "word")
                    if line.index < 3
                    else ("segment",)
                ),
            )
        ]
        for line in lyrics
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        24.0,
        [],
        config(allow_proportional_authoritative_lattice=True),
    )

    assert selected[3].start == pytest.approx(16.0)
    assert selected[3].end == pytest.approx(19.0)
    assert diagnostics["duration_prior_inlier_count"] == 3
    assert diagnostics["duration_prior_blend_count"] >= 1


def test_lattice_failure_falls_back_and_preserves_all_lines(
    wav_factory,
) -> None:
    audio = wav_factory(duration=8)
    lyrics = parse_lyrics_text("一行目\n二行目\n三行目")

    result = align_lyrics(
        audio,
        lyrics,
        FakeBackend([]),
        config=config(),
    )

    assert [line.text for line in result.lines] == [
        "一行目",
        "二行目",
        "三行目",
    ]
    assert result.diagnostics["fallback"]["stage"] == 4
    lattice = result.diagnostics["global_candidate_lattice"]
    assert lattice["coverage_sufficient"] is False
    assert lattice["selected_count"] == 0



def _fixed_width_lyrics(count: int) -> list:
    return parse_lyrics_text(
        "\n".join(
            chr(ord("a") + index) * 10
            for index in range(count)
        )
    )


def test_multi_hypothesis_prior_rejects_coherent_alias_majority() -> None:
    lyrics = _fixed_width_lyrics(6)
    hypotheses: dict[int, list[Candidate]] = {}
    correct_starts = [5.0 + 10.0 * index for index in range(6)]
    alias_starts = [20.0 + (2.0 / 3.0) * index for index in range(6)]
    for line in lyrics:
        hypotheses[line.index] = [
            candidate(
                line.index,
                alias_starts[line.index],
                alias_starts[line.index] + 0.4,
                group=f"alias-{line.index}",
                boundary="word",
                quality=0.91,
                score=5.2,
            ),
            candidate(
                line.index,
                correct_starts[line.index],
                correct_starts[line.index] + 1.0,
                group=f"correct-{line.index}",
                boundary="word",
                quality=0.87,
                score=5.0,
            ),
        ]

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        70.0,
        [],
        config(),
    )

    assert diagnostics["accepted"] is True
    assert diagnostics["prior_mode"] == "robust_multi_hypothesis"
    assert diagnostics["prior_inlier_line_count"] == 6
    assert [
        selected[index].start for index in sorted(selected)
    ] == pytest.approx(correct_starts)


def test_plausible_multi_hypothesis_prior_prefers_wider_time_span() -> None:
    lyrics = _fixed_width_lyrics(5)
    correct_starts = [3.0 + 6.0 * index for index in range(5)]
    alias_starts = [20.0 + 2.5 * index for index in range(5)]
    hypotheses = {
        line.index: [
            candidate(
                line.index,
                alias_starts[line.index],
                alias_starts[line.index] + 0.8,
                group=f"plausible-alias-{line.index}",
                boundary="word",
                quality=0.92,
                score=5.2,
            ),
            candidate(
                line.index,
                correct_starts[line.index],
                correct_starts[line.index] + 0.8,
                group=f"wide-correct-{line.index}",
                boundary="word",
                quality=0.88,
                score=5.0,
            ),
        ]
        for line in lyrics
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        36.0,
        [],
        config(),
    )

    assert diagnostics["accepted"] is True
    assert diagnostics["prior_validation_reason"] == (
        "validated_multi_hypothesis_prior"
    )
    assert [
        selected[index].start for index in sorted(selected)
    ] == pytest.approx(correct_starts)


def test_normalized_emissions_prefer_valid_candidates_over_skips() -> None:
    lyrics = _fixed_width_lyrics(10)
    hypotheses = {
        line.index: [
            candidate(
                line.index,
                1.0 + 4.0 * line.index,
                1.6 + 4.0 * line.index,
                group=f"low-emission-{line.index}",
                boundary="word",
                similarity=0.43,
                quality=0.12,
                confidence=0.22,
                score=-1.5,
            )
        ]
        for line in lyrics
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        45.0,
        [],
        config(allow_proportional_authoritative_lattice=True),
    )

    assert len(selected) >= 7
    assert diagnostics["selected_ratio"] >= 0.70
    assert diagnostics["accepted"] is True


def test_sparse_lattice_is_rejected_without_partial_selection() -> None:
    lyrics = _fixed_width_lyrics(10)
    hypotheses = {
        line.index: [
            candidate(
                line.index,
                2.0 + 4.0 * line.index,
                3.0 + 4.0 * line.index,
                group=f"sparse-{line.index}",
                boundary="word",
            )
        ]
        for line in lyrics[:6]
    }
    hypotheses.update(
        {line.index: [] for line in lyrics[6:]}
    )

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        45.0,
        [],
        config(),
    )

    assert selected == {}
    assert diagnostics["selected_count"] == 6
    assert diagnostics["accepted_selected_count"] == 0
    assert diagnostics["rejected_selected_count"] == 6
    assert diagnostics["accepted"] is False
    assert diagnostics["acceptance_reason"] == (
        "insufficient_selected_ratio"
    )


def _authoritative_stage_three_outcome():
    lyrics = parse_lyrics_text("先頭anchor\n局所hint\n末尾anchor")
    anchors = {
        0: candidate(
            0,
            1.0,
            2.0,
            group="strong-left",
            freeze_eligible=True,
        ),
        2: candidate(
            2,
            9.0,
            10.0,
            group="strong-right",
            freeze_eligible=True,
        ),
    }
    hint = replace(
        candidate(
            1,
            6.0,
            7.4,
            group="accepted-lattice",
        ),
        quality_reason="global_lattice_authoritative_local",
    )
    outcome = build_fallback_alignment(
        lyrics,
        anchors,
        12.0,
        [],
        [],
        config(),
        weak_hints={1: hint},
        reason="round13_fixture",
    )
    return outcome


def test_stage_three_uses_accepted_lattice_center_and_fused_end() -> None:
    outcome = _authoritative_stage_three_outcome()

    assert outcome.stage == 3
    assert outcome.lines[1].start == pytest.approx(6.0)
    assert outcome.lines[1].end == pytest.approx(7.4)
    assert "fallback_global_lattice_local_used" in (
        outcome.lines[1].provenance
    )
    assert outcome.lines[1].diagnostics[
        "global_lattice_local_used"
    ] is True


def test_stage_three_keeps_strong_anchors_exact_with_lattice_hint() -> None:
    outcome = _authoritative_stage_three_outcome()

    assert (outcome.lines[0].start, outcome.lines[0].end) == (
        1.0,
        2.0,
    )
    assert (outcome.lines[2].start, outcome.lines[2].end) == (
        9.0,
        10.0,
    )
    assert all(
        "fallback_stage_3_anchor_frozen" in line.provenance
        for line in (outcome.lines[0], outcome.lines[2])
    )


def test_rejected_lattice_pipeline_uses_legacy_full_line_fallback(
    wav_factory,
) -> None:
    audio = wav_factory(duration=8)
    lyrics = parse_lyrics_text("一行目\n二行目\n三行目")

    result = align_lyrics(
        audio,
        lyrics,
        FakeBackend([]),
        config=config(),
    )

    assert len(result.lines) == 3
    lattice = result.diagnostics["global_candidate_lattice"]
    assert lattice["accepted"] is False
    assert lattice["injected_count"] == 0
    assert lattice["overridden_by_strong_count"] == 0
    assert result.diagnostics["fallback"]["stage"] == 4


def test_lattice_acceptance_diagnostics_never_include_lyric_text() -> None:
    lyrics = parse_lyrics_text(
        "secretalpha\nsecretbravo\nsecretcharlie"
    )
    hypotheses = {
        line.index: [
            candidate(
                line.index,
                1.0 + 4.0 * line.index,
                2.0 + 4.0 * line.index,
                group=f"secret-free-{line.index}",
                boundary="word",
            )
        ]
        for line in lyrics
    }

    _selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        14.0,
        [],
        config(),
    )
    serialized = str(diagnostics)

    assert "secretalpha" not in serialized
    assert "secretbravo" not in serialized
    assert "secretcharlie" not in serialized



def test_path_margin_is_diagnostic_and_all_accepted_hints_are_used() -> None:
    lyrics = _fixed_width_lyrics(4)
    hypotheses = {
        line.index: [
            candidate(
                line.index,
                1.0 + 4.0 * line.index,
                2.0 + 4.0 * line.index,
                group=f"margin-a-{line.index}",
                strategy="unprompted",
                source_family="global-margin-a",
                boundary="word",
            ),
            candidate(
                line.index,
                2.5 + 4.0 * line.index,
                3.5 + 4.0 * line.index,
                group=f"margin-b-{line.index}",
                strategy="unprompted",
                source_family="global-margin-b",
                boundary="word",
            ),
        ]
        for line in lyrics
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        18.0,
        [],
        config(
            lattice_min_path_margin=999.0,
            lattice_path_summary_count=16,
            lattice_prior_penalty_cap=0.0,
        ),
    )

    assert diagnostics["accepted"] is True
    assert diagnostics["path_margin"] == pytest.approx(0.0)
    assert len(selected) == len(lyrics)
    assert any(
        chosen.lattice_path_confidence < 0.60
        for chosen in selected.values()
    )
    hints = {
        line_index: replace(
            chosen,
            quality_reason=(
                "global_lattice_authoritative_local_remote_disagreement"
                if chosen.lattice_remote_disagreement
                else "global_lattice_authoritative_local_low_agreement"
                if chosen.lattice_path_confidence < 0.60
                else "global_lattice_authoritative_local"
            ),
        )
        for line_index, chosen in selected.items()
    }
    outcome = build_fallback_alignment(
        lyrics,
        {},
        18.0,
        [],
        [],
        config(),
        weak_hints=hints,
        reason="margin_diagnostic_fixture",
    )

    assert outcome.stage == 4
    assert all(
        "fallback_global_lattice_local_used" in line.provenance
        for line in outcome.lines
    )


def test_remote_top_path_disagreement_keeps_hint_with_low_confidence() -> None:
    lyrics = parse_lyrics_text("remotealias")
    hypotheses = {
        0: [
            candidate(
                0,
                2.0,
                3.0,
                group="remote-early",
                source_family="remote-early",
                boundary="word",
            ),
            candidate(
                0,
                8.0,
                9.0,
                group="remote-late",
                source_family="remote-late",
                boundary="word",
            ),
        ]
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        12.0,
        [],
        config(
            lattice_min_path_margin=999.0,
            lattice_require_valid_prior=False,
            allow_proportional_authoritative_lattice=True,
        ),
    )

    chosen = selected[0]
    assert chosen.lattice_remote_disagreement is True
    assert chosen.lattice_path_confidence < 0.60
    assert "global_lattice_remote_path_disagreement" in chosen.provenance
    assert diagnostics["remote_disagreement_line_count"] == 1
    hint = replace(
        chosen,
        quality_reason=(
            "global_lattice_authoritative_local_remote_disagreement"
        ),
    )
    outcome = build_fallback_alignment(
        lyrics,
        {},
        12.0,
        [],
        [],
        config(),
        weak_hints={0: hint},
        reason="remote_disagreement_fixture",
    )

    assert "fallback_global_lattice_local_used" in outcome.lines[0].provenance
    assert "fallback_lattice_remote_path_disagreement" in (
        outcome.lines[0].provenance
    )
    assert outcome.lines[0].confidence <= 0.02


def test_weighted_upper_quantile_is_later_than_median_and_ordered() -> None:
    lyrics = parse_lyrics_text("firstline\nsecondline")
    hypotheses = {
        0: [
            candidate(
                0,
                1.0,
                end,
                group=f"quantile-{ordinal}",
                source_family=f"quantile-{ordinal}",
                boundary="word",
            )
            for ordinal, end in enumerate((2.0, 2.5, 3.0))
        ],
        1: [
            candidate(
                1,
                4.0,
                5.0,
                group="quantile-next",
                boundary="word",
            )
        ],
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        8.0,
        [],
        config(
            lattice_require_valid_prior=False,
            allow_proportional_authoritative_lattice=True,
        ),
    )

    assert selected[0].end == pytest.approx(3.0)
    assert selected[0].end > 2.5
    assert selected[0].end <= selected[1].start
    assert (
        config().min_line_seconds
        <= selected[0].end - selected[0].start
        <= config().max_line_seconds
    )
    assert diagnostics["end_fusion_quantile"] == pytest.approx(0.85)


def test_end_fusion_caps_each_source_family_to_one_vote() -> None:
    lyrics = parse_lyrics_text("familycap")
    hypotheses = {
        0: [
            candidate(
                0,
                1.0,
                2.0,
                group="same-family-best",
                source_family="same-family",
                boundary="word",
                quality=0.95,
            ),
            candidate(
                0,
                1.0,
                6.0,
                group="same-family-late-a",
                source_family="same-family",
                boundary="word",
                quality=0.60,
            ),
            candidate(
                0,
                1.0,
                7.0,
                group="same-family-late-b",
                source_family="same-family",
                boundary="word",
                quality=0.55,
            ),
            candidate(
                0,
                1.0,
                2.2,
                group="independent-family",
                source_family="independent-family",
                boundary="word",
                quality=0.95,
            ),
        ]
    }

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        10.0,
        [],
        config(
            lattice_require_valid_prior=False,
            allow_proportional_authoritative_lattice=True,
        ),
    )

    assert selected[0].end == pytest.approx(2.2)
    assert diagnostics["end_evidence_count"] == 2
    assert diagnostics["fusion_evidence_group_histogram"]["2"] == 1


def test_end_reliability_breaks_small_start_emission_tie() -> None:
    lyrics = parse_lyrics_text("endtiebreak")
    hypotheses = {
        0: [
            candidate(
                0,
                1.0,
                2.0,
                group="backed-a",
                source_family="backed-a",
                boundary="word",
                score=5.0,
            ),
            candidate(
                0,
                1.0,
                2.1,
                group="backed-b",
                source_family="backed-b",
                boundary="word",
                score=5.0,
            ),
            candidate(
                0,
                1.0,
                4.0,
                group="isolated",
                source_family="isolated",
                boundary="word",
                score=5.02,
            ),
        ]
    }

    selected, _diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        8.0,
        [],
        config(
            lattice_require_valid_prior=False,
            allow_proportional_authoritative_lattice=True,
        ),
    )

    assert selected[0].source_families != ("isolated",)


def test_diagnostics_are_redacted_replay_stable_aggregates() -> None:
    lyrics = parse_lyrics_text(
        "redactedalpha\nredactedbravo\nredactedcharlie"
    )
    hypotheses = {
        line.index: [
            candidate(
                line.index,
                1.0 + 4.0 * line.index,
                2.0 + 4.0 * line.index,
                group=f"redacted-{line.index}",
                boundary="word",
            )
        ]
        for line in lyrics
    }
    settings = config()
    _first_selected, first = select_global_lattice(
        lyrics,
        hypotheses,
        14.0,
        [],
        settings,
    )
    _second_selected, second = select_global_lattice(
        lyrics,
        hypotheses,
        14.0,
        [],
        settings,
    )

    assert first == second
    for key in (
        "prior_rate",
        "prior_intercept",
        "usable_audio_span_seconds",
        "prior_predicted_span_seconds",
        "prior_predicted_span_ratio",
        "prior_validation_subreasons",
        "top_path_score_aggregates",
        "top_path_agreement_histogram",
        "fusion_evidence_group_histogram",
    ):
        assert key in first
    serialized = str(first)
    assert "redactedalpha" not in serialized
    assert "redactedbravo" not in serialized
    assert "redactedcharlie" not in serialized



def _partial_proportional_fixture() -> tuple[
    list, dict[int, list[Candidate]]
]:
    lyrics = parse_lyrics_text(
        "\n".join(f"line{index:02d}" for index in range(30))
    )
    hypotheses = {
        line.index: [
            candidate(
                line.index,
                1.0 + 2.0 * line.index,
                1.8 + 2.0 * line.index,
                group=f"partial-{line.index}",
                strategy="local_initial_prompt",
                source_family="collective-prompt-alias",
                boundary="segment",
            )
        ]
        for line in lyrics[:28]
    }
    hypotheses.update(
        {line.index: [] for line in lyrics[28:]}
    )
    return lyrics, hypotheses


def test_proportional_prior_default_atomically_rejects_partial_path() -> None:
    lyrics, hypotheses = _partial_proportional_fixture()

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        76.0,
        [],
        config(),
    )

    assert selected == {}
    assert diagnostics["selected_count"] == 28
    assert diagnostics["selected_ratio"] == pytest.approx(28 / 30)
    assert diagnostics["prior_mode"] == "proportional_fallback"
    assert diagnostics["prior_valid"] is True
    assert diagnostics["prior_valid_authoritative"] is False
    assert diagnostics["authority_allowed"] is False
    assert diagnostics["authority_reason"] == (
        "proportional_fallback_diagnostic_only"
    )
    assert diagnostics["acceptance_reason"] == (
        "progress_prior_not_authoritative"
    )
    assert diagnostics["lineage_counts"] == {
        "accepted": 0,
        "injected": 0,
        "rejected": 28,
        "overridden": 0,
        "actual_used": 0,
    }
    outcome = build_fallback_alignment(
        lyrics,
        {},
        76.0,
        [],
        [],
        config(),
        weak_hints={},
        reason="proportional_prior_rejected_fixture",
    )
    assert len(outcome.lines) == 30


def test_proportional_prior_explicit_opt_in_is_low_confidence() -> None:
    lyrics, hypotheses = _partial_proportional_fixture()

    selected, diagnostics = select_global_lattice(
        lyrics,
        hypotheses,
        76.0,
        [],
        config(allow_proportional_authoritative_lattice=True),
    )

    assert len(selected) == 28
    assert diagnostics["authority_allowed"] is True
    assert diagnostics["authority_reason"] == (
        "proportional_fallback_explicit_opt_in"
    )
    assert all(
        chosen.lattice_path_confidence <= 0.50
        for chosen in selected.values()
    )
    assert all(
        "global_lattice_proportional_authority_opt_in"
        in chosen.provenance
        for chosen in selected.values()
    )


def _progress_gate_diagnostics(
    *,
    authoritative: bool = False,
) -> dict[str, object]:
    return {
        "prior_valid_authoritative": authoritative,
        "prior_mode": (
            "robust_multi_hypothesis"
            if authoritative
            else "proportional_fallback"
        ),
        "prior_rate": 1.0,
        "prior_intercept": 0.0,
    }


def test_generic_progress_gate_demotes_76_second_extreme_anchor() -> None:
    lyrics = parse_lyrics_text("firstline\nsecondline\nthirdline")
    extreme = candidate(
        0,
        60.0,
        61.0,
        group="extreme-generic",
        source_family="normal-mix-generic",
        boundary="segment",
        freeze_eligible=True,
    )
    candidates = {0: [extreme], 1: [], 2: []}

    gated, diagnostics = _apply_progress_freeze_gate(
        lyrics,
        candidates,
        76.0,
        [],
        config(),
        _progress_gate_diagnostics(),
        normal_mix=True,
    )

    assert gated[0][0].freeze_eligible is False
    assert gated[0][0].quality_reason == "absolute_progress_outlier"
    assert diagnostics["demoted_count"] == 1
    assert diagnostics["generic_envelope_gate_count"] == 1
    assert diagnostics["progress_deviation_histogram"]["0.50-plus"] == 1


def test_generic_progress_gate_accounts_for_audio_padding() -> None:
    lyrics = parse_lyrics_text("firstline\nsecondline\nthirdline")
    in_envelope = candidate(
        0,
        19.5,
        20.5,
        group="in-envelope-generic",
        source_family="normal-mix-generic",
        boundary="segment",
        freeze_eligible=True,
    )
    candidates = {0: [in_envelope], 1: [], 2: []}

    gated, diagnostics = _apply_progress_freeze_gate(
        lyrics,
        candidates,
        76.0,
        [(0.0, 10.0), (70.0, 76.0)],
        config(),
        _progress_gate_diagnostics(),
        normal_mix=True,
    )

    assert gated[0][0].freeze_eligible is True
    assert diagnostics["passed_count"] == 1
    assert diagnostics["demoted_count"] == 0
    assert diagnostics["progress_deviation_histogram"]["0.00-0.10"] == 1


def test_progress_gate_exempts_trusted_acoustic_source() -> None:
    lyrics = parse_lyrics_text("firstline\nsecondline\nthirdline")
    trusted = candidate(
        0,
        60.0,
        61.0,
        group="trusted-extreme",
        source_family="trusted_vocal_stem",
        boundary="segment",
        freeze_eligible=True,
    )
    candidates = {0: [trusted], 1: [], 2: []}

    gated, diagnostics = _apply_progress_freeze_gate(
        lyrics,
        candidates,
        76.0,
        [],
        config(),
        _progress_gate_diagnostics(),
        normal_mix=True,
    )

    assert gated[0][0].freeze_eligible is True
    assert diagnostics["trusted_source_exempt_count"] == 1
    assert diagnostics["demoted_count"] == 0



def test_progress_gate_uses_validated_prior_residual() -> None:
    lyrics = parse_lyrics_text("a\nb\nc")
    outlier = candidate(
        2,
        50.0,
        51.0,
        group="robust-prior-outlier",
        source_family="normal-mix-generic",
        boundary="segment",
        freeze_eligible=True,
    )
    candidates = {0: [], 1: [], 2: [outlier]}
    diagnostics = {
        "prior_valid_authoritative": True,
        "prior_mode": "robust_multi_hypothesis",
        "prior_rate": 10.0,
        "prior_intercept": 1.0,
    }

    gated, public = _apply_progress_freeze_gate(
        lyrics,
        candidates,
        76.0,
        [],
        config(),
        diagnostics,
        normal_mix=True,
    )

    assert gated[2][0].freeze_eligible is False
    assert gated[2][0].quality_reason == "absolute_progress_outlier"
    assert public["mode"] == "robust_prior_residual"
    assert public["robust_prior_gate_count"] == 1
    assert public["generic_envelope_gate_count"] == 0



def test_default_progress_envelope_rejects_line23_synthetic() -> None:
    lyrics = parse_lyrics_text(
        "\n".join(f"line{index:02d}" for index in range(30))
    )
    candidate_center = 0.562271 * 76.0
    public_candidate = candidate(
        23,
        candidate_center - 0.5,
        candidate_center + 0.5,
        group="line23-public-synthetic",
        source_family="normal-mix-generic",
        boundary="segment",
        freeze_eligible=True,
    )
    candidates = {
        line.index: (
            [public_candidate] if line.index == 23 else []
        )
        for line in lyrics
    }

    default_gated, default_diagnostics = (
        _apply_progress_freeze_gate(
            lyrics,
            candidates,
            76.0,
            [],
            config(),
            _progress_gate_diagnostics(),
            normal_mix=True,
        )
    )
    relaxed_gated, relaxed_diagnostics = (
        _apply_progress_freeze_gate(
            lyrics,
            candidates,
            76.0,
            [],
            config(max_progress_deviation=0.25),
            _progress_gate_diagnostics(),
            normal_mix=True,
        )
    )

    assert pytest.approx(
        0.22106233333333336
    ) == (23.5 / 30) - 0.562271
    assert default_gated[23][0].freeze_eligible is False
    assert default_gated[23][0].quality_reason == (
        "absolute_progress_outlier"
    )
    assert default_diagnostics[
        "configured_max_progress_deviation"
    ] == pytest.approx(0.20)
    assert default_diagnostics["generic_envelope_relaxed"] is False
    assert relaxed_gated[23][0].freeze_eligible is True
    assert relaxed_diagnostics[
        "configured_max_progress_deviation"
    ] == pytest.approx(0.25)
    assert relaxed_diagnostics["generic_envelope_relaxed"] is True

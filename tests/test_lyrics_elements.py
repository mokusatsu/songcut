from __future__ import annotations

import pytest

from songcut.lyrics_elements import (
    CtcTokenSpan,
    DisplayElement,
    align_display_elements,
    evaluate_display_alignment_quality,
    map_pronunciation_to_tokens,
    split_display_elements,
)


def _romanize(text: str, _language: str) -> str:
    return {
        "\u304d\u3083": "kya",
        "\u3063": "q",
        "\u3077\u30fc\u3001": "puu",
        "\u4eca": "ky",
        "\u65e5": "ou",
        "\u3082": "mo",
        "\u541b": "kimi",
        "\u3092": "wo",
    }.get(text, text)


def test_split_preserves_source_partition_and_joins_small_kana_sokuon_long_vowel() -> None:
    seeds = split_display_elements("\u304d\u3083\u3063\u3077\u30fc\u3001", romanize=_romanize)

    assert [seed.text for seed in seeds] == ["\u304d\u3083", "\u3063", "\u3077\u30fc\u3001"]
    assert [(seed.source_start, seed.source_end) for seed in seeds] == [(0, 2), (2, 3), (3, 6)]
    assert "".join(seed.text for seed in seeds) == "\u304d\u3083\u3063\u3077\u30fc\u3001"
    assert [seed.pronunciation for seed in seeds] == ["kya", "q", "puu"]


def test_combining_mark_and_variation_selector_stay_with_previous_grapheme() -> None:
    seeds = split_display_elements("\u304b\u3099\u6f22\ufe0f", romanize=lambda value, _language: value)

    assert [seed.text for seed in seeds] == ["\u304b\u3099", "\u6f22\ufe0f"]
    assert [(seed.source_start, seed.source_end) for seed in seeds] == [(0, 2), (2, 4)]


def test_punctuation_attaches_to_nearest_pronouncing_element() -> None:
    seeds = split_display_elements("\u3001\u541b\u3088\u3002", romanize=_romanize)

    assert [seed.text for seed in seeds] == ["\u3001\u541b", "\u3088\u3002"]
    assert all(seed.text for seed in seeds)


def test_pronunciation_mapping_keeps_per_seed_token_ranges() -> None:
    seeds = split_display_elements("\u4eca\u65e5\u3082", romanize=_romanize)
    mappings = map_pronunciation_to_tokens(seeds, {char: index + 1 for index, char in enumerate("kyoumo")})

    assert [(mapping.seed_index, mapping.token_start, mapping.token_end) for mapping in mappings] == [
        (0, 0, 2),
        (1, 2, 4),
        (2, 4, 6),
    ]
    assert mappings[0].token_ids == (1, 2)


def test_contextual_pronunciation_matches_the_full_mms_target() -> None:
    def romanize(text: str, _language: str) -> str:
        return {
            "\u304d\u3063\u3068": "kitto",
            "\u304d": "ki",
            "\u3063": "tsu",
            "\u3068": "to",
        }[text]

    seeds = split_display_elements("\u304d\u3063\u3068", romanize=romanize)

    assert [seed.text for seed in seeds] == ["\u304d", "\u3063", "\u3068"]
    assert "".join(seed.pronunciation for seed in seeds) == "kitto"
    mappings = map_pronunciation_to_tokens(
        seeds,
        {character: index + 1 for index, character in enumerate("kito")},
    )
    assert "".join(mapping.token_text for mapping in mappings) == "kitto"


def test_contextual_kanji_reading_is_partitioned_without_changing_target() -> None:
    def romanize(text: str, _language: str) -> str:
        return {
            "\u4eca\u65e5\u3082": "kyoumo",
            "\u4eca": "ima",
            "\u65e5": "nichi",
            "\u3082": "mo",
        }[text]

    seeds = split_display_elements("\u4eca\u65e5\u3082", romanize=romanize)

    assert "".join(seed.pronunciation for seed in seeds) == "kyoumo"
    assert all(left.pronunciation_end == right.pronunciation_start for left, right in zip(seeds, seeds[1:]))


def _tokens(count: int, *, start: float = 10.0, confidence: float = 0.9) -> list[CtcTokenSpan]:
    return [
        CtcTokenSpan(
            token_index=index,
            token_id=index + 1,
            token_text="x",
            line_index=1,
            start=start + index * 0.2,
            end=start + (index + 1) * 0.2,
            confidence=confidence,
        )
        for index in range(count)
    ]


def test_align_returns_monotonic_elements_inside_line_and_inserts_blank_gap() -> None:
    seeds = split_display_elements("\u4eca\u65e5\u3082", romanize=_romanize)
    mappings = map_pronunciation_to_tokens(seeds, {char: index + 1 for index, char in enumerate("kyoumo")})
    tokens = _tokens(6, start=10.4)
    result = align_display_elements(
        seeds,
        tokens,
        line_start=10.0,
        line_end=12.0,
        mappings=mappings,
        line_id="line-1",
    )

    assert result.diagnostics.accepted
    assert result.elements[0].start == pytest.approx(10.0)
    assert result.elements[-1].end == pytest.approx(12.0)
    assert any(element.is_blank for element in result.elements)
    assert all(element.end > element.start for element in result.elements)
    assert all(left.end <= right.start + 1e-9 for left, right in zip(result.elements, result.elements[1:]))


def test_partial_ctc_uses_pronunciation_weighted_interpolation() -> None:
    seeds = split_display_elements("\u4eca\u65e5\u3082", romanize=_romanize)
    mappings = map_pronunciation_to_tokens(seeds, {char: index + 1 for index, char in enumerate("kyoumo")})
    # The final seed has no token span; accepted coverage still allows partial fallback.
    tokens = [
        CtcTokenSpan(index, index + 1, "x", 1, 2.0 + index * 0.1, 2.1 + index * 0.1, 0.9)
        for index in range(4)
    ]
    result = align_display_elements(seeds, tokens, line_start=2.0, line_end=4.0, mappings=mappings)

    assert result.source == "mms-ctc-interpolated"
    assert all(element.end > element.start for element in result.elements)
    assert result.elements[-1].end == pytest.approx(4.0)


def test_bad_ctc_falls_back_to_line_proportional_without_zero_duration() -> None:
    seeds = split_display_elements("\u4eca\u65e5\u3082", romanize=_romanize)
    mappings = map_pronunciation_to_tokens(seeds, {char: index + 1 for index, char in enumerate("kyoumo")})
    tokens = _tokens(6, start=2.0, confidence=0.05)
    result = align_display_elements(seeds, tokens, line_start=1.0, line_end=5.0, mappings=mappings)

    assert result.source == "line-proportional"
    assert result.diagnostics.accepted is False
    assert [element.text for element in result.elements if not element.is_blank] == ["\u4eca", "\u65e5", "\u3082"]
    assert all(element.end > element.start for element in result.elements)


def test_quality_gate_exposes_star_edge_and_first_token_diagnostics() -> None:
    tokens = [
        CtcTokenSpan(0, 0, "x", 1, 0.0, 0.8, 0.9),
        CtcTokenSpan(1, 1, "x", 1, 2.0, 2.1, 0.2),
        CtcTokenSpan(2, 0, "*", 1, 2.1, 2.2, 0.9, is_star=True),
    ]
    diagnostics = evaluate_display_alignment_quality(
        tokens,
        expected_token_count=3,
        window_start=0.0,
        window_end=2.2,
    )

    assert diagnostics.star_ratio > 0
    assert diagnostics.isolated_first_token
    assert diagnostics.accepted is False
    assert diagnostics.rejection_reasons


def test_stable_ids_are_deterministic_and_manual_constraints_are_retained() -> None:
    seeds_a = split_display_elements("\u4eca\u65e5", line_id="same", romanize=_romanize)
    seeds_b = split_display_elements("\u4eca\u65e5", line_id="same", romanize=_romanize)
    assert [seed.stable_id for seed in seeds_a] == [seed.stable_id for seed in seeds_b]
    mappings = map_pronunciation_to_tokens(seeds_a, {char: index + 1 for index, char in enumerate("kyou")})
    result = align_display_elements(
        seeds_a,
        _tokens(4, start=3.0),
        line_start=3.0,
        line_end=4.0,
        mappings=mappings,
        start_locked=True,
        end_locked=True,
        parent_revision=7,
    )
    assert all(element.manual_start and element.manual_end for element in result.elements if not element.is_blank)
    assert all(element.parent_revision == 7 for element in result.elements)


def test_display_element_is_frozen() -> None:
    with pytest.raises(AttributeError):
        DisplayElement(0, "x", 0.0, 1.0, 1.0, "test").start = 2.0  # type: ignore[misc]

import json

import pytest

ass_lyric_effects = pytest.importorskip("ass_lyric_effects")

from songcut.subtitle_effect_catalog import (  # noqa: E402
    UnknownSubtitleEffectError,
    UnknownSubtitleEffectParameterError,
    estimate_subtitle_effect_event_count,
    get_subtitle_effect_catalog,
    normalize_subtitle_effect_params,
    validate_subtitle_effect,
)


def test_catalog_is_a_fresh_json_safe_copy_with_97_stable_ids() -> None:
    catalog = get_subtitle_effect_catalog()
    assert catalog["version"] == "3.0.0"
    assert len(catalog["effects"]) == 97
    ids = [entry["effect_id"] for entry in catalog["effects"]]
    assert len(ids) == len(set(ids))
    json.dumps(catalog, ensure_ascii=False, allow_nan=False)

    catalog["effects"][0]["effect_id"] = "mutated"
    fresh = get_subtitle_effect_catalog()
    assert fresh["effects"][0]["effect_id"] == "cut"


def test_catalog_preserves_page_and_choice_label_contract() -> None:
    catalog = get_subtitle_effect_catalog()
    assert isinstance(catalog.get("pages"), dict)
    for effect in catalog["effects"]:
        assert {"preview_url", "catalog_page_url_en", "catalog_page_url_ja"} <= set(effect)
        for parameter in effect["parameters"].values():
            assert set(parameter["choice_labels_en"]) == set(parameter["choices"])
            assert set(parameter["choice_labels_ja"]) == set(parameter["choices"])


def test_normalize_fills_defaults_without_accepting_unknown_values() -> None:
    assert normalize_subtitle_effect_params("zoom", {}) == {"min_scale": 0}
    assert normalize_subtitle_effect_params("color_wave", {})["palette"]

    with pytest.raises(UnknownSubtitleEffectError, match="unknown effect_id"):
        validate_subtitle_effect("not-a-stable-effect", {})
    with pytest.raises(UnknownSubtitleEffectParameterError, match="unknown parameter"):
        validate_subtitle_effect("zoom", {"not_a_parameter": 1})


@pytest.mark.parametrize(
    ("effect_id", "params", "message"),
    [
        ("zoom", {"min_scale": -1}, ">="),
        ("zoom", {"min_scale": 100}, "<="),
        ("zoom", {"min_scale": True}, "expected number"),
        ("slide", {"direction": "diagonal"}, "one of"),
        ("color_wave", {"palette": ["#fff", 1]}, "only strings"),
        ("scramble_resolve", {"charset": 42}, "expected string"),
    ],
)
def test_parameter_kind_range_and_choices_are_explicit(
    effect_id: str, params: dict[str, object], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        normalize_subtitle_effect_params(effect_id, params)


def test_estimate_delegates_to_v3_and_preserves_budget_error() -> None:
    estimate = estimate_subtitle_effect_event_count(
        "afterimage_wave", 5000, grapheme_count=8, line_count=2
    )
    assert estimate["effect_id"] == "afterimage_wave"
    assert estimate["estimated_events"] > 0

    with pytest.raises(ass_lyric_effects.EventBudgetExceededError) as caught:
        estimate_subtitle_effect_event_count("waterfall", 5000, budget=1)
    assert caught.value.effect_id == "waterfall"
    assert caught.value.estimated_events > caught.value.budget

from __future__ import annotations

import pytest

from ass_lyric_effects import get_effect_catalog

from songcut.subtitle_export import (
    SubtitleEffect,
    SubtitleLane,
    SubtitleSegment,
    SubtitleStyle,
    render_ass_document,
)


@pytest.mark.parametrize("alignment", range(1, 10))
@pytest.mark.parametrize("play_res_x,play_res_y", [(640, 360), (320, 180)])
def test_all_v3_effects_generate_single_and_multiline_ass_at_every_alignment(
    alignment: int,
    play_res_x: int,
    play_res_y: int,
) -> None:
    catalog = get_effect_catalog()
    assert len(catalog["effects"]) == 97

    for effect in catalog["effects"]:
        defaults = {
            name: schema["default"]
            for name, schema in effect["parameters"].items()
        }
        for text in ("A\u0301歌", "上\n\n下"):
            lane = SubtitleLane(
                id="integration",
                name="Integration",
                style=SubtitleStyle(
                    font_size=18,
                    alignment=alignment,
                    margin_l=24,
                    margin_r=24,
                    margin_v=24,
                    outline=1,
                ),
                segments=[
                    SubtitleSegment(
                        id="line",
                        text=text,
                        start=0.0,
                        end=0.8,
                    )
                ],
                effect=SubtitleEffect(
                    name=effect["effect_id"],
                    start_duration_ms=200,
                    end_duration_ms=200,
                    params=defaults,
                ),
            )
            document = render_ass_document(
                [lane],
                play_res_x=play_res_x,
                play_res_y=play_res_y,
                apply_effects=True,
            )
            assert "Dialogue:" in document, (effect["effect_id"], alignment, text)

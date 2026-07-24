import base64
from pathlib import Path

import pytest

from songcut.ffmpeg_tools import FfmpegPaths

from songcut.subtitle_export import (
    SubtitleEffect,
    SubtitleLane,
    SubtitleSegment,
    SubtitleStyle,
    _ffmpeg_progress_seconds,
    _fit_effect_durations,
    render_ass_document,
    render_lane_srt,
    render_subtitle_png_base64,
    render_srt_style_document,
    subtitle_style_from_mapping,
)


def test_lane_srt_keeps_text_and_orders_segments() -> None:
    text = render_lane_srt(
        [
            SubtitleSegment("later", "二行目", 2.0, 3.0),
            SubtitleSegment("first", "一行目", 0.5, 1.5),
        ]
    )

    assert text.index("一行目") < text.index("二行目")
    assert "00:00:00,500 --> 00:00:01,500" in text


def test_srt_style_uses_numpad_alignment_and_ass_color_order() -> None:
    style = SubtitleStyle(primary_color="#112233", background_color="#44556680", alignment=7)

    text = render_srt_style_document(style, play_res_x=1280, play_res_y=720)
    style_line = next(line for line in text.splitlines() if line.startswith("Style:"))

    assert "PlayResX: 1280" in text
    assert "&H00332211" in style_line
    assert "&H80665544" in style_line
    assert style_line.split(",")[18] == "7"


def test_subtitle_style_mapping_clamps_values_to_api_limits() -> None:
    style = subtitle_style_from_mapping(
        {
            "font_size": 500,
            "outline": 40,
            "shadow": 50,
            "margin_l": 5000,
            "margin_r": -10,
            "margin_v": 9999,
        }
    )

    assert style.font_size == 400
    assert style.outline == 30
    assert style.shadow == 30
    assert style.margin_l == 4000
    assert style.margin_r == 0
    assert style.margin_v == 4000


def test_combined_ass_has_one_style_per_lane_and_escapes_text() -> None:
    lanes = [
        SubtitleLane(
            "lyrics",
            "Lyrics",
            SubtitleStyle(alignment=2),
            [SubtitleSegment("line", r"{歌詞}\line", 1.0, 2.0)],
        ),
        SubtitleLane(
            "title",
            "Title",
            SubtitleStyle(alignment=7),
            [SubtitleSegment("title", "タイトル", 0.0, 5.0)],
        ),
    ]

    text = render_ass_document(lanes, play_res_x=1920, play_res_y=1080)

    assert "Style: Lane1" in text
    assert "Style: Lane2" in text
    assert "Dialogue: 0,0:00:01.00,0:00:02.00,Lane1" in text
    assert r"\{歌詞\}\\line" in text


def test_effect_is_applied_only_when_export_rendering_requests_it() -> None:
    lane = SubtitleLane(
        "lyrics",
        "Lyrics",
        SubtitleStyle(alignment=7),
        [SubtitleSegment("line", "歌詞", 1.0, 3.0)],
        SubtitleEffect(name="fad", start_duration_ms=250, end_duration_ms=400),
    )

    preview = render_ass_document([lane], play_res_x=1920, play_res_y=1080)
    exported = render_ass_document(
        [lane],
        play_res_x=1920,
        play_res_y=1080,
        apply_effects=True,
    )

    assert r"\fad" not in preview
    assert r"\fad(250,400)" in exported


def test_short_segments_fit_effect_durations_without_changing_ratio() -> None:
    assert _fit_effect_durations(600, 400, 0.5) == (300, 200)
    assert _fit_effect_durations(100, 200, 1.0) == (100, 200)


def test_context_effect_uses_lane_alignment_geometry() -> None:
    lane = SubtitleLane(
        "title",
        "Title",
        SubtitleStyle(alignment=7, margin_l=80, margin_v=70),
        [SubtitleSegment("title", "タイトル", 0.0, 2.0)],
        SubtitleEffect(
            name="wipe",
            start_duration_ms=300,
            end_duration_ms=300,
            params={"direction": "left_to_right"},
        ),
    )

    exported = render_ass_document(
        [lane],
        play_res_x=1280,
        play_res_y=720,
        apply_effects=True,
    )

    assert r"\clip(" in exported
    assert "Dialogue:" in exported


def test_ffmpeg_progress_parser_accepts_machine_progress_fields() -> None:
    assert _ffmpeg_progress_seconds("out_time_us=1250000") == 1.25
    assert _ffmpeg_progress_seconds("out_time_ms=2500000") == 2.5
    assert _ffmpeg_progress_seconds("out_time=00:01:02.500000") == 62.5
    assert _ffmpeg_progress_seconds("progress=continue") is None
    assert _ffmpeg_progress_seconds("out_time_us=N/A") is None


def test_bundled_ffmpeg_renders_static_ass_frame_as_rgba_png() -> None:
    root = Path(__file__).resolve().parent.parent / "third_party" / "ffmpeg" / "bin"
    ffmpeg = root / "ffmpeg.exe"
    ffprobe = root / "ffprobe.exe"
    if not ffmpeg.exists() or not ffprobe.exists():
        pytest.skip("bundled ffmpeg is unavailable")

    encoded = render_subtitle_png_base64(
        "透明字幕",
        SubtitleStyle(font_size=32),
        play_res_x=320,
        play_res_y=180,
        ffmpeg_paths=FfmpegPaths(ffmpeg=ffmpeg, ffprobe=ffprobe),
    )
    png = base64.b64decode(encoded)

    assert png.startswith(b"\x89PNG\r\n\x1a\n")
    assert int.from_bytes(png[16:20], "big") == 320
    assert int.from_bytes(png[20:24], "big") == 180
    assert png[25] == 6

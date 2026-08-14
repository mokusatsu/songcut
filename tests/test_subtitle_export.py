import base64
import io
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest

from songcut.ffmpeg_tools import FfmpegPaths

from songcut.subtitle_export import (
    SubtitleDisplayElement,
    SubtitleEffect,
    SubtitleFileSegment,
    SubtitleLane,
    SubtitleSegment,
    SubtitleStyle,
    _ffmpeg_progress_seconds,
    _effect_context,
    _effect_params,
    _fit_effect_durations,
    _run_ffmpeg_with_progress,
    export_subtitle_file,
    export_subtitle_bundle,
    format_lrc_timestamp,
    render_ass_document,
    render_lane_srt,
    render_lrc_document,
    render_merged_srt,
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


def test_merged_srt_orders_selected_timelines_as_one_document() -> None:
    text = render_merged_srt(
        [
            SubtitleLane(
                "lyrics-2",
                "Lyrics 2",
                SubtitleStyle(),
                [SubtitleSegment("later", "later", 2.0, 3.0)],
            ),
            SubtitleLane(
                "lyrics-1",
                "Lyrics 1",
                SubtitleStyle(),
                [SubtitleSegment("first", "first", 1.0, 2.0)],
            ),
        ]
    )

    assert text.startswith("1\n00:00:01,000 --> 00:00:02,000\nfirst")
    assert "2\n00:00:02,000 --> 00:00:03,000\nlater" in text


def test_lrc_document_keeps_display_element_tags_blank_and_line_end() -> None:
    lane = SubtitleLane(
        "lyrics",
        "Lyrics",
        SubtitleStyle(),
        [
            SubtitleFileSegment(
                "line",
                "呼んで",
                6.6,
                10.18,
                display_elements=(
                    SubtitleDisplayElement("呼ん", 6.6, 7.22),
                    SubtitleDisplayElement("", 7.22, 7.52),
                    SubtitleDisplayElement("で", 7.52, 10.18),
                ),
            )
        ],
    )

    assert render_lrc_document([lane]) == (
        "[00:06.60]<00:06.60>呼ん<00:07.22><00:07.52>で<00:10.18>\n"
    )


def test_lrc_falls_back_to_line_text_and_rounds_centiseconds() -> None:
    lane = SubtitleLane(
        "lyrics",
        "Lyrics",
        SubtitleStyle(),
        [SubtitleSegment("line", "未解析の歌詞", 59.999, 61.001)],
    )

    assert format_lrc_timestamp(59.999) == "01:00.00"
    assert render_lrc_document([lane]) == "[01:00.00]<01:00.00>未解析の歌詞<01:01.00>\n"


def test_export_subtitle_file_writes_one_selected_format(tmp_path: Path) -> None:
    lane = SubtitleLane(
        "lyrics",
        "Lyrics",
        SubtitleStyle(),
        [SubtitleSegment("line", "歌詞", 1.0, 2.0)],
    )

    result = export_subtitle_file(
        Path("source video.mp4"),
        tmp_path,
        [lane],
        export_format="srt",
        play_res_x=1280,
        play_res_y=720,
    )

    target = Path(result["file"])
    assert target.name == "source video-subtitles.srt"
    assert target.read_text(encoding="utf-8-sig") == "1\n00:00:01,000 --> 00:00:02,000\n歌詞\n"


def test_subtitle_effect_defaults_to_750ms_transitions() -> None:
    effect = SubtitleEffect()

    assert effect.start_duration_ms == 750
    assert effect.end_duration_ms == 750


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


def test_segment_overrides_use_effective_styles_and_effect_context() -> None:
    lane = SubtitleLane(
        "lyrics",
        "Lyrics",
        SubtitleStyle(alignment=2, font_size=48),
        [
            SubtitleSegment("base", "通常", 0.0, 1.0),
            SubtitleSegment(
                "override",
                "上部",
                1.0,
                2.0,
                style_override=SubtitleStyle(alignment=7, font_size=80, margin_l=80, margin_v=70),
                effect_override=SubtitleEffect(
                    name="wipe",
                    start_duration_ms=250,
                    end_duration_ms=400,
                    params={"direction": "left_to_right"},
                ),
            ),
        ],
    )

    text = render_ass_document([lane], play_res_x=1280, play_res_y=720, apply_effects=True)
    style_lines = [line for line in text.splitlines() if line.startswith("Style:")]
    dialogue_lines = [line for line in text.splitlines() if line.startswith("Dialogue:")]
    base_style_name = dialogue_lines[0].split(",")[3]
    override_style_name = dialogue_lines[1].split(",")[3]

    assert base_style_name != override_style_name
    assert sum(line.startswith(f"Style: {base_style_name},") for line in style_lines) == 1
    assert sum(line.startswith(f"Style: {override_style_name},") for line in style_lines) == 1
    assert f"Style: {override_style_name}," in style_lines[1]
    assert ",80," in style_lines[1]
    assert r"\clip(" in dialogue_lines[1]


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


def test_glow_converts_gui_rgb_color_to_ass_bgr_override() -> None:
    lane = SubtitleLane(
        "lyrics",
        "Lyrics",
        SubtitleStyle(),
        [SubtitleSegment("line", "歌詞", 1.0, 3.0)],
        SubtitleEffect(
            name="glow",
            params={"radius": 20, "border": 12, "color": "#42D7FF"},
        ),
    )

    exported = render_ass_document(
        [lane],
        play_res_x=1920,
        play_res_y=1080,
        apply_effects=True,
    )

    assert r"\3c&HFFD742&" in exported


def test_effect_params_convert_every_css_color_including_palettes() -> None:
    assert _effect_params(
        {
            "color_a": "#42D7FF",
            "palette": ["#4FD8FF", "&HFF8BCE&"],
            "charset": "アイウエオ",
        }
    ) == {
        "color_a": "&HFFD742&",
        "palette": ["&HFFD84F&", "&HFF8BCE&"],
        "charset": "アイウエオ",
    }


def test_multiline_context_uses_real_grapheme_widths_and_skips_empty_line_layout() -> None:
    resolved = SimpleNamespace(font_path=Path("C:/Fonts/test.ttc"), face_index=2)

    def measure(text: str, path: str, size: float, *, face_index: int) -> tuple[float, ...]:
        assert path == str(resolved.font_path)
        assert size == 48
        assert face_index == 2
        return {"A": (18.0,), "B": (24.0,)}[text]

    with (
        mock.patch("songcut.subtitle_export.resolve_windows_font", return_value=resolved) as resolver,
        mock.patch("songcut.subtitle_export.measure_grapheme_widths", side_effect=measure),
    ):
        context = _effect_context(
            "A\n\nB",
            SubtitleStyle(font_size=48, alignment=7, margin_l=80, margin_v=70),
            play_res_x=1280,
            play_res_y=720,
        )

    resolver.assert_called_once_with(
        "Yu Gothic UI",
        bold=False,
        italic=False,
        text="AB",
    )
    assert context.glyph_widths is None
    assert context.line_layouts is not None
    assert [layout.glyph_widths for layout in context.line_layouts] == [(18.0,), (24.0,)]
    assert context.line_layouts[1].anchor_y - context.line_layouts[0].anchor_y == 104


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


def test_ffmpeg_runner_maps_progress_protocol_to_subtitle_range() -> None:
    process = mock.Mock()
    process.stdout = io.StringIO("out_time_us=5000000\nout_time_us=10000000\n")
    process.wait.return_value = 0
    progress: list[tuple[float, str]] = []

    with mock.patch("songcut.subtitle_export.subprocess.Popen", return_value=process):
        _run_ffmpeg_with_progress(
            ["ffmpeg", "-progress", "pipe:1"],
            duration=10.0,
            on_progress=lambda value, message: progress.append((value, message)),
            progress_start=0.15,
            progress_end=0.96,
        )

    assert [value for value, _message in progress] == pytest.approx([0.555, 0.96])
    assert all(message == "Burning subtitles into video." for _value, message in progress)


def test_subtitle_export_validates_created_video_and_duration(tmp_path: Path) -> None:
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    output_dir = tmp_path / "exports"
    lane = SubtitleLane(
        id="lyrics",
        name="Lyrics",
        style=SubtitleStyle(),
        segments=[SubtitleSegment(id="line", text="歌詞", start=0.0, end=1.0)],
    )

    def fake_runner(command: list[str], **_kwargs: object) -> None:
        Path(command[-1]).write_bytes(b"video")

    with (
        mock.patch("songcut.subtitle_export._require_ass_filter"),
        mock.patch("songcut.subtitle_export.probe_duration", side_effect=[10.0, 10.0]),
        mock.patch("songcut.subtitle_export.run_ffmpeg_stream", side_effect=fake_runner),
    ):
        result = export_subtitle_bundle(
            source,
            output_dir,
            [lane],
            play_res_x=320,
            play_res_y=180,
            ffmpeg_paths=FfmpegPaths(Path("ffmpeg"), Path("ffprobe")),
        )

    video = Path(result["video"])
    assert video.exists()
    assert video.stat().st_size > 0
    ass = Path(result["ass"])
    assert ass.exists()
    assert ass.read_text(encoding="utf-8-sig") == render_ass_document(
        [lane], play_res_x=320, play_res_y=180, apply_effects=True
    )



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

from __future__ import annotations

import base64
import math
import re
import tempfile
import unicodedata
import win_safesubprocess as subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence

from .ass_effects23 import Effect, EffectContext, Rect, decorate_dialogue
from .ffmpeg_tools import FfmpegPaths, find_ffmpeg, probe_duration
from .ffmpeg_process import run_ffmpeg_stream, run_ffmpeg_sync
from .guide import safe_filename_stem
from .lyrics_alignment import format_srt_timestamp


@dataclass(frozen=True)
class SubtitleStyle:
    font_name: str = "Yu Gothic UI"
    font_size: float = 48.0
    primary_color: str = "#FFFFFF"
    outline_color: str = "#000000"
    background_color: str = "#00000080"
    bold: bool = False
    italic: bool = False
    outline: float = 2.0
    shadow: float = 0.0
    alignment: int = 2
    margin_l: int = 60
    margin_r: int = 60
    margin_v: int = 54


@dataclass(frozen=True)
class SubtitleSegment:
    id: str
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class SubtitleEffect:
    name: str = Effect.CUT.value
    start_duration_ms: int = 300
    end_duration_ms: int = 300
    params: Mapping[str, str | int | float] | None = None


@dataclass(frozen=True)
class SubtitleLane:
    id: str
    name: str
    style: SubtitleStyle
    segments: list[SubtitleSegment]
    effect: SubtitleEffect = SubtitleEffect()


def subtitle_style_from_mapping(value: Mapping[str, object]) -> SubtitleStyle:
    style = SubtitleStyle(
        font_name=str(value.get("font_name") or "Yu Gothic UI"),
        font_size=_finite_float(value.get("font_size"), 48.0, minimum=1.0, maximum=400.0),
        primary_color=_css_color(value.get("primary_color"), "#FFFFFF"),
        outline_color=_css_color(value.get("outline_color"), "#000000"),
        background_color=_css_color(value.get("background_color"), "#00000080"),
        bold=bool(value.get("bold", False)),
        italic=bool(value.get("italic", False)),
        outline=_finite_float(value.get("outline"), 2.0, minimum=0.0, maximum=30.0),
        shadow=_finite_float(value.get("shadow"), 0.0, minimum=0.0, maximum=30.0),
        alignment=int(value.get("alignment") or 2),
        margin_l=min(4000, max(0, int(value.get("margin_l") or 0))),
        margin_r=min(4000, max(0, int(value.get("margin_r") or 0))),
        margin_v=min(4000, max(0, int(value.get("margin_v") or 0))),
    )
    if style.alignment not in range(1, 10):
        raise ValueError("subtitle alignment must be from 1 through 9")
    return style


def render_lane_srt(segments: Sequence[SubtitleSegment]) -> str:
    blocks = [
        f"{index}\n{format_srt_timestamp(segment.start)} --> {format_srt_timestamp(segment.end)}\n{segment.text}"
        for index, segment in enumerate(sorted(segments, key=lambda item: (item.start, item.end)), start=1)
    ]
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def render_srt_style_document(
    style: SubtitleStyle,
    *,
    play_res_x: int,
    play_res_y: int,
) -> str:
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {max(1, int(play_res_x))}\n"
        f"PlayResY: {max(1, int(play_res_y))}\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{_ass_field(style.font_name)},{style.font_size:g},{_ass_color(style.primary_color)},"
        f"&H000000FF,{_ass_color(style.outline_color)},{_ass_color(style.background_color)},"
        f"{-1 if style.bold else 0},{-1 if style.italic else 0},0,0,100,100,0,0,1,"
        f"{style.outline:g},{style.shadow:g},{style.alignment},{style.margin_l},{style.margin_r},"
        f"{style.margin_v},1\n"
    )


def render_ass_document(
    lanes: Sequence[SubtitleLane],
    *,
    play_res_x: int,
    play_res_y: int,
    apply_effects: bool = False,
) -> str:
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {max(1, int(play_res_x))}",
        f"PlayResY: {max(1, int(play_res_y))}",
        "ScaledBorderAndShadow: yes",
        "WrapStyle: 2",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ]
    style_names: dict[str, str] = {}
    for index, lane in enumerate(lanes, start=1):
        name = f"Lane{index}"
        style_names[lane.id] = name
        style = lane.style
        lines.append(
            f"Style: {name},{_ass_field(style.font_name)},{style.font_size:g},{_ass_color(style.primary_color)},"
            f"&H000000FF,{_ass_color(style.outline_color)},{_ass_color(style.background_color)},"
            f"{-1 if style.bold else 0},{-1 if style.italic else 0},0,0,100,100,0,0,1,"
            f"{style.outline:g},{style.shadow:g},{style.alignment},{style.margin_l},{style.margin_r},"
            f"{style.margin_v},1"
        )
    lines.extend(
        [
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
    )
    for layer, lane in enumerate(lanes):
        for segment in sorted(lane.segments, key=lambda item: (item.start, item.end)):
            dialogue = (
                f"Dialogue: {layer * 1000 if apply_effects else layer},"
                f"{_ass_timestamp(segment.start)},{_ass_timestamp(segment.end)},"
                f"{style_names[lane.id]},,0,0,0,,{_ass_text(segment.text)}"
            )
            if apply_effects and lane.effect.name != Effect.CUT.value:
                start_ms, end_ms = _fit_effect_durations(
                    lane.effect.start_duration_ms,
                    lane.effect.end_duration_ms,
                    segment.end - segment.start,
                )
                params = _effect_params(lane.effect.params)
                lines.extend(
                    decorate_dialogue(
                        dialogue,
                        start_ms,
                        end_ms,
                        lane.effect.name,
                        params=params,
                        context=_effect_context(
                            segment.text,
                            lane.style,
                            play_res_x=play_res_x,
                            play_res_y=play_res_y,
                        ),
                    )
                )
            else:
                lines.append(dialogue)
    return "\n".join(lines) + "\n"


def render_subtitle_png_base64(
    text: str,
    style: SubtitleStyle,
    *,
    play_res_x: int,
    play_res_y: int,
    ffmpeg_paths: FfmpegPaths | None = None,
    verify_ass_filter: bool = True,
) -> str:
    width = max(1, int(play_res_x))
    height = max(1, int(play_res_y))
    paths = ffmpeg_paths or find_ffmpeg()
    if verify_ass_filter:
        _require_ass_filter(paths.ffmpeg)
    lane = SubtitleLane(
        id="preview",
        name="Preview",
        style=style,
        segments=[SubtitleSegment(id="preview", text=text, start=0.0, end=10.0)],
    )
    with tempfile.TemporaryDirectory(prefix="songcut-subtitle-frame-") as temporary_directory:
        root = Path(temporary_directory)
        ass_path = root / "subtitle.ass"
        png_path = root / "subtitle.png"
        ass_path.write_text(
            render_ass_document([lane], play_res_x=width, play_res_y=height),
            encoding="utf-8-sig",
            newline="\n",
        )
        filter_graph = f"format=rgba,{_ass_filter(ass_path)}:alpha=1"
        command = [
            str(paths.ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=black@0.0:s={width}x{height}:r=1,format=rgba",
            "-vf",
            filter_graph,
            "-frames:v",
            "1",
            "-c:v",
            "png",
            "-pix_fmt",
            "rgba",
            "-update",
            "1",
            str(png_path),
        ]
        run_ffmpeg_sync(command, process_module=subprocess)
        if not png_path.exists() or png_path.stat().st_size <= 0:
            raise RuntimeError("subtitle frame render did not create a PNG")
        return base64.b64encode(png_path.read_bytes()).decode("ascii")


def export_subtitle_bundle(
    source: Path,
    output_dir: Path,
    lanes: Sequence[SubtitleLane],
    *,
    play_res_x: int,
    play_res_y: int,
    ffmpeg_paths: FfmpegPaths | None = None,
    on_progress: Callable[[float, str], None] | None = None,
) -> dict[str, object]:
    active_lanes = [lane for lane in lanes if lane.segments]
    if not active_lanes:
        raise ValueError("at least one non-empty subtitle lane is required")
    paths = ffmpeg_paths or find_ffmpeg()
    _require_ass_filter(paths.ffmpeg)
    expected_duration = probe_duration(paths.ffprobe, source)
    output_dir.mkdir(parents=True, exist_ok=True)
    source_stem = safe_filename_stem(source.stem, fallback="video")
    sidecars: list[dict[str, str]] = []
    if on_progress:
        on_progress(0.05, "Writing subtitle files.")
    for index, lane in enumerate(active_lanes, start=1):
        srt_path = output_dir / f"{source_stem}-sub-{index}.srt"
        style_path = Path(f"{srt_path}.style")
        srt_path.write_text(render_lane_srt(lane.segments), encoding="utf-8-sig", newline="\n")
        style_path.write_text(
            render_srt_style_document(lane.style, play_res_x=play_res_x, play_res_y=play_res_y),
            encoding="utf-8-sig",
            newline="\n",
        )
        sidecars.append({"lane_id": lane.id, "srt": str(srt_path), "style": str(style_path)})

    target = output_dir / f"{source_stem}-subtitled.mp4"
    with tempfile.TemporaryDirectory(prefix="songcut-subtitle-") as temporary_directory:
        ass_path = Path(temporary_directory) / "subtitles.ass"
        ass_path.write_text(
            render_ass_document(
                active_lanes,
                play_res_x=play_res_x,
                play_res_y=play_res_y,
                apply_effects=True,
            ),
            encoding="utf-8-sig",
            newline="\n",
        )
        if on_progress:
            on_progress(0.15, "Burning subtitles into video.")
        command = [
            str(paths.ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-progress",
            "pipe:1",
            "-nostats",
            "-i",
            str(source),
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-vf",
            _ass_filter(ass_path),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            str(target),
        ]
        _run_ffmpeg_with_progress(
            command,
            duration=expected_duration,
            on_progress=on_progress,
            progress_start=0.15,
            progress_end=0.96,
        )
    if not target.exists() or target.stat().st_size <= 0:
        raise RuntimeError("subtitle export did not create a video")
    actual_duration = probe_duration(paths.ffprobe, target)
    if abs(expected_duration - actual_duration) > max(0.25, expected_duration * 0.002):
        raise RuntimeError("subtitle export duration does not match the source")
    if on_progress:
        on_progress(1.0, "Subtitle export complete.")
    return {"video": str(target), "sidecars": sidecars, "output_dir": str(output_dir)}


def _run_ffmpeg_with_progress(
    command: Sequence[str],
    *,
    duration: float,
    on_progress: Callable[[float, str], None] | None,
    progress_start: float,
    progress_end: float,
) -> None:
    def handle_line(line: str) -> None:
        seconds = _ffmpeg_progress_seconds(line)
        if seconds is None or duration <= 0 or on_progress is None:
            return
        ratio = min(1.0, max(0.0, seconds / duration))
        progress = progress_start + ratio * (progress_end - progress_start)
        on_progress(progress, "Burning subtitles into video.")

    run_ffmpeg_stream(
        command,
        on_line=handle_line,
        process_module=subprocess,
    )


def _ffmpeg_progress_seconds(line: str) -> float | None:
    if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
        try:
            # Despite its historical name, out_time_ms is also expressed in
            # microseconds by ffmpeg's progress protocol.
            return int(line.split("=", 1)[1]) / 1_000_000
        except ValueError:
            return None
    if line.startswith("out_time="):
        try:
            hours, minutes, seconds = line.split("=", 1)[1].split(":")
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
        except (ValueError, TypeError):
            return None
    return None


def _require_ass_filter(ffmpeg: Path) -> None:
    result = run_ffmpeg_sync([str(ffmpeg), "-hide_banner", "-filters"], process_module=subprocess)
    if not any(" ass " in line for line in result.stdout.splitlines()):
        raise RuntimeError("The selected FFmpeg build does not provide the ass subtitle filter.")


def _ass_filter(path: Path) -> str:
    escaped = str(path.resolve()).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")
    return f"ass=filename='{escaped}'"


def _ass_timestamp(seconds: float) -> str:
    centiseconds = max(0, int(round(float(seconds) * 100)))
    hours, remainder = divmod(centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    whole_seconds, centiseconds = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{whole_seconds:02d}.{centiseconds:02d}"


def _ass_text(value: str) -> str:
    return (
        value.replace("\\", r"\\")
        .replace("{", r"\{")
        .replace("}", r"\}")
        .replace("\r\n", r"\N")
        .replace("\r", r"\N")
        .replace("\n", r"\N")
    )


def _ass_field(value: str) -> str:
    return value.replace(",", " ").replace("\r", " ").replace("\n", " ").strip() or "Yu Gothic UI"


def _ass_color(value: str) -> str:
    normalized = _css_color(value, "#FFFFFF").lstrip("#")
    if len(normalized) == 6:
        red, green, blue, alpha = normalized[0:2], normalized[2:4], normalized[4:6], "00"
    else:
        red, green, blue, alpha = normalized[0:2], normalized[2:4], normalized[4:6], normalized[6:8]
    return f"&H{alpha}{blue}{green}{red}".upper()


def _effect_params(
    params: Mapping[str, str | int | float] | None,
) -> dict[str, str | int | float]:
    result = dict(params or {})
    color = result.get("color")
    if isinstance(color, str):
        result["color"] = _ass_bgr_color(color)
    return result


def _ass_bgr_color(value: str) -> str:
    text = value.strip().upper()
    css_match = re.fullmatch(r"#([0-9A-F]{6})(?:[0-9A-F]{2})?", text)
    if css_match:
        red, green, blue = (
            css_match.group(1)[0:2],
            css_match.group(1)[2:4],
            css_match.group(1)[4:6],
        )
        return f"&H{blue}{green}{red}&"
    ass_match = re.fullmatch(r"&H([0-9A-F]{6}|[0-9A-F]{8})&?", text)
    if ass_match:
        # Colour override tags do not accept the leading ASS alpha byte.
        return f"&H{ass_match.group(1)[-6:]}&"
    return value


def _fit_effect_durations(start_ms: int, end_ms: int, duration_seconds: float) -> tuple[int, int]:
    start = max(0, int(start_ms))
    end = max(0, int(end_ms))
    # ASS timestamps have centisecond precision. Flooring here guarantees the
    # fitted transition never exceeds the rounded Dialogue duration.
    available = max(0, int(math.floor(duration_seconds * 100))) * 10
    total = start + end
    if total <= available or total == 0:
        return start, end
    fitted_start = int(round(available * start / total))
    return fitted_start, available - fitted_start


def _effect_context(
    text: str,
    style: SubtitleStyle,
    *,
    play_res_x: int,
    play_res_y: int,
) -> EffectContext:
    width = max(1, int(play_res_x))
    height = max(1, int(play_res_y))
    column = (style.alignment - 1) % 3
    row = (style.alignment - 1) // 3
    anchor_x = (style.margin_l, width // 2, width - style.margin_r)[column]
    anchor_y = (height - style.margin_v, height // 2, style.margin_v)[row]
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n") or [""]
    glyph_units = max(sum(_glyph_width(character) for character in line) for line in lines)
    padding = max(2.0, style.outline + style.shadow)
    box_width = min(width, max(1, int(math.ceil(glyph_units * style.font_size * 0.56 + padding * 2))))
    box_height = min(
        height,
        max(1, int(math.ceil(len(lines) * style.font_size * 1.28 + padding * 2))),
    )
    if column == 0:
        x1, x2 = anchor_x, anchor_x + box_width
    elif column == 1:
        x1, x2 = anchor_x - box_width // 2, anchor_x + math.ceil(box_width / 2)
    else:
        x1, x2 = anchor_x - box_width, anchor_x
    if row == 0:
        y1, y2 = anchor_y - box_height, anchor_y
    elif row == 1:
        y1, y2 = anchor_y - box_height // 2, anchor_y + math.ceil(box_height / 2)
    else:
        y1, y2 = anchor_y, anchor_y + box_height
    x1, x2 = _clamp_box(x1, x2, width)
    y1, y2 = _clamp_box(y1, y2, height)
    return EffectContext(
        play_res_x=width,
        play_res_y=height,
        anchor_x=max(0, min(width, int(anchor_x))),
        anchor_y=max(0, min(height, int(anchor_y))),
        text_box=Rect(x1, y1, x2, y2),
    )


def _glyph_width(character: str) -> float:
    if unicodedata.combining(character):
        return 0.0
    return 2.0 if unicodedata.east_asian_width(character) in {"W", "F"} else 1.0


def _clamp_box(start: int | float, end: int | float, limit: int) -> tuple[int, int]:
    size = min(limit, max(1, int(math.ceil(end - start))))
    bounded_start = max(0, min(limit - size, int(math.floor(start))))
    return bounded_start, bounded_start + size


def _css_color(value: object, fallback: str) -> str:
    text = str(value or "").strip().upper()
    if len(text) in {7, 9} and text.startswith("#"):
        try:
            int(text[1:], 16)
            return text
        except ValueError:
            pass
    return fallback


def _finite_float(
    value: object,
    fallback: float,
    *,
    minimum: float,
    maximum: float | None = None,
) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(number):
        return fallback
    return max(minimum, number) if maximum is None else min(maximum, max(minimum, number))

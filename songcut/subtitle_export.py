from __future__ import annotations

import base64
from functools import lru_cache
import math
import re
import tempfile
import win_safesubprocess as subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from ass_lyric_effects import (
    CONTEXT_REQUIRED_EFFECTS,
    Effect,
    EffectContext,
    Rect,
    VisualLineLayout,
    decorate_dialogue,
    measure_grapheme_widths,
    split_graphemes,
)
from .ffmpeg_tools import FfmpegPaths, find_ffmpeg, probe_duration
from .ffmpeg_process import run_ffmpeg_stream, run_ffmpeg_sync
from .guide import safe_filename_stem
from .lyrics_alignment import format_srt_timestamp
from .windows_font_resolver import resolve_windows_font


DEFAULT_EFFECT_DURATION_MS = 750


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
    style_override: SubtitleStyle | None = None
    effect_override: SubtitleEffect | None = None


@dataclass(frozen=True)
class SubtitleEffect:
    name: str = Effect.CUT.value
    start_duration_ms: int = DEFAULT_EFFECT_DURATION_MS
    end_duration_ms: int = DEFAULT_EFFECT_DURATION_MS
    params: Mapping[str, Any] | None = None


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
    # ASS events reference named styles, so assign one stable name to every
    # effective style (lane defaults and segment overrides alike).  Names are
    # allocated by the deterministic lane/segment traversal order and reused
    # when two segments resolve to the same style.
    style_names: dict[tuple[object, ...], str] = {}
    style_definitions: list[tuple[str, SubtitleStyle]] = []
    for index, lane in enumerate(lanes, start=1):
        _register_style(style_names, style_definitions, lane.style, f"Lane{index}")
        for segment_index, segment in enumerate(
            sorted(lane.segments, key=lambda item: (item.start, item.end)),
            start=1,
        ):
            style = _effective_style(lane, segment)
            _register_style(style_names, style_definitions, style, f"Lane{index}Override{segment_index}")
    lines.extend(_ass_style_line(name, style) for name, style in style_definitions)
    lines.extend(
        [
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
    )
    for layer, lane in enumerate(lanes):
        for segment in sorted(lane.segments, key=lambda item: (item.start, item.end)):
            style = _effective_style(lane, segment)
            effect = _effective_effect(lane, segment)
            dialogue = (
                f"Dialogue: {layer * 1000 if apply_effects else layer},"
                f"{_ass_timestamp(segment.start)},{_ass_timestamp(segment.end)},"
                f"{style_names[_style_key(style)]},,0,0,0,,{_ass_text(segment.text)}"
            )
            selected_effect = Effect(effect.name)
            if apply_effects and selected_effect is not Effect.CUT:
                start_ms, end_ms = _fit_effect_durations(
                    effect.start_duration_ms,
                    effect.end_duration_ms,
                    segment.end - segment.start,
                )
                params = _effect_params(effect.params)
                context = (
                    _effect_context(
                        segment.text,
                        style,
                        play_res_x=play_res_x,
                        play_res_y=play_res_y,
                    )
                    if selected_effect in CONTEXT_REQUIRED_EFFECTS
                    else None
                )
                lines.extend(
                    decorate_dialogue(
                        dialogue,
                        start_ms,
                        end_ms,
                        selected_effect,
                        params=params,
                        context=context,
                    )
                )
            else:
                lines.append(dialogue)
    return "\n".join(lines) + "\n"


def _effective_style(lane: SubtitleLane, segment: SubtitleSegment) -> SubtitleStyle:
    return segment.style_override or lane.style


def _effective_effect(lane: SubtitleLane, segment: SubtitleSegment) -> SubtitleEffect:
    return segment.effect_override or lane.effect


def _style_key(style: SubtitleStyle) -> tuple[object, ...]:
    return (
        style.font_name,
        style.font_size,
        style.primary_color,
        style.outline_color,
        style.background_color,
        style.bold,
        style.italic,
        style.outline,
        style.shadow,
        style.alignment,
        style.margin_l,
        style.margin_r,
        style.margin_v,
    )


def _register_style(
    names: dict[tuple[object, ...], str],
    definitions: list[tuple[str, SubtitleStyle]],
    style: SubtitleStyle,
    preferred_name: str,
) -> str:
    key = _style_key(style)
    name = names.get(key)
    if name is None:
        name = preferred_name
        names[key] = name
        definitions.append((name, style))
    return name


def _ass_style_line(name: str, style: SubtitleStyle) -> str:
    return (
        f"Style: {name},{_ass_field(style.font_name)},{style.font_size:g},{_ass_color(style.primary_color)},"
        f"&H000000FF,{_ass_color(style.outline_color)},{_ass_color(style.background_color)},"
        f"{-1 if style.bold else 0},{-1 if style.italic else 0},0,0,100,100,0,0,1,"
        f"{style.outline:g},{style.shadow:g},{style.alignment},{style.margin_l},{style.margin_r},"
        f"{style.margin_v},1"
    )


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
    ass_path = output_dir / f"{source_stem}-subtitles.ass"
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
    return {
        "video": str(target),
        "ass": str(ass_path),
        "sidecars": sidecars,
        "output_dir": str(output_dir),
    }


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
    params: Mapping[str, Any] | None,
) -> dict[str, Any]:
    return {name: _effect_param_value(value) for name, value in (params or {}).items()}


def _effect_param_value(value: Any) -> Any:
    if isinstance(value, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?", value.strip()):
        return _ass_bgr_color(value)
    if isinstance(value, (list, tuple)):
        return [_effect_param_value(item) for item in value]
    return value


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
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n") or [""]
    visible_text = "".join(lines)
    if not split_graphemes(visible_text):
        raise ValueError("subtitle effect text must contain at least one visible grapheme")
    resolved = resolve_windows_font(
        style.font_name,
        bold=style.bold,
        italic=style.italic,
        text=visible_text,
    )
    measured = [
        _measure_line(line, str(resolved.font_path), style.font_size, resolved.face_index)
        if line
        else ()
        for line in lines
    ]
    left_pad = max(0.0, style.outline)
    top_pad = max(0.0, style.outline)
    right_pad = max(0.0, style.outline + style.shadow)
    bottom_pad = max(0.0, style.outline + style.shadow)
    line_height = style.font_size + top_pad + bottom_pad
    block_height = line_height * len(lines)
    anchor_x = float((style.margin_l, width / 2, width - style.margin_r)[column])
    anchor_y = float((height - style.margin_v, height / 2, style.margin_v)[row])
    block_y1, block_y2 = _vertical_extent(anchor_y, block_height, row)
    line_layouts: list[VisualLineLayout] = []
    block_x1 = float(width)
    block_x2 = 0.0
    for line_index, glyph_widths in enumerate(measured):
        if not glyph_widths:
            continue
        line_width = sum(glyph_widths) + left_pad + right_pad
        line_x1, line_x2 = _aligned_extent(anchor_x, line_width, column)
        line_y1 = block_y1 + line_index * line_height
        line_y2 = line_y1 + line_height
        rect = _inside_play_res_rect(line_x1, line_y1, line_x2, line_y2, width, height)
        line_layouts.append(
            VisualLineLayout(
                anchor_x=round((rect.x1 + rect.x2) / 2),
                anchor_y=round((rect.y1 + rect.y2) / 2),
                text_box=rect,
                glyph_widths=tuple(glyph_widths),
            )
        )
        block_x1 = min(block_x1, rect.x1)
        block_x2 = max(block_x2, rect.x2)
    if not line_layouts:
        raise ValueError("subtitle effect text must contain a non-empty visual line")
    block_rect = _inside_play_res_rect(
        block_x1,
        block_y1,
        block_x2,
        block_y2,
        width,
        height,
    )
    single_line_widths = line_layouts[0].glyph_widths if len(lines) == 1 else None
    return EffectContext(
        play_res_x=width,
        play_res_y=height,
        anchor_x=round((block_rect.x1 + block_rect.x2) / 2),
        anchor_y=round((block_rect.y1 + block_rect.y2) / 2),
        text_box=block_rect,
        glyph_widths=single_line_widths,
        line_layouts=tuple(line_layouts) if len(lines) > 1 else None,
    )


@lru_cache(maxsize=2048)
def _measure_line(
    text: str,
    font_path: str,
    font_size: float,
    face_index: int,
) -> tuple[float, ...]:
    widths = measure_grapheme_widths(text, font_path, font_size, face_index=face_index)
    if len(widths) != len(split_graphemes(text)):
        raise ValueError("font measurement did not return one width per grapheme")
    if not widths or sum(widths) <= 0:
        raise ValueError("subtitle visual line has no positive rendered width")
    return widths


def _aligned_extent(anchor: float, size: float, alignment_index: int) -> tuple[float, float]:
    if alignment_index == 0:
        return anchor, anchor + size
    if alignment_index == 1:
        return anchor - size / 2, anchor + size / 2
    return anchor - size, anchor


def _vertical_extent(anchor: float, size: float, alignment_row: int) -> tuple[float, float]:
    if alignment_row == 0:
        return anchor - size, anchor
    if alignment_row == 1:
        return anchor - size / 2, anchor + size / 2
    return anchor, anchor + size


def _inside_play_res_rect(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    width: int,
    height: int,
) -> Rect:
    left = math.floor(x1)
    top = math.floor(y1)
    right = math.ceil(x2)
    bottom = math.ceil(y2)
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise ValueError(
            "rendered subtitle bounds fall outside PlayRes; reduce font size or margins"
        )
    return Rect(left, top, right, bottom)


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

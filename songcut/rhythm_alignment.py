from __future__ import annotations

import json
import math
import statistics
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence

import numpy as np

from .ffmpeg_tools import ffprobe_json, find_ffmpeg, probe_duration
from .lyrics_alignment import AlignedLyricsLine, LyricsAlignmentResult, generate_lyrics_srt, render_srt
from .transcription import extract_segment_wav, read_wav_mono_16k


@dataclass(frozen=True)
class RhythmGridPoint:
    time: float
    grid: str
    attraction_radius: float
    grid_penalty: float


@dataclass(frozen=True)
class TimingAdjustment:
    index: int
    original: float
    adjusted: float
    shift_ms: int
    grid: str
    score: float


@dataclass(frozen=True)
class RhythmAdjustmentResult:
    tempo_bpm: float
    beat_times: list[float]
    lines: list[AlignedLyricsLine]
    adjustments: list[TimingAdjustment]


@dataclass(frozen=True)
class ConfidenceStatistics:
    count: int
    minimum: float
    maximum: float
    mean: float
    median: float
    q1: float
    q3: float
    lower_outlier_bound: float
    low_outlier_indexes: list[int]


_GRID_SPEC = {
    "beat": (0.120, 0.00),
    "half-beat": (0.080, 0.15),
    "quarter-beat": (0.050, 0.35),
}
_GRID_PRIORITY = {"beat": 0, "half-beat": 1, "quarter-beat": 2}


def render_srt_style(*, alignment: int, play_res_x: int = 1920, play_res_y: int = 1080) -> str:
    """Render a DirectVobSub-compatible .srt.style sidecar using ASS V4+ fields."""
    if alignment not in range(1, 10):
        raise ValueError("alignment must be an ASS numpad position from 1 through 9.")
    if play_res_x <= 0 or play_res_y <= 0:
        raise ValueError("PlayRes dimensions must be positive.")
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {play_res_x}\n"
        f"PlayResY: {play_res_y}\n"
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,Yu Gothic UI,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
        f"0,0,0,0,100,100,0,0,1,2,0,{alignment},60,60,54,1\n"
    )


def write_srt_style(
    srt_path: Path, *, alignment: int, play_res_x: int = 1920, play_res_y: int = 1080
) -> Path:
    style_path = Path(f"{srt_path}.style")
    style_path.write_text(
        render_srt_style(alignment=alignment, play_res_x=play_res_x, play_res_y=play_res_y),
        encoding="utf-8-sig",
        newline="\n",
    )
    return style_path


def _probe_video_resolution(source: Path) -> tuple[int, int]:
    ffprobe = find_ffmpeg().ffprobe
    data = ffprobe_json(
        ffprobe,
        source,
        ["-select_streams", "v:0", "-show_entries", "stream=width,height"],
    )
    streams = data.get("streams", [])
    if not streams:
        return 1920, 1080
    width = int(streams[0].get("width") or 1920)
    height = int(streams[0].get("height") or 1080)
    return max(1, width), max(1, height)


def detect_beat_times(source: Path) -> tuple[float, list[float], float]:
    """Decode media and detect beat timestamps with librosa's dynamic-programming tracker."""
    try:
        import librosa  # type: ignore
    except ImportError as exc:
        raise RuntimeError("librosa is required for rhythm-adjusted lyrics SRT generation.") from exc

    ffmpeg_paths = find_ffmpeg()
    duration = probe_duration(ffmpeg_paths.ffprobe, source)
    with tempfile.TemporaryDirectory(prefix="songcut-beats-") as temporary_directory:
        wav_path = Path(temporary_directory) / "source.wav"
        extract_segment_wav(ffmpeg_paths.ffmpeg, source, wav_path, start=0.0, end=duration)
        audio = read_wav_mono_16k(wav_path)
        tempo, beats = librosa.beat.beat_track(y=audio, sr=16_000, units="time")

    tempo_values = np.asarray(tempo, dtype=np.float64).reshape(-1)
    tempo_bpm = float(tempo_values[0]) if tempo_values.size else 0.0
    beat_times = [round(float(value), 6) for value in np.asarray(beats).reshape(-1) if math.isfinite(float(value))]
    return tempo_bpm, beat_times, duration


def build_rhythm_grid(beat_times: Sequence[float]) -> list[RhythmGridPoint]:
    """Build beat, half-beat, and quarter-beat points between adjacent detected beats."""
    beats = sorted({float(value) for value in beat_times if math.isfinite(float(value)) and float(value) >= 0})
    if not beats:
        return []

    candidates: dict[float, RhythmGridPoint] = {}

    def add(time: float, grid: str) -> None:
        radius, penalty = _GRID_SPEC[grid]
        key = round(time, 6)
        point = RhythmGridPoint(key, grid, radius, penalty)
        previous = candidates.get(key)
        if previous is None or _GRID_PRIORITY[grid] < _GRID_PRIORITY[previous.grid]:
            candidates[key] = point

    for left, right in zip(beats, beats[1:]):
        add(left, "beat")
        interval = right - left
        if interval <= 0:
            continue
        add(left + interval * 0.25, "quarter-beat")
        add(left + interval * 0.50, "half-beat")
        add(left + interval * 0.75, "quarter-beat")
    add(beats[-1], "beat")
    return sorted(candidates.values(), key=lambda point: point.time)


def build_extended_rhythm_grid(
    beat_times: Sequence[float],
    *,
    media_duration: float,
    edge_interval_count: int = 4,
) -> list[RhythmGridPoint]:
    """Build a quarter-beat grid and extrapolate it to both media edges."""
    beats = sorted({float(value) for value in beat_times if math.isfinite(float(value)) and float(value) >= 0})
    duration = max(0.0, float(media_duration))
    if len(beats) < 2 or duration <= 0:
        return build_rhythm_grid(beats)

    intervals = [right - left for left, right in zip(beats, beats[1:]) if right > left]
    if not intervals:
        return build_rhythm_grid(beats)
    count = max(1, int(edge_interval_count))
    leading_interval = statistics.median(intervals[:count])
    trailing_interval = statistics.median(intervals[-count:])
    extended = list(beats)
    cursor = beats[0]
    while cursor > 0:
        cursor -= leading_interval
        extended.append(max(0.0, cursor))
        if cursor <= 0:
            break
    cursor = beats[-1]
    while cursor < duration:
        cursor += trailing_interval
        extended.append(min(duration, cursor))
        if cursor >= duration:
            break
    return [point for point in build_rhythm_grid(extended) if point.time <= duration + 1e-9]


def confidence_statistics(lines: Sequence[AlignedLyricsLine]) -> ConfidenceStatistics:
    """Return Tukey lower-outlier statistics for line confidence values."""
    values = [max(0.0, min(1.0, float(line.confidence))) for line in lines]
    if not values:
        return ConfidenceStatistics(0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, [])
    ordered = sorted(values)
    q1 = _linear_quantile(ordered, 0.25)
    q3 = _linear_quantile(ordered, 0.75)
    lower_bound = max(0.0, q1 - 1.5 * (q3 - q1))
    outliers = [line.index for line, value in zip(lines, values, strict=True) if value < lower_bound - 1e-12]
    return ConfidenceStatistics(
        count=len(values),
        minimum=round(min(values), 3),
        maximum=round(max(values), 3),
        mean=round(statistics.fmean(values), 3),
        median=round(statistics.median(values), 3),
        q1=round(q1, 3),
        q3=round(q3, 3),
        lower_outlier_bound=round(lower_bound, 3),
        low_outlier_indexes=outliers,
    )


def _linear_quantile(ordered: Sequence[float], fraction: float) -> float:
    if len(ordered) == 1:
        return float(ordered[0])
    position = (len(ordered) - 1) * fraction
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return float(ordered[lower])
    weight = position - lower
    return float(ordered[lower]) * (1.0 - weight) + float(ordered[upper]) * weight


def adjust_lines_to_rhythm(
    lines: Sequence[AlignedLyricsLine],
    beat_times: Sequence[float],
    *,
    tempo_bpm: float = 0.0,
    singing_starts: Sequence[float | None] | None = None,
    minimum_display_lead: float = 0.0,
) -> RhythmAdjustmentResult:
    """Snap subtitle starts to the strongest nearby rhythm point while preserving safe ordering."""
    if singing_starts is not None and len(singing_starts) != len(lines):
        raise ValueError("singing_starts must contain one value per subtitle line.")

    grid = build_rhythm_grid(beat_times)
    adjusted_starts: list[float] = []
    adjustments: list[TimingAdjustment] = []
    for position, line in enumerate(lines):
        original = float(line.start)
        best_time = original
        best_grid = "original"
        best_score = 1.0
        next_original = float(lines[position + 1].start) if position + 1 < len(lines) else math.inf
        previous_adjusted = adjusted_starts[-1] if adjusted_starts else -math.inf
        singing_start = singing_starts[position] if singing_starts is not None else None

        for point in grid:
            distance = abs(point.time - original)
            if distance > point.attraction_radius + 1e-9:
                continue
            if point.time <= previous_adjusted + 0.001 or point.time >= next_original - 0.001:
                continue
            if point.time >= line.end - 0.001:
                continue
            if singing_start is not None and point.time > float(singing_start) - minimum_display_lead:
                continue
            score = distance / point.attraction_radius + point.grid_penalty
            if score < best_score - 1e-12 or (
                math.isclose(score, best_score) and _GRID_PRIORITY.get(point.grid, 99) < _GRID_PRIORITY.get(best_grid, 99)
            ):
                best_time = point.time
                best_grid = point.grid
                best_score = score

        adjusted_starts.append(best_time)
        adjustments.append(
            TimingAdjustment(
                index=line.index,
                original=round(original, 3),
                adjusted=round(best_time, 3),
                shift_ms=int(round((best_time - original) * 1000)),
                grid=best_grid,
                score=round(best_score, 4),
            )
        )

    adjusted_lines: list[AlignedLyricsLine] = []
    for position, line in enumerate(lines):
        start = adjusted_starts[position]
        end = float(line.end)
        if position + 1 < len(lines) and end >= adjusted_starts[position + 1]:
            end = adjusted_starts[position + 1] - 0.020
        if end <= start:
            start = float(line.start)
            end = max(start + 0.001, min(float(line.end), adjusted_starts[position + 1] - 0.001)) if position + 1 < len(lines) else float(line.end)
        adjusted_lines.append(
            AlignedLyricsLine(
                index=line.index,
                text=line.text,
                start=round(start, 3),
                end=round(end, 3),
                confidence=line.confidence,
                source=line.source,
                matched_characters=line.matched_characters,
                exact_characters=line.exact_characters,
                total_characters=line.total_characters,
            )
        )

    return RhythmAdjustmentResult(
        tempo_bpm=round(float(tempo_bpm), 3),
        beat_times=[round(float(value), 6) for value in beat_times],
        lines=adjusted_lines,
        adjustments=adjustments,
    )


def generate_lyrics_srt_variants(
    source: Path,
    lyrics_path: Path,
    original_output_path: Path,
    rhythm_output_path: Path,
    *,
    alignment_diagnostics_path: Path | None = None,
    rhythm_diagnostics_path: Path | None = None,
    model_dir: Path | None = None,
    model_key: str = "small",
    device: str = "cpu",
    language: str = "ja",
) -> tuple[LyricsAlignmentResult, RhythmAdjustmentResult]:
    """Generate original and beat-adjusted SRT variants from one Whisper alignment run."""
    alignment = generate_lyrics_srt(
        source,
        lyrics_path,
        original_output_path,
        diagnostics_path=alignment_diagnostics_path,
        model_dir=model_dir,
        model_key=model_key,
        device=device,
        language=language,
    )
    tempo_bpm, beat_times, _duration = detect_beat_times(source)
    rhythm = adjust_lines_to_rhythm(alignment.lines, beat_times, tempo_bpm=tempo_bpm)
    rhythm_output_path.parent.mkdir(parents=True, exist_ok=True)
    rhythm_output_path.write_text(render_srt(rhythm.lines), encoding="utf-8-sig", newline="\n")
    play_res_x, play_res_y = _probe_video_resolution(source)
    write_srt_style(original_output_path, alignment=2, play_res_x=play_res_x, play_res_y=play_res_y)
    write_srt_style(rhythm_output_path, alignment=8, play_res_x=play_res_x, play_res_y=play_res_y)

    if rhythm_diagnostics_path is not None:
        rhythm_diagnostics_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "source": str(source),
            "lyrics": str(lyrics_path),
            "original_output": str(original_output_path),
            "rhythm_output": str(rhythm_output_path),
            "original_style": str(Path(f"{original_output_path}.style")),
            "rhythm_style": str(Path(f"{rhythm_output_path}.style")),
            "tempo_bpm": rhythm.tempo_bpm,
            "beat_times": rhythm.beat_times,
            "adjustments": [asdict(adjustment) for adjustment in rhythm.adjustments],
            "lines": [asdict(line) for line in rhythm.lines],
        }
        rhythm_diagnostics_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return alignment, rhythm

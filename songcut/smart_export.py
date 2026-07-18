from __future__ import annotations

import shutil
import tempfile
import win_safesubprocess as subprocess
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from .ffmpeg_tools import ffprobe_json


MIN_SPAN_SECONDS = 0.001
DEFAULT_SOURCE_VIDEO_BITRATE = 2_000_000
MIN_REENCODE_BITRATE = 300_000
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


@dataclass(frozen=True)
class SourceMediaInfo:
    format_name: str
    duration: float
    size: int | None
    video_codec: str
    video_bitrate: int
    audio_codec: str | None
    audio_bitrate: int
    has_audio: bool


@dataclass(frozen=True)
class RenderProfile:
    container_family: str
    output_suffix: str
    video_encoder: str
    audio_encoder: str
    audio_bitrate: str
    smart_copy: bool
    fallback_reason: str | None


@dataclass(frozen=True)
class SmartRenderSpan:
    mode: str
    start: float
    end: float


@dataclass(frozen=True)
class SmartRenderPlan:
    start: float
    end: float
    output_suffix: str
    container_family: str
    video_codec: str
    video_encoder: str
    audio_encoder: str
    audio_bitrate: str
    source_video_bitrate: int
    reencode_bitrate: int
    has_audio: bool
    copy_start: float | None
    copy_end: float | None
    keyframes: list[float]
    spans: list[SmartRenderSpan]
    fallback_reason: str | None


def probe_source_media(ffprobe: Path, source: Path) -> SourceMediaInfo:
    data = ffprobe_json(
        ffprobe,
        source,
        [
            "-show_entries",
            "format=format_name,duration,bit_rate,size:"
            "stream=index,codec_type,codec_name,width,height,avg_frame_rate,bit_rate,duration",
        ],
    )
    streams = data.get("streams", [])
    video_stream = next((item for item in streams if item.get("codec_type") == "video"), {})
    audio_stream = next((item for item in streams if item.get("codec_type") == "audio"), {})
    format_info = data.get("format", {})

    audio_bitrate = _int_or_zero(audio_stream.get("bit_rate"))
    stream_bitrate = _int_or_zero(video_stream.get("bit_rate"))
    format_bitrate = _int_or_zero(format_info.get("bit_rate"))
    duration = _float_or_zero(format_info.get("duration") or video_stream.get("duration"))
    size = _int_or_none(format_info.get("size"))

    if stream_bitrate:
        video_bitrate = stream_bitrate
    elif format_bitrate and audio_bitrate and format_bitrate > audio_bitrate:
        video_bitrate = format_bitrate - audio_bitrate
    elif format_bitrate:
        video_bitrate = format_bitrate
    elif size and duration > 0:
        video_bitrate = int(size * 8 / duration)
    else:
        video_bitrate = DEFAULT_SOURCE_VIDEO_BITRATE

    return SourceMediaInfo(
        format_name=str(format_info.get("format_name") or ""),
        duration=duration,
        size=size,
        video_codec=str(video_stream.get("codec_name") or "").lower(),
        video_bitrate=max(1, video_bitrate),
        audio_codec=str(audio_stream.get("codec_name") or "").lower() or None,
        audio_bitrate=audio_bitrate,
        has_audio=bool(audio_stream),
    )


def estimate_reencode_bitrate(ffprobe: Path, source: Path, *, info: SourceMediaInfo | None = None) -> int:
    source_info = info or probe_source_media(ffprobe, source)
    return max(MIN_REENCODE_BITRATE, int(source_info.video_bitrate * 1.5))


def probe_keyframes(ffprobe: Path, source: Path, *, start: float | None = None, end: float | None = None) -> list[float]:
    args = [
        "-select_streams",
        "v:0",
        "-skip_frame",
        "nokey",
        "-show_entries",
        "frame=best_effort_timestamp_time,key_frame",
    ]
    if start is not None and end is not None:
        args = ["-read_intervals", f"{max(0.0, start):.3f}%{max(start, end):.3f}", *args]
    data = ffprobe_json(ffprobe, source, args)
    frames = data.get("frames", [])
    return sorted(
        float(frame["best_effort_timestamp_time"])
        for frame in frames
        if frame.get("best_effort_timestamp_time") is not None and str(frame.get("key_frame")) == "1"
    )


def plan_smart_render(ffprobe: Path, source: Path, *, start: float, end: float) -> SmartRenderPlan:
    if end <= start:
        raise ValueError(f"export end must be greater than start: start={start:.3f}, end={end:.3f}")

    info = probe_source_media(ffprobe, source)
    profile = render_profile_for(info, source)
    reencode_bitrate = estimate_reencode_bitrate(ffprobe, source, info=info)
    keyframes: list[float] = []
    copy_start: float | None = None
    copy_end: float | None = None
    fallback_reason = profile.fallback_reason
    spans = [SmartRenderSpan("encode", start, end)]

    if fallback_reason is None:
        keyframes = probe_keyframes(ffprobe, source, start=max(0.0, start - 10.0), end=end + 10.0)
        inside = _dedupe_times(value for value in keyframes if start <= value <= end)
        if len(inside) >= 2:
            copy_start = inside[0]
            copy_end = inside[-1]
            spans = _smart_spans(start, end, copy_start, copy_end)
        else:
            fallback_reason = "no keyframe-aligned GOP exists entirely inside the requested range"

    return SmartRenderPlan(
        start=start,
        end=end,
        output_suffix=profile.output_suffix,
        container_family=profile.container_family,
        video_codec=info.video_codec,
        video_encoder=profile.video_encoder,
        audio_encoder=profile.audio_encoder,
        audio_bitrate=profile.audio_bitrate,
        source_video_bitrate=info.video_bitrate,
        reencode_bitrate=reencode_bitrate,
        has_audio=info.has_audio,
        copy_start=copy_start,
        copy_end=copy_end,
        keyframes=keyframes,
        spans=spans,
        fallback_reason=fallback_reason,
    )


def render_profile_for(info: SourceMediaInfo, source: Path) -> RenderProfile:
    codec = info.video_codec
    format_parts = {part.strip().lower() for part in info.format_name.split(",") if part.strip()}
    suffix = source.suffix.lower()
    is_webm = suffix == ".webm" or "webm" in format_parts
    is_mp4ish = suffix in {".mp4", ".m4v", ".mov"} or bool(
        format_parts.intersection({"mov", "mp4", "m4a", "3gp", "3g2", "mj2"})
    )

    if is_webm:
        container_family = "webm"
        output_suffix = ".webm"
        video_encoder = _webm_video_encoder(codec)
        audio_encoder = "libopus"
        audio_bitrate = "160k"
        smart_copy = codec in {"vp8", "vp9", "av1"}
    else:
        container_family = "mp4" if is_mp4ish or codec in {"h264", "av1"} else "mp4"
        output_suffix = ".mp4"
        video_encoder = "libsvtav1" if codec == "av1" else "libx264"
        audio_encoder = "aac"
        audio_bitrate = "192k"
        smart_copy = codec in {"h264", "av1"}

    fallback_reason = None
    if not smart_copy:
        fallback_reason = f"unsupported smart-render codec/container: codec={codec or 'unknown'}, container={container_family}"

    return RenderProfile(
        container_family=container_family,
        output_suffix=output_suffix,
        video_encoder=video_encoder,
        audio_encoder=audio_encoder,
        audio_bitrate=audio_bitrate,
        smart_copy=smart_copy,
        fallback_reason=fallback_reason,
    )


def export_smart_clip(ffmpeg: Path, ffprobe: Path, source: Path, target: Path, *, start: float, end: float) -> dict:
    plan = plan_smart_render(ffprobe, source, start=start, end=end)
    actual_target = target.with_suffix(plan.output_suffix)
    actual_target.parent.mkdir(parents=True, exist_ok=True)

    if plan.fallback_reason is not None:
        _export_full_reencode(ffmpeg, source, actual_target, plan)
        _validate_export(ffprobe, actual_target, plan)
    else:
        try:
            _export_smart_spans(ffmpeg, source, actual_target, plan)
            _validate_export(ffprobe, actual_target, plan)
        except (subprocess.CalledProcessError, RuntimeError) as exc:
            plan = _fallback_plan(plan, f"smart render failed: {exc}")
            _export_full_reencode(ffmpeg, source, actual_target, plan)
            _validate_export(ffprobe, actual_target, plan)

    return {"target": str(actual_target), "smart_render_plan": asdict(plan)}


def _export_smart_spans(ffmpeg: Path, source: Path, target: Path, plan: SmartRenderPlan) -> None:
    with tempfile.TemporaryDirectory(prefix="songcut-smart-") as tmp_name:
        tmp = Path(tmp_name)
        span_paths: list[Path] = []
        for index, span in enumerate(plan.spans, start=1):
            span_target = tmp / f"span-{index:03d}{_fragment_suffix(plan)}"
            if span.mode == "copy":
                _export_video_copy_span(ffmpeg, source, span_target, span, plan)
            else:
                _export_video_encode_span(ffmpeg, source, span_target, span, plan)
            span_paths.append(span_target)

        video_target = tmp / f"video{plan.output_suffix}"
        _concat_video_spans(ffmpeg, span_paths, video_target, plan)

        if plan.has_audio:
            audio_target = tmp / f"audio{'.webm' if plan.container_family == 'webm' else '.m4a'}"
            _export_audio(ffmpeg, source, audio_target, plan)
            _mux_video_audio(ffmpeg, video_target, audio_target, target, plan)
        else:
            shutil.move(str(video_target), str(target))


def _export_full_reencode(ffmpeg: Path, source: Path, target: Path, plan: SmartRenderPlan) -> None:
    duration = max(0.0, plan.end - plan.start)
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{plan.start:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
        "-map",
        "0:v:0",
    ]
    if plan.has_audio:
        command.extend(["-map", "0:a:0"])
    command.extend(_video_encode_args(plan))
    if plan.has_audio:
        command.extend(["-c:a", plan.audio_encoder, "-b:a", plan.audio_bitrate])
    else:
        command.append("-an")
    command.extend(_container_args(plan))
    command.append(str(target))
    _run_ffmpeg(command)


def _export_video_encode_span(
    ffmpeg: Path,
    source: Path,
    target: Path,
    span: SmartRenderSpan,
    plan: SmartRenderPlan,
) -> None:
    duration = max(0.0, span.end - span.start)
    pre_seek = max(0.0, span.start - 5.0)
    offset = max(0.0, span.start - pre_seek)
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{pre_seek:.3f}",
        "-i",
        str(source),
    ]
    if offset > MIN_SPAN_SECONDS:
        command.extend(["-ss", f"{offset:.3f}"])
    command.extend(["-t", f"{duration:.3f}", "-map", "0:v:0", "-an"])
    command.extend(_video_encode_args(plan))
    command.extend(_fragment_output_args(plan))
    command.append(str(target))
    _run_ffmpeg(command)


def _export_video_copy_span(
    ffmpeg: Path,
    source: Path,
    target: Path,
    span: SmartRenderSpan,
    plan: SmartRenderPlan,
) -> None:
    duration = max(0.0, span.end - span.start)
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{span.start:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
        "-map",
        "0:v:0",
        "-an",
        "-c:v",
        "copy",
    ]
    if plan.container_family == "mp4" and plan.video_codec == "h264":
        command.extend(["-bsf:v", "h264_mp4toannexb"])
    command.extend(["-avoid_negative_ts", "make_zero"])
    command.extend(_fragment_output_args(plan))
    command.append(str(target))
    _run_ffmpeg(command)


def _concat_video_spans(ffmpeg: Path, span_paths: list[Path], target: Path, plan: SmartRenderPlan) -> None:
    list_file = target.with_suffix(".txt")
    list_file.write_text(
        "\n".join(f"file '{_concat_path(path)}'" for path in span_paths) + "\n",
        encoding="utf-8",
    )
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_file),
        "-map",
        "0:v:0",
        "-an",
        "-c:v",
        "copy",
    ]
    command.extend(_container_args(plan))
    command.append(str(target))
    _run_ffmpeg(command)


def _export_audio(ffmpeg: Path, source: Path, target: Path, plan: SmartRenderPlan) -> None:
    duration = max(0.0, plan.end - plan.start)
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{plan.start:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        plan.audio_encoder,
        "-b:a",
        plan.audio_bitrate,
        str(target),
    ]
    _run_ffmpeg(command)


def _mux_video_audio(ffmpeg: Path, video: Path, audio: Path, target: Path, plan: SmartRenderPlan) -> None:
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(video),
        "-i",
        str(audio),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "copy",
        "-shortest",
    ]
    command.extend(_container_args(plan))
    command.append(str(target))
    _run_ffmpeg(command)


def _run_ffmpeg(command: list[str]) -> None:
    subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=CREATE_NO_WINDOW,
    )


def _validate_export(ffprobe: Path, target: Path, plan: SmartRenderPlan) -> None:
    data = ffprobe_json(
        ffprobe,
        target,
        ["-show_entries", "format=duration:stream=codec_type,codec_name"],
    )
    streams = data.get("streams", [])
    if not any(item.get("codec_type") == "video" for item in streams):
        raise RuntimeError("export validation failed: no video stream in output")

    duration = _float_or_zero(data.get("format", {}).get("duration"))
    expected = plan.end - plan.start
    tolerance = max(2.0, expected * 0.05)
    if duration <= 0 or abs(duration - expected) > tolerance:
        raise RuntimeError(
            f"export validation failed: duration {duration:.3f}s differs from expected {expected:.3f}s"
        )


def _video_encode_args(plan: SmartRenderPlan) -> list[str]:
    args = ["-c:v", plan.video_encoder]
    if plan.video_encoder == "libx264":
        args.extend(["-preset", "veryfast", "-b:v", str(plan.reencode_bitrate), "-pix_fmt", "yuv420p"])
    elif plan.video_encoder == "libsvtav1":
        args.extend(["-preset", "8", "-b:v", str(plan.reencode_bitrate), "-pix_fmt", "yuv420p"])
    elif plan.video_encoder == "libvpx-vp9":
        args.extend(["-b:v", str(plan.reencode_bitrate), "-row-mt", "1"])
    else:
        args.extend(["-b:v", str(plan.reencode_bitrate)])
    return args


def _webm_video_encoder(codec: str) -> str:
    if codec == "vp8":
        return "libvpx"
    if codec == "av1":
        return "libsvtav1"
    return "libvpx-vp9"


def _container_args(plan: SmartRenderPlan) -> list[str]:
    if plan.container_family == "mp4":
        return ["-movflags", "+faststart"]
    return []


def _fragment_output_args(plan: SmartRenderPlan) -> list[str]:
    if plan.container_family == "mp4" and plan.video_codec == "h264":
        return ["-f", "mpegts"]
    return []


def _fragment_suffix(plan: SmartRenderPlan) -> str:
    if plan.container_family == "mp4" and plan.video_codec == "h264":
        return ".ts"
    return plan.output_suffix


def _fallback_plan(plan: SmartRenderPlan, reason: str) -> SmartRenderPlan:
    return replace(
        plan,
        copy_start=None,
        copy_end=None,
        spans=[SmartRenderSpan("encode", plan.start, plan.end)],
        fallback_reason=reason,
    )


def _smart_spans(start: float, end: float, copy_start: float, copy_end: float) -> list[SmartRenderSpan]:
    spans: list[SmartRenderSpan] = []
    _append_span(spans, "encode", start, copy_start)
    _append_span(spans, "copy", copy_start, copy_end)
    _append_span(spans, "encode", copy_end, end)
    return spans


def _append_span(spans: list[SmartRenderSpan], mode: str, start: float, end: float) -> None:
    if end - start > MIN_SPAN_SECONDS:
        spans.append(SmartRenderSpan(mode, start, end))


def _dedupe_times(values) -> list[float]:
    result: list[float] = []
    for value in sorted(float(item) for item in values):
        if not result or abs(value - result[-1]) > MIN_SPAN_SECONDS:
            result.append(value)
    return result


def _concat_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "'\\''")


def _float_or_zero(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _int_or_zero(value: object) -> int:
    maybe_int = _int_or_none(value)
    return maybe_int or 0


def _int_or_none(value: object) -> int | None:
    try:
        if value in (None, "", "N/A"):
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None

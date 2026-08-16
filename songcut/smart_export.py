from __future__ import annotations

import logging
import shutil
import tempfile
import win_safesubprocess as subprocess
from dataclasses import asdict, dataclass, replace
from pathlib import Path

from .ffmpeg_tools import ffprobe_json, find_mp3rgain
from .ffmpeg_process import CREATE_NO_WINDOW, run_ffmpeg_sync


MIN_SPAN_SECONDS = 0.001
DEFAULT_SOURCE_VIDEO_BITRATE = 2_000_000
MIN_REENCODE_BITRATE = 300_000
DEFAULT_TRUE_PEAK_DBTP = -1.0
LOGGER = logging.getLogger(__name__)


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
    video_frame_rate: float = 0.0
    video_frame_rate_is_constant: bool = False


@dataclass(frozen=True)
class VideoFramePoint:
    pts: float
    dts: float | None
    duration: float
    keyframe: bool


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
class SmartRenderEstimate:
    smart_render: bool
    source_container: str
    container_family: str
    output_suffix: str
    video_codec: str
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
    expected_video_frames: int | None = None


def probe_source_media(ffprobe: Path, source: Path) -> SourceMediaInfo:
    data = ffprobe_json(
        ffprobe,
        source,
        [
            "-show_entries",
            "format=format_name,duration,bit_rate,size:"
            "stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,bit_rate,duration",
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

    average_frame_rate = _parse_ratio(video_stream.get("avg_frame_rate"))
    nominal_frame_rate = _parse_ratio(video_stream.get("r_frame_rate"))
    return SourceMediaInfo(
        format_name=str(format_info.get("format_name") or ""),
        duration=duration,
        size=size,
        video_codec=str(video_stream.get("codec_name") or "").lower(),
        video_bitrate=max(1, video_bitrate),
        audio_codec=str(audio_stream.get("codec_name") or "").lower() or None,
        audio_bitrate=audio_bitrate,
        has_audio=bool(audio_stream),
        video_frame_rate=average_frame_rate,
        video_frame_rate_is_constant=(
            average_frame_rate > 0
            and nominal_frame_rate > 0
            and abs(average_frame_rate - nominal_frame_rate) < 0.001
        ),
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


def probe_video_frames(ffprobe: Path, source: Path, *, start: float, end: float) -> list[VideoFramePoint]:
    data = ffprobe_json(
        ffprobe,
        source,
        [
            "-read_intervals",
            f"{max(0.0, start):.6f}%{max(start, end):.6f}",
            "-select_streams",
            "v:0",
            "-show_entries",
            "frame=best_effort_timestamp_time,pkt_dts_time,pkt_duration_time,key_frame",
        ],
    )
    points: list[VideoFramePoint] = []
    for frame in data.get("frames", []):
        raw_pts = frame.get("best_effort_timestamp_time")
        if raw_pts is None:
            continue
        points.append(
            VideoFramePoint(
                pts=float(raw_pts),
                dts=_float_or_none(frame.get("pkt_dts_time")),
                duration=max(0.0, _float_or_zero(frame.get("pkt_duration_time"))),
                keyframe=str(frame.get("key_frame")) == "1",
            )
        )
    return sorted(points, key=lambda point: point.pts)


def snap_video_range_to_frames(
    ffprobe: Path,
    source: Path,
    *,
    start: float,
    end: float,
) -> tuple[float, float]:
    start_points = probe_video_frames(
        ffprobe,
        source,
        start=max(0.0, start - 1.0),
        end=start + 1.0,
    )
    end_points = probe_video_frames(
        ffprobe,
        source,
        start=max(0.0, end - 1.0),
        end=end + 1.0,
    )
    snapped_start = _nearest_frame_boundary(start_points, start)
    snapped_end = _nearest_frame_boundary(end_points, end)
    if snapped_end <= snapped_start:
        raise ValueError(
            "frame-snapped export range is empty: "
            f"requested={start:.6f}-{end:.6f}, snapped={snapped_start:.6f}-{snapped_end:.6f}"
        )
    return snapped_start, snapped_end


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
        start, end = snap_video_range_to_frames(ffprobe, source, start=start, end=end)
        spans = [SmartRenderSpan("encode", start, end)]
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
        expected_video_frames=(
            round((end - start) * info.video_frame_rate)
            if info.video_frame_rate_is_constant
            else None
        ),
    )


def render_profile_for(info: SourceMediaInfo, source: Path) -> RenderProfile:
    estimate = estimate_smart_render(info.format_name, info.video_codec, source)
    codec = estimate.video_codec

    if estimate.container_family == "webm":
        video_encoder = _webm_video_encoder(codec)
        audio_encoder = "libopus"
        audio_bitrate = "160k"
    elif estimate.container_family == "mkv":
        video_encoder = _matroska_video_encoder(codec)
        audio_encoder, audio_bitrate = _matroska_audio_profile(info)
    else:
        video_encoder = "libsvtav1" if codec == "av1" else "libx264"
        audio_encoder = "aac"
        audio_bitrate = "192k"

    return RenderProfile(
        container_family=estimate.container_family,
        output_suffix=estimate.output_suffix,
        video_encoder=video_encoder,
        audio_encoder=audio_encoder,
        audio_bitrate=audio_bitrate,
        smart_copy=estimate.smart_render,
        fallback_reason=estimate.fallback_reason,
    )


def estimate_smart_render(format_name: str, video_codec: str, source: Path) -> SmartRenderEstimate:
    codec = video_codec.lower()
    format_parts = {part.strip().lower() for part in format_name.split(",") if part.strip()}
    suffix = source.suffix.lower()
    is_webm = suffix == ".webm" or ("webm" in format_parts and suffix != ".mkv")
    is_matroska = suffix == ".mkv" or ("matroska" in format_parts and not is_webm)
    is_mp4ish = suffix in {".mp4", ".m4v", ".mov"} or bool(
        format_parts.intersection({"mov", "mp4", "m4a", "3gp", "3g2", "mj2"})
    )

    if is_webm:
        source_container = "webm"
        container_family = "webm"
        output_suffix = ".webm"
        smart_render = codec in {"vp8", "vp9", "av1"}
    elif is_matroska:
        source_container = "mkv"
        container_family = "mkv"
        output_suffix = ".mkv"
        smart_render = codec in {"h264", "vp8", "vp9", "av1"}
    elif is_mp4ish:
        source_container = suffix.removeprefix(".") or "mp4"
        container_family = "mp4"
        output_suffix = ".mp4"
        smart_render = codec in {"h264", "av1"}
    else:
        source_container = suffix.removeprefix(".") or next(iter(sorted(format_parts)), "unknown")
        container_family = "mp4"
        output_suffix = ".mp4"
        smart_render = False

    fallback_reason = None
    if not smart_render:
        fallback_reason = (
            f"unsupported smart-render codec/container: codec={codec or 'unknown'}, container={source_container}"
        )
    return SmartRenderEstimate(
        smart_render=smart_render,
        source_container=source_container,
        container_family=container_family,
        output_suffix=output_suffix,
        video_codec=codec,
        fallback_reason=fallback_reason,
    )


def export_smart_clip(
    ffmpeg: Path,
    ffprobe: Path,
    source: Path,
    target: Path,
    *,
    start: float,
    end: float,
    normalize_audio: bool = False,
    target_true_peak_dbtp: float = DEFAULT_TRUE_PEAK_DBTP,
) -> dict:
    plan = plan_smart_render(ffprobe, source, start=start, end=end)
    actual_target = target.with_suffix(plan.output_suffix)
    actual_target.parent.mkdir(parents=True, exist_ok=True)
    mp3rgain = _resolve_mp3rgain(plan) if normalize_audio else None

    true_peak: dict | None = None
    if plan.fallback_reason is not None:
        true_peak = _export_full_reencode(
            ffmpeg, ffprobe, mp3rgain, source, actual_target, plan, normalize_audio, target_true_peak_dbtp
        )
        _validate_export(ffprobe, actual_target, plan)
    else:
        try:
            true_peak = _export_smart_spans(
                ffmpeg, ffprobe, mp3rgain, source, actual_target, plan, normalize_audio, target_true_peak_dbtp
            )
            _validate_export(ffprobe, actual_target, plan)
        except (subprocess.CalledProcessError, RuntimeError) as exc:
            reason = f"smart render failed: {_exception_detail(exc)}"
            LOGGER.warning("%s; falling back to full re-encode", reason)
            plan = _fallback_plan(plan, reason)
            true_peak = _export_full_reencode(
                ffmpeg, ffprobe, mp3rgain, source, actual_target, plan, normalize_audio, target_true_peak_dbtp
            )
            _validate_export(ffprobe, actual_target, plan)

    result: dict = {"target": str(actual_target), "smart_render_plan": asdict(plan)}
    if true_peak:
        result["true_peak"] = true_peak
    return result


def _resolve_mp3rgain(plan: SmartRenderPlan) -> Path | None:
    if plan.has_audio and _audio_codec_family(plan) == "aac":
        return find_mp3rgain()
    return None


def _export_smart_spans(
    ffmpeg: Path,
    ffprobe: Path,
    mp3rgain: Path | None,
    source: Path,
    target: Path,
    plan: SmartRenderPlan,
    normalize_audio: bool,
    target_true_peak_dbtp: float,
) -> dict | None:
    with tempfile.TemporaryDirectory(prefix="songcut-smart-") as tmp_name:
        tmp = Path(tmp_name)
        span_paths: list[Path] = []
        for index, span in enumerate(plan.spans, start=1):
            span_target = tmp / f"span-{index:03d}{_fragment_suffix(plan)}"
            if span.mode == "copy":
                _export_video_copy_span(ffmpeg, ffprobe, source, span_target, span, plan)
            else:
                _export_video_encode_span(ffmpeg, source, span_target, span, plan)
            _validate_video_span(ffprobe, span_target, span, require_timestamps=span.mode == "copy")
            span_paths.append(span_target)

        video_target = tmp / f"video{plan.output_suffix}"
        _concat_video_spans(ffmpeg, span_paths, video_target, plan)

        return _finalize_audio_and_mux(
            ffmpeg, ffprobe, mp3rgain, source, target, plan, video_target, tmp,
            normalize_audio, target_true_peak_dbtp,
        )


def _export_full_reencode(
    ffmpeg: Path,
    ffprobe: Path,
    mp3rgain: Path | None,
    source: Path,
    target: Path,
    plan: SmartRenderPlan,
    normalize_audio: bool,
    target_true_peak_dbtp: float,
) -> dict | None:
    if not plan.has_audio:
        _export_full_video_only(ffmpeg, source, target, plan)
        return None

    with tempfile.TemporaryDirectory(prefix="songcut-full-") as tmp_name:
        tmp = Path(tmp_name)
        video_target = tmp / f"video{plan.output_suffix}"
        _export_full_video_only(ffmpeg, source, video_target, plan)
        return _finalize_audio_and_mux(
            ffmpeg, ffprobe, mp3rgain, source, target, plan, video_target, tmp,
            normalize_audio, target_true_peak_dbtp,
        )


def _export_full_video_only(ffmpeg: Path, source: Path, target: Path, plan: SmartRenderPlan) -> None:
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
        "-an",
    ]
    command.extend(_video_encode_args(plan))
    command.extend(_container_args(plan))
    command.append(str(target))
    _run_ffmpeg(command)


def _finalize_audio_and_mux(
    ffmpeg: Path,
    ffprobe: Path,
    mp3rgain: Path | None,
    source: Path,
    target: Path,
    plan: SmartRenderPlan,
    video_target: Path,
    tmp: Path,
    normalize_audio: bool,
    target_true_peak_dbtp: float,
) -> dict | None:
    if not plan.has_audio:
        shutil.move(str(video_target), str(target))
        return None

    audio_target = tmp / f"audio{_audio_artifact_suffix(plan)}"
    _export_audio(ffmpeg, source, audio_target, plan)
    if not normalize_audio:
        _mux_video_audio(ffmpeg, video_target, audio_target, target, plan)
        return None

    gain_result = _normalize_audio_artifact(
        ffmpeg, ffprobe, mp3rgain, audio_target, plan, target_true_peak_dbtp
    )
    _mux_video_audio(ffmpeg, video_target, audio_target, target, plan)
    final_peak = _measure_final_true_peak(ffmpeg, target, plan)
    return _true_peak_report(gain_result, final_peak)


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
    ffprobe: Path,
    source: Path,
    target: Path,
    span: SmartRenderSpan,
    plan: SmartRenderPlan,
) -> None:
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
    ]
    if not _uses_h264_transport_stream(plan):
        start_packet = _probe_keyframe_packet(ffprobe, source, span.start)
        end_packet = _probe_keyframe_packet(ffprobe, source, span.end)
        seek_start = max(0.0, min(start_packet.pts, start_packet.dts or start_packet.pts) - MIN_SPAN_SECONDS)
        stop_dts = end_packet.dts if end_packet.dts is not None else end_packet.pts
        copy_duration = max(MIN_SPAN_SECONDS, stop_dts - seek_start)
        command.extend(
            [
                "-i",
                str(source),
                "-ss",
                f"{seek_start:.6f}",
                "-t",
                f"{copy_duration:.6f}",
            ]
        )
    else:
        command.extend(
            [
                "-ss",
                f"{span.start:.6f}",
                "-i",
                str(source),
                "-t",
                f"{max(0.0, span.end - span.start):.6f}",
            ]
        )
    command.extend(["-map", "0:v:0", "-an", "-c:v", "copy"])
    if _uses_h264_transport_stream(plan):
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
    ]
    command.extend(_container_args(plan))
    command.append(str(target))
    _run_ffmpeg(command)


def _normalize_audio_artifact(
    ffmpeg: Path,
    ffprobe: Path,
    mp3rgain: Path | None,
    artifact: Path,
    plan: SmartRenderPlan,
    target_true_peak_dbtp: float,
) -> dict | None:
    codec = _audio_codec_family(plan)
    try:
        from lossless_audio_gain import normalize_true_peak
    except ImportError as exc:
        LOGGER.warning("lossless_audio_gain unavailable; skipping %s true-peak correction: %s", codec, exc)
        return None

    try:
        result = normalize_true_peak(
            artifact,
            artifact,
            target_true_peak_dbtp=target_true_peak_dbtp,
            verify=True,
            ffmpeg_bin=str(ffmpeg),
            ffprobe_bin=str(ffprobe),
            mp3rgain_bin=str(mp3rgain) if mp3rgain is not None else None,
            aac_write_undo=False,
            aac_check_reversible=True,
            r128_policy="neutralize",
        )
    except Exception as exc:
        LOGGER.warning(
            "true-peak normalization failed for %s artifact; keeping uncorrected audio: %s",
            codec,
            exc,
        )
        return None

    try:
        return result.to_dict()
    except AttributeError:
        return _gain_result_to_dict(result)


def _measure_final_true_peak(ffmpeg: Path, target: Path, plan: SmartRenderPlan) -> float | None:
    try:
        from lossless_audio_gain import measure_true_peak
    except ImportError:
        return None
    try:
        return float(measure_true_peak(target, ffmpeg_bin=str(ffmpeg)))
    except Exception as exc:
        LOGGER.warning("final true-peak measurement failed for %s: %s", target, exc)
        return None


def _true_peak_report(gain_result: dict | None, final_peak: float | None) -> dict | None:
    if gain_result is None and final_peak is None:
        return None
    return {
        "gain": gain_result,
        "final_true_peak_dbtp": final_peak,
    }


def _gain_result_to_dict(result: object) -> dict:
    data: dict[str, object] = {}
    for field in (
        "codec",
        "container",
        "mode",
        "requested_gain_db",
        "applied_gain_db",
        "measured_true_peak_dbtp",
        "predicted_true_peak_dbtp",
        "verified_true_peak_dbtp",
        "target_true_peak_dbtp",
        "backend",
        "reencoded",
        "quantization_error_db",
        "warnings",
    ):
        if hasattr(result, field):
            value = getattr(result, field)
            if isinstance(value, tuple):
                value = list(value)
            data[field] = value
    details = getattr(result, "details", None)
    if details is not None:
        data["details"] = dict(details)
    return data


def _run_ffmpeg(command: list[str]) -> None:
    try:
        run_ffmpeg_sync(command, process_module=subprocess)
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        if not stderr:
            stderr = "\n".join(getattr(exc, "ffmpeg_output_tail", ()))
        LOGGER.error(
            "FFmpeg command failed with exit code %s: %s\nstderr:\n%s",
            exc.returncode,
            command,
            stderr,
        )
        raise


def _validate_export(ffprobe: Path, target: Path, plan: SmartRenderPlan) -> None:
    data = ffprobe_json(
        ffprobe,
        target,
        [
            "-count_frames",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,nb_read_frames",
        ],
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
    if plan.expected_video_frames is not None:
        video_stream = next(item for item in streams if item.get("codec_type") == "video")
        actual_frames = _int_or_zero(video_stream.get("nb_read_frames"))
        if actual_frames <= 0 or abs(actual_frames - plan.expected_video_frames) > 2:
            raise RuntimeError(
                "export validation failed: "
                f"frame count {actual_frames} differs from expected {plan.expected_video_frames}"
            )


def _validate_video_span(
    ffprobe: Path,
    target: Path,
    span: SmartRenderSpan,
    *,
    require_timestamps: bool,
) -> None:
    entries = "format=duration:stream=codec_type"
    if require_timestamps:
        entries += ":packet=pts_time,dts_time"
    data = ffprobe_json(
        ffprobe,
        target,
        [
            "-select_streams",
            "v:0",
            "-show_entries",
            entries,
        ],
    )
    duration = _float_or_zero(data.get("format", {}).get("duration"))
    expected = span.end - span.start
    if duration <= 0 or abs(duration - expected) > max(0.1, expected * 0.01):
        raise RuntimeError(
            "smart-render span validation failed: "
            f"{span.mode} duration {duration:.6f}s differs from expected {expected:.6f}s"
        )
    if require_timestamps:
        packets = data.get("packets", [])
        if not packets:
            raise RuntimeError("smart-render span validation failed: copied span has no video packets")
        missing = sum(1 for packet in packets if packet.get("pts_time") is None)
        if missing:
            raise RuntimeError(
                f"smart-render span validation failed: copied span has {missing} packets without PTS"
            )


def _probe_keyframe_packet(ffprobe: Path, source: Path, pts: float) -> VideoFramePoint:
    data = ffprobe_json(
        ffprobe,
        source,
        [
            "-read_intervals",
            f"{max(0.0, pts - 1.0):.6f}%{pts + 1.0:.6f}",
            "-select_streams",
            "v:0",
            "-show_entries",
            "packet=pts_time,dts_time,duration_time,flags",
        ],
    )
    candidates: list[VideoFramePoint] = []
    for packet in data.get("packets", []):
        raw_pts = packet.get("pts_time")
        if raw_pts is None or "K" not in str(packet.get("flags") or ""):
            continue
        candidates.append(
            VideoFramePoint(
                pts=float(raw_pts),
                dts=_float_or_none(packet.get("dts_time")),
                duration=max(0.0, _float_or_zero(packet.get("duration_time"))),
                keyframe=True,
            )
        )
    if not candidates:
        raise RuntimeError(f"no keyframe packet found near PTS {pts:.6f}")
    result = min(candidates, key=lambda packet: abs(packet.pts - pts))
    if abs(result.pts - pts) > 0.1:
        raise RuntimeError(
            f"nearest keyframe packet PTS {result.pts:.6f} differs from planned PTS {pts:.6f}"
        )
    return result


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


def _matroska_video_encoder(codec: str) -> str:
    if codec == "vp8":
        return "libvpx"
    if codec == "vp9":
        return "libvpx-vp9"
    if codec == "av1":
        return "libsvtav1"
    return "libx264"


def _matroska_audio_profile(info: SourceMediaInfo) -> tuple[str, str]:
    if info.audio_codec in {"opus", "vorbis"} or info.video_codec in {"vp8", "vp9", "av1"}:
        return "libopus", "160k"
    return "aac", "192k"


def _audio_codec_family(plan: SmartRenderPlan) -> str:
    if plan.audio_encoder == "libopus":
        return "opus"
    return "aac"


def _audio_artifact_suffix(plan: SmartRenderPlan) -> str:
    if _audio_codec_family(plan) == "opus":
        return ".opus"
    return ".m4a"


def _container_args(plan: SmartRenderPlan) -> list[str]:
    if plan.container_family == "mp4":
        return ["-movflags", "+faststart"]
    return []


def _fragment_output_args(plan: SmartRenderPlan) -> list[str]:
    if _uses_h264_transport_stream(plan):
        return ["-f", "mpegts"]
    return []


def _fragment_suffix(plan: SmartRenderPlan) -> str:
    if _uses_h264_transport_stream(plan):
        return ".ts"
    return plan.output_suffix


def _uses_h264_transport_stream(plan: SmartRenderPlan) -> bool:
    return plan.video_codec == "h264" and plan.container_family == "mp4"


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


def _nearest_frame_boundary(points: list[VideoFramePoint], requested: float) -> float:
    if not points:
        return requested
    boundaries = [point.pts for point in points]
    last = points[-1]
    if last.duration > 0:
        boundaries.append(last.pts + last.duration)
    return min(boundaries, key=lambda value: (abs(value - requested), value))


def _concat_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "'\\''")


def _float_or_zero(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _float_or_none(value: object) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _parse_ratio(value: object) -> float:
    raw = str(value or "")
    if "/" not in raw:
        return _float_or_zero(raw)
    numerator, denominator = raw.split("/", 1)
    denominator_value = _float_or_zero(denominator)
    if denominator_value == 0:
        return 0.0
    return _float_or_zero(numerator) / denominator_value


def _exception_detail(exc: BaseException) -> str:
    stderr = str(getattr(exc, "stderr", "") or "").strip()
    if not stderr:
        stderr = "\n".join(str(line) for line in getattr(exc, "ffmpeg_output_tail", ()) if str(line).strip())
    if stderr:
        return f"{exc}; stderr: {stderr}"
    return str(exc)


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

from __future__ import annotations

import platform
import sys
import time
from pathlib import Path
from typing import Any

from . import __version__
from .boundary_refiner import BOUNDARY_REFINER_VERSION, BoundaryRefinerConfig, refine_segments
from .features import FeatureConfig, compute_features, pcm_bytes_to_float_stereo
from .ffmpeg_tools import FfmpegPaths, ffprobe_json, find_ffmpeg, probe_duration, read_pcm_s16le
from .guide import build_guided_exports, guided_exports_to_segment_dicts, parse_guide_text
from .hardware import select_backend
from .io import segments_to_dicts
from .metadata import metadata_segments
from .segmenter import SegmenterProfile, segments_from_features
from .waveform import (
    WAVEFORM_MAX_POINTS,
    WAVEFORM_MIN_POINTS,
    WAVEFORM_SAMPLE_RATE,
    waveform_bucket_count,
    waveform_peaks,
)



def probe_video(ffprobe: Path, source: Path) -> dict[str, Any]:
    data = ffprobe_json(
        ffprobe,
        source,
        [
            "-show_entries",
            "format=format_name,duration,bit_rate:stream=index,codec_type,codec_name,width,height,avg_frame_rate,bit_rate,duration",
        ],
    )
    video_stream = next((item for item in data.get("streams", []) if item.get("codec_type") == "video"), {})
    audio_stream = next((item for item in data.get("streams", []) if item.get("codec_type") == "audio"), {})
    duration = float(data.get("format", {}).get("duration") or video_stream.get("duration") or 0.0)
    return {
        "path": str(source),
        "name": source.name,
        "format_name": str(data.get("format", {}).get("format_name") or ""),
        "duration": round(duration, 3),
        "bit_rate": int(float(data.get("format", {}).get("bit_rate") or video_stream.get("bit_rate") or 0)),
        "video": {
            "codec": video_stream.get("codec_name"),
            "width": video_stream.get("width"),
            "height": video_stream.get("height"),
            "fps": video_stream.get("avg_frame_rate"),
            "bit_rate": int(float(video_stream.get("bit_rate") or 0)),
        },
        "audio": {
            "codec": audio_stream.get("codec_name"),
            "bit_rate": int(float(audio_stream.get("bit_rate") or 0)),
        },
    }


def analyze_for_gui(
    source: Path,
    *,
    guide_text: str = "",
    timestamp_source: str = "auto",
    profile_name: str = "intel-258v",
    device: str = "auto",
    min_segment_seconds: float = 75.0,
    threshold: float | None = None,
    boundary_refinement: BoundaryRefinerConfig | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    ffmpeg_paths = find_ffmpeg()
    backend = select_backend(device)
    duration = probe_duration(ffmpeg_paths.ffprobe, source)

    selected_source = "acoustic-dsp"
    frame_scores: list[dict[str, float]] = []
    segments = []
    boundary_config = boundary_refinement or BoundaryRefinerConfig()
    boundary_refinement_result: dict[str, Any] = {
        "version": BOUNDARY_REFINER_VERSION,
        "settings": boundary_config.to_dict(),
        "segment_count": 0,
        "applied_segments": 0,
        "refined_boundaries": 0,
        "skipped_reason": "metadata-source",
    }
    boundary_diagnostics: list[dict[str, Any]] = []
    if timestamp_source in {"auto", "metadata"}:
        segments = metadata_segments(ffmpeg_paths.ffprobe, source)
        if segments:
            selected_source = "video-metadata"
        elif timestamp_source == "metadata":
            raise RuntimeError("No timestamp ranges were found in video metadata.")

    if not segments:
        raw = read_pcm_s16le(ffmpeg_paths.ffmpeg, source, sample_rate=16000, channels=2)
        samples = pcm_bytes_to_float_stereo(raw, channels=2)
        config = FeatureConfig(sample_rate=16000, window_seconds=2.0, hop_seconds=0.5, smooth_frames=9)
        features = compute_features(samples, config)
        profile = SegmenterProfile(
            name=profile_name,
            threshold=threshold if threshold is not None else 0.34,
            min_segment_seconds=min_segment_seconds,
            merge_gap_seconds=12.0,
            pad_seconds=1.0,
        )
        segments = segments_from_features(features, profile)
        refinement = refine_segments(
            samples,
            segments,
            sample_rate=config.sample_rate,
            media_duration=duration,
            config=boundary_config,
        )
        segments = refinement.segments
        boundary_diagnostics = refinement.segment_diagnostics
        boundary_refinement_result = refinement.summary
        frame_scores = [
            {
                "t": round(float(t), 3),
                "score": round(float(score), 5),
                "rms": round(float(rms), 7),
            }
            for t, score, rms in zip(features.times, features.smoothed_score, features.rms)
        ]
        selected_source = "acoustic-dsp"

    raw_segment_items = segments_to_dicts(segments)
    if selected_source == "video-metadata":
        boundary_refinement_result["segment_count"] = len(segments)
    for item, diagnostic in zip(raw_segment_items, boundary_diagnostics):
        item["boundary_refinement"] = diagnostic
        if diagnostic["start"]["success"] or diagnostic["end"]["success"]:
            item["boundary_refined"] = True
            item["flags"].append("boundary_refined")
    segment_items, export_candidates, guide_applied = build_gui_segments_and_exports(
        guide_text,
        raw_segment_items,
        media_duration=duration,
    )
    result_source = f"{selected_source}+guide" if guide_applied else selected_source

    return {
        "schema_version": 3,
        "source_path": str(source),
        "duration": round(duration, 3),
        "profile": profile_name,
        "timestamp_source": result_source,
        "model_versions": {
            "songcut": __version__,
            "singing_detector": "metadata-parser" if selected_source == "video-metadata" else "numpy-dsp-v1",
            "boundary_refiner": BOUNDARY_REFINER_VERSION,
        },
        "backend": backend.backend,
        "device_requested": backend.device_requested,
        "device_used": backend.device_used,
        "available_devices": backend.available_devices,
        "fallbacks": backend.fallbacks,
        "backend_note": backend.note,
        "ffmpeg_path": str(ffmpeg_paths.ffmpeg),
        "ffprobe_path": str(ffmpeg_paths.ffprobe),
        "created_by": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
        },
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "segments": segment_items,
        "raw_segments": raw_segment_items,
        "boundary_refinement": boundary_refinement_result,
        "export_candidates": export_candidates,
        "frame_scores": frame_scores,
        # Kept as an empty compatibility field while GUI clients migrate to the
        # independent load-time waveform job.
        "waveform": [],
    }


def build_gui_segments_and_exports(
    guide_text: str,
    segments: list[dict[str, Any]],
    *,
    media_duration: float | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], bool]:
    guide_entries = parse_guide_text(guide_text) if guide_text.strip() else []
    if guide_entries:
        guided = build_guided_exports(
            guide_entries,
            segments,
            max_distance_seconds=90.0,
            numbered_filenames=True,
            media_duration=media_duration,
        )
        return guided_exports_to_segment_dicts(guided), guided_exports_to_export_candidates(guided), True
    return segments, detected_segments_to_export_candidates(segments), False


def guided_exports_to_export_candidates(guided: list[Any]) -> list[dict[str, Any]]:
    return [
        {
            "id": f"export-{item.index:03d}",
            "title": item.title,
            "filename_stem": item.filename_stem,
            "start": round(item.start, 3),
            "end": round(item.end, 3),
            "duration": round(item.end - item.start, 3),
            "match_source": item.match_source,
            "guide_line_number": item.guide_line_number,
            "guide_line": item.guide_line,
            "distance_seconds": None if item.distance_seconds is None else round(item.distance_seconds, 3),
            **({"matched_segment_id": item.matched_segment_id} if item.matched_segment_id is not None else {}),
            "checked": True,
        }
        for item in guided
    ]


def detected_segments_to_export_candidates(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": str(item["id"]),
            "title": str(item["id"]),
            "filename_stem": f"{item['id']}_{str(item['start_timecode']).replace(':', '-')}_{str(item['end_timecode']).replace(':', '-')}",
            "start": float(item["start"]),
            "end": float(item["end"]),
            "duration": float(item.get("duration", float(item["end"]) - float(item["start"]))),
            "match_source": "detected-segment",
            "guide_line_number": None,
            "guide_line": "",
            "distance_seconds": None,
            "checked": True,
        }
        for item in segments
    ]


def get_ffmpeg_paths() -> FfmpegPaths:
    return find_ffmpeg()

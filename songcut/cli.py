from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from pathlib import Path

from . import __version__
from .evaluate import evaluate_segments
from .features import FeatureConfig, compute_features, pcm_bytes_to_float_stereo
from .ffmpeg_tools import FfmpegPaths, export_clip, find_ffmpeg, probe_duration, read_pcm_s16le
from .guide import build_guided_exports, guided_exports_to_segment_dicts, read_guide_file
from .hardware import select_backend
from .io import read_segments_json, segments_to_dicts, write_segments_json
from .metadata import metadata_segments
from .review import write_review_html
from .segmenter import SegmenterProfile, segments_from_features
from .smart_export import export_smart_clip
from .timestamps import Segment, read_timestamp_file


def main(argv: list[str] | None = None) -> int:
    configure_console_encoding()
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except Exception as exc:
        print(f"songcut: error: {exc}", file=sys.stderr)
        return 2


def configure_console_encoding() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="songcut")
    parser.add_argument("--version", action="version", version=f"songcut {__version__}")
    subparsers = parser.add_subparsers(required=True)

    analyze = subparsers.add_parser("analyze", help="Analyze a video and write segments.json.")
    analyze.add_argument("source", type=Path)
    analyze.add_argument("--out", type=Path, required=True)
    analyze.add_argument("--profile", default="intel-258v")
    analyze.add_argument("--device", choices=("auto", "npu", "gpu", "cpu"), default="auto")
    analyze.add_argument("--timestamp-source", choices=("auto", "metadata", "acoustic"), default="auto")
    analyze.add_argument("--threshold", type=float, default=None)
    analyze.add_argument("--min-segment-seconds", type=float, default=75.0)
    analyze.add_argument("--guide", type=Path, default=None, help="Guide text with YouTube timestamp tags.")
    analyze.add_argument(
        "--guide-max-distance",
        type=float,
        default=90.0,
        help="Maximum distance from a one-tag guide timestamp to a detected segment.",
    )
    analyze.add_argument("--guide-no-prefix", action="store_true", help="Do not add 01_ style prefixes to guide names.")
    analyze.add_argument("--review", action="store_true", help="Also write review.html next to segments.json.")
    analyze.add_argument("--review-out", type=Path, default=None, help="Custom path for --review output.")
    analyze.set_defaults(func=cmd_analyze)

    evaluate = subparsers.add_parser("evaluate", help="Evaluate segments.json against timestamp truth.")
    evaluate.add_argument("segments_json", type=Path)
    evaluate.add_argument("--truth", type=Path, required=True)
    evaluate.set_defaults(func=cmd_evaluate)

    export = subparsers.add_parser("export", help="Export detected clips.")
    export.add_argument("segments_json", type=Path)
    export.add_argument("--source", type=Path, required=True)
    export.add_argument("--out", type=Path, required=True)
    export.add_argument("--mode", choices=("smart", "accurate", "copy"), default="smart")
    export.add_argument("--limit", type=int, default=None, help="Export only the first N segments.")
    export.add_argument("--guide", type=Path, default=None, help="Guide text with YouTube timestamp tags.")
    export.add_argument(
        "--guide-max-distance",
        type=float,
        default=90.0,
        help="Maximum distance from a one-tag guide timestamp to a detected segment.",
    )
    export.add_argument("--guide-no-prefix", action="store_true", help="Do not add 01_ style prefixes to guide names.")
    export.set_defaults(func=cmd_export)

    review = subparsers.add_parser("review", help="Generate a lightweight review HTML.")
    review.add_argument("segments_json", type=Path)
    review.add_argument("--video", type=Path, required=True)
    review.add_argument("--out", type=Path, required=True)
    review.set_defaults(func=cmd_review)

    devices = subparsers.add_parser("devices", help="Show ffmpeg and OpenVINO device diagnostics.")
    devices.set_defaults(func=cmd_devices)
    return parser


def cmd_analyze(args: argparse.Namespace) -> int:
    started = time.perf_counter()
    ffmpeg_paths = find_ffmpeg()
    backend = select_backend(args.device)
    duration = probe_duration(ffmpeg_paths.ffprobe, args.source)

    selected_source = "acoustic-dsp"
    segments: list[Segment] = []
    frame_scores: list[dict[str, float]] = []

    if args.timestamp_source in {"auto", "metadata"}:
        segments = metadata_segments(ffmpeg_paths.ffprobe, args.source)
        if segments:
            selected_source = "video-metadata"
        elif args.timestamp_source == "metadata":
            raise RuntimeError("No timestamp ranges were found in video metadata.")

    if not segments:
        raw = read_pcm_s16le(ffmpeg_paths.ffmpeg, args.source, sample_rate=16000, channels=2)
        samples = pcm_bytes_to_float_stereo(raw, channels=2)
        config = FeatureConfig(sample_rate=16000, window_seconds=2.0, hop_seconds=0.5, smooth_frames=9)
        features = compute_features(samples, config)
        profile = SegmenterProfile(
            name=args.profile,
            threshold=args.threshold if args.threshold is not None else 0.34,
            min_segment_seconds=args.min_segment_seconds,
            merge_gap_seconds=12.0,
            pad_seconds=1.0,
        )
        segments = segments_from_features(features, profile)
        frame_scores = [
            {
                "t": round(float(t), 3),
                "score": round(float(score), 5),
                "rms": round(float(rms), 7),
                "mid_ratio": round(float(mid), 5),
                "low_ratio": round(float(low), 5),
                "high_ratio": round(float(high), 5),
                "zcr": round(float(zcr), 5),
            }
            for t, score, rms, mid, low, high, zcr in zip(
                features.times,
                features.smoothed_score,
                features.rms,
                features.mid_ratio,
                features.low_ratio,
                features.high_ratio,
                features.zcr,
            )
        ]

    payload = {
        "schema_version": 1,
        "source_path": str(args.source),
        "duration": round(duration, 3),
        "profile": args.profile,
        "timestamp_source": selected_source,
        "model_versions": {
            "songcut": __version__,
            "singing_detector": "metadata-parser" if selected_source == "video-metadata" else "numpy-dsp-v1",
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
        "segments": segments_to_dicts(segments),
        "frame_scores": frame_scores,
    }
    target = args.out / "segments.json"
    write_segments_json(target, payload)
    output = {"segments_json": str(target), "segments": len(segments), "source": selected_source}

    review_segments_json = target
    if args.guide:
        entries = read_guide_file(args.guide)
        guided_exports = build_guided_exports(
            entries,
            payload["segments"],
            max_distance_seconds=args.guide_max_distance,
            numbered_filenames=not args.guide_no_prefix,
        )
        guided_payload = {
            **payload,
            "timestamp_source": f"{selected_source}+guide",
            "guide_path": str(args.guide),
            "raw_segments_json": str(target),
            "segments": guided_exports_to_segment_dicts(guided_exports),
            "frame_scores": [],
        }
        guided_target = args.out / "guided_segments.json"
        write_segments_json(guided_target, guided_payload)
        review_segments_json = guided_target
        output["guide"] = str(args.guide)
        output["guided_segments_json"] = str(guided_target)
        output["guided_segments"] = len(guided_exports)

    if args.review:
        review_target = args.review_out or args.out / "review.html"
        write_review_html(review_segments_json, args.source, review_target)
        output["review_html"] = str(review_target)
    print(json.dumps(output, ensure_ascii=False))
    return 0


def cmd_evaluate(args: argparse.Namespace) -> int:
    payload = read_segments_json(args.segments_json)
    predicted = [
        Segment(float(item["start"]), float(item["end"]), float(item.get("confidence", 1.0)), str(item.get("source", "json")))
        for item in payload.get("segments", [])
    ]
    truth = read_timestamp_file(args.truth)
    result = evaluate_segments(predicted, truth)
    output = {
        "precision": round(result.precision, 6),
        "recall": round(result.recall, 6),
        "f1": round(result.f1, 6),
        "intersection_seconds": round(result.intersection_seconds, 3),
        "predicted_seconds": round(result.predicted_seconds, 3),
        "truth_seconds": round(result.truth_seconds, 3),
        "median_boundary_error_seconds": None
        if result.median_boundary_error_seconds is None
        else round(result.median_boundary_error_seconds, 3),
        "predicted_count": len(predicted),
        "truth_count": len(truth),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    ffmpeg_paths = find_ffmpeg()
    payload = read_segments_json(args.segments_json)
    exported: list[str] = []
    guide_manifest: list[dict[str, object]] = []
    segments = list(payload.get("segments", []))

    if args.guide:
        entries = read_guide_file(args.guide)
        guided_exports = build_guided_exports(
            entries,
            segments,
            max_distance_seconds=args.guide_max_distance,
            numbered_filenames=not args.guide_no_prefix,
        )
        if args.limit is not None:
            guided_exports = guided_exports[: max(0, args.limit)]
        for item in guided_exports:
            target = args.out / f"{item.filename_stem}.mp4"
            exported_path = export_cli_clip(
                ffmpeg_paths,
                args.source,
                target,
                start=item.start,
                end=item.end,
                mode=args.mode,
            )
            exported.append(exported_path)
            guide_manifest.append(
                {
                    "path": exported_path,
                    "title": item.title,
                    "start": round(item.start, 3),
                    "end": round(item.end, 3),
                    "match_source": item.match_source,
                    "guide_line_number": item.guide_line_number,
                    "guide_line": item.guide_line,
                    "distance_seconds": None
                    if item.distance_seconds is None
                    else round(item.distance_seconds, 3),
                }
            )
    else:
        if args.limit is not None:
            segments = segments[: max(0, args.limit)]
        for item in segments:
            if item.get("filename_stem"):
                target = args.out / f"{item['filename_stem']}.mp4"
            else:
                target = args.out / f"{item['id']}_{item['start_timecode'].replace(':', '-')}_{item['end_timecode'].replace(':', '-')}.mp4"
            exported.append(
                export_cli_clip(
                    ffmpeg_paths,
                    args.source,
                    target,
                    start=float(item["start"]),
                    end=float(item["end"]),
                    mode=args.mode,
                )
            )

    output: dict[str, object] = {"exported": exported}
    if args.guide:
        output["guide"] = str(args.guide)
        output["guided_exports"] = guide_manifest
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


def export_cli_clip(
    ffmpeg_paths: FfmpegPaths,
    source: Path,
    target: Path,
    *,
    start: float,
    end: float,
    mode: str,
) -> str:
    if mode == "smart":
        result = export_smart_clip(ffmpeg_paths.ffmpeg, ffmpeg_paths.ffprobe, source, target, start=start, end=end)
        return str(result["target"])

    export_clip(
        ffmpeg_paths.ffmpeg,
        source,
        target,
        start=start,
        end=end,
        mode=mode,
    )
    return str(target)


def cmd_review(args: argparse.Namespace) -> int:
    write_review_html(args.segments_json, args.video, args.out)
    print(json.dumps({"review_html": str(args.out)}, ensure_ascii=False))
    return 0


def cmd_devices(_: argparse.Namespace) -> int:
    ffmpeg_paths = find_ffmpeg()
    backend = select_backend("auto")
    output = {
        "ffmpeg": str(ffmpeg_paths.ffmpeg),
        "ffprobe": str(ffmpeg_paths.ffprobe),
        "backend": backend.backend,
        "device_used": backend.device_used,
        "available_devices": backend.available_devices,
        "fallbacks": backend.fallbacks,
        "note": backend.note,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

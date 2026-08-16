"""Command-line interface."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

from .api import adjust_gain, normalize_true_peak
from .exceptions import LosslessAudioGainError
from .measure import measure_true_peak
from .opus import inspect_ogg_opus
from .probe import detect_media


def _common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg", help="FFmpeg executable")
    parser.add_argument("--ffprobe", default="ffprobe", help="ffprobe executable")
    parser.add_argument(
        "--mp3rgain",
        default=None,
        help="mp3rgain executable for AAC (or set MP3RGAIN_BIN)",
    )
    parser.add_argument(
        "--no-aac-undo",
        action="store_true",
        help="Do not ask mp3rgain to store AAC undo metadata",
    )
    parser.add_argument(
        "--no-aac-reversibility-check",
        action="store_true",
        help="Skip the forward/inverse AAC mdat round-trip check",
    )
    parser.add_argument(
        "--r128-policy",
        choices=("neutralize", "keep", "error"),
        default="neutralize",
        help="How to handle Opus R128 gain tags",
    )
    parser.add_argument(
        "--gain-verify-psnr",
        type=float,
        default=90.0,
        metavar="DB",
        help="Minimum per-channel APSNR for decoded gain verification",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON result")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lossless-audio-gain",
        description="Lossless True-Peak/gain adjustment for Ogg Opus and AAC-LC MP4/M4A",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    auto = subparsers.add_parser("auto", help="Measure and target a true peak")
    _common_arguments(auto)
    auto.add_argument("--target", type=float, default=-1.0, help="Target dBTP")
    auto.add_argument("--no-verify", action="store_true")
    auto.add_argument("--tolerance", type=float, default=0.08)

    specified = subparsers.add_parser("gain", help="Apply a specified gain")
    _common_arguments(specified)
    specified.add_argument("--gain", type=float, required=True, help="Gain in dB")
    specified.add_argument(
        "--verify",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Verify decoded uniform gain and measure output True Peak (default: on)",
    )
    specified.add_argument(
        "--aac-rounding",
        choices=("nearest", "not_above", "toward_zero"),
        default="nearest",
    )

    measure = subparsers.add_parser("measure", help="Measure true peak only")
    measure.add_argument("input", type=Path)
    measure.add_argument("--ffmpeg", default="ffmpeg")
    measure.add_argument("--json", action="store_true")

    inspect = subparsers.add_parser("inspect", help="Inspect supported media")
    inspect.add_argument("input", type=Path)
    inspect.add_argument("--ffprobe", default="ffprobe")
    inspect.add_argument("--json", action="store_true")
    return parser


def _strict_json_value(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        if math.isnan(value):
            return "nan"
        return "-inf" if value < 0 else "+inf"
    if isinstance(value, dict):
        return {str(key): _strict_json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_strict_json_value(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    return value


def _print_result(payload: dict[str, object], as_json: bool) -> None:
    if as_json:
        print(
            json.dumps(
                _strict_json_value(payload),
                ensure_ascii=False,
                indent=2,
                allow_nan=False,
            )
        )
        return
    for key, value in payload.items():
        print(f"{key}: {value}")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "auto":
            result = normalize_true_peak(
                args.input,
                args.output,
                target_true_peak_dbtp=args.target,
                verify=not args.no_verify,
                verification_tolerance_db=args.tolerance,
                gain_verification_min_psnr_db=args.gain_verify_psnr,
                ffmpeg_bin=args.ffmpeg,
                ffprobe_bin=args.ffprobe,
                mp3rgain_bin=args.mp3rgain,
                aac_write_undo=not args.no_aac_undo,
                aac_check_reversible=not args.no_aac_reversibility_check,
                r128_policy=args.r128_policy,
            )
            _print_result(result.to_dict(), args.json)
        elif args.command == "gain":
            result = adjust_gain(
                args.input,
                args.output,
                gain_db=args.gain,
                verify=args.verify,
                gain_verification_min_psnr_db=args.gain_verify_psnr,
                ffmpeg_bin=args.ffmpeg,
                ffprobe_bin=args.ffprobe,
                mp3rgain_bin=args.mp3rgain,
                aac_rounding=args.aac_rounding,
                aac_write_undo=not args.no_aac_undo,
                aac_check_reversible=not args.no_aac_reversibility_check,
                r128_policy=args.r128_policy,
            )
            _print_result(result.to_dict(), args.json)
        elif args.command == "measure":
            peak = measure_true_peak(args.input, ffmpeg_bin=args.ffmpeg)
            _print_result({"true_peak_dbtp": peak}, args.json)
        elif args.command == "inspect":
            media = detect_media(args.input, ffprobe_bin=args.ffprobe)
            payload: dict[str, object] = {
                "codec": media.codec,
                "container": media.container,
                "profile": media.profile,
                "audio_streams": media.audio_streams,
                "channels": media.channels,
            }
            if media.codec == "opus":
                payload.update(inspect_ogg_opus(args.input))
            _print_result(payload, args.json)
        return 0
    except (LosslessAudioGainError, FileNotFoundError, ValueError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

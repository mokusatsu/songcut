from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ass_lyric_effects import get_effect_catalog

from songcut.ffmpeg_process import run_ffmpeg_sync
from songcut.ffmpeg_tools import find_ffmpeg, probe_duration
from songcut.subtitle_export import (
    DEFAULT_EFFECT_DURATION_MS,
    SubtitleEffect,
    SubtitleLane,
    SubtitleSegment,
    SubtitleStyle,
    export_subtitle_bundle,
)


DEFAULT_OUTPUT_DIR = REPO_ROOT / "out" / "e2e-all-subtitle-effects"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render every ASS Lyric Effects catalog entry over a black video."
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--seconds-per-effect", type=float, default=10.0)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--fps", type=int, default=24)
    return parser.parse_args()


def _effect_defaults(effect: dict[str, object]) -> dict[str, object]:
    parameters = effect.get("parameters")
    if not isinstance(parameters, dict):
        raise RuntimeError(f"catalog parameters are malformed for {effect.get('effect_id')!r}")
    return {
        name: schema["default"]
        for name, schema in parameters.items()
        if isinstance(schema, dict) and "default" in schema
    }


def _build_lane(
    effects: list[dict[str, object]],
    *,
    seconds_per_effect: float,
) -> tuple[SubtitleLane, list[dict[str, object]]]:
    segments: list[SubtitleSegment] = []
    manifest: list[dict[str, object]] = []
    for index, effect in enumerate(effects):
        effect_id = str(effect["effect_id"])
        display_number = int(effect["display_number"])
        name_ja = str(effect["name_ja"])
        start = index * seconds_per_effect
        end = start + seconds_per_effect
        defaults = _effect_defaults(effect)
        segments.append(
            SubtitleSegment(
                id=f"effect-{display_number:03d}",
                text=f"{display_number:03d}  {name_ja}  /  {effect_id}",
                start=start,
                end=end,
                effect_override=SubtitleEffect(name=effect_id, params=defaults),
            )
        )
        manifest.append(
            {
                "display_number": display_number,
                "effect_id": effect_id,
                "name_en": effect["name_en"],
                "name_ja": name_ja,
                "start_seconds": start,
                "end_seconds": end,
                "duration_seconds": seconds_per_effect,
                "start_duration_ms": DEFAULT_EFFECT_DURATION_MS,
                "end_duration_ms": DEFAULT_EFFECT_DURATION_MS,
                "parameters": defaults,
            }
        )

    lane = SubtitleLane(
        id="all-effects",
        name="All ASS Lyric Effects",
        style=SubtitleStyle(
            font_name="Yu Gothic UI",
            font_size=44,
            primary_color="#FFFFFF",
            outline_color="#000000",
            background_color="#00000000",
            outline=2,
            shadow=0,
            alignment=2,
            margin_l=48,
            margin_r=48,
            margin_v=64,
        ),
        segments=segments,
    )
    return lane, manifest


def _create_black_source(
    source: Path,
    *,
    duration: float,
    width: int,
    height: int,
    fps: int,
) -> None:
    paths = find_ffmpeg(REPO_ROOT)
    run_ffmpeg_sync(
        [
            str(paths.ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=black:s={width}x{height}:r={fps}:d={duration:.6f}",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "28",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(source),
        ]
    )


def main() -> int:
    args = _arguments()
    if args.seconds_per_effect <= 0:
        raise ValueError("seconds-per-effect must be positive")
    if args.width <= 0 or args.height <= 0 or args.fps <= 0:
        raise ValueError("width, height, and fps must be positive")

    catalog = get_effect_catalog()
    effects = catalog.get("effects")
    if not isinstance(effects, list) or len(effects) != 97:
        raise RuntimeError("ASS Lyric Effects v3 catalog must contain exactly 97 effects")
    stable_ids = [effect.get("effect_id") for effect in effects if isinstance(effect, dict)]
    if len(stable_ids) != 97 or len(set(stable_ids)) != 97:
        raise RuntimeError("catalog effect IDs must be 97 unique stable IDs")

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    total_duration = len(effects) * args.seconds_per_effect
    source = output_dir / "all-effects-black-source.mp4"
    lane, entries = _build_lane(effects, seconds_per_effect=args.seconds_per_effect)

    print(
        f"Creating {total_duration:.3f}s black source "
        f"({args.width}x{args.height}, {args.fps}fps)...",
        flush=True,
    )
    _create_black_source(
        source,
        duration=total_duration,
        width=args.width,
        height=args.height,
        fps=args.fps,
    )

    last_percent = -1

    def report(progress: float, message: str) -> None:
        nonlocal last_percent
        percent = int(progress * 100)
        if percent >= last_percent + 5 or percent == 100:
            last_percent = percent
            print(f"[{percent:3d}%] {message}", flush=True)

    result = export_subtitle_bundle(
        source,
        output_dir,
        [lane],
        play_res_x=args.width,
        play_res_y=args.height,
        ffmpeg_paths=find_ffmpeg(REPO_ROOT),
        on_progress=report,
    )
    paths = find_ffmpeg(REPO_ROOT)
    video = Path(str(result["video"]))
    actual_duration = probe_duration(paths.ffprobe, video)
    if abs(actual_duration - total_duration) > max(0.25, total_duration * 0.002):
        raise RuntimeError(
            f"output duration mismatch: expected {total_duration:.3f}s, got {actual_duration:.3f}s"
        )

    manifest_path = output_dir / "all-effects-manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "catalog_version": catalog.get("version"),
                "effect_count": len(entries),
                "seconds_per_effect": args.seconds_per_effect,
                "expected_duration_seconds": total_duration,
                "actual_duration_seconds": actual_duration,
                "width": args.width,
                "height": args.height,
                "fps": args.fps,
                "black_source": str(source),
                "video": str(video),
                "ass": result["ass"],
                "effects": entries,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Video: {video}")
    print(f"ASS: {result['ass']}")
    print(f"Manifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

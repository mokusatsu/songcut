from __future__ import annotations

import argparse
import base64
import json
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def extract_frame(ffmpeg: Path, video: Path, timestamp: float, output: Path) -> None:
    subprocess.run(
        [
            str(ffmpeg),
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{timestamp:.6f}",
            "-i",
            str(video),
            "-frames:v",
            "1",
            "-c:v",
            "png",
            "-pix_fmt",
            "rgb24",
            str(output),
        ],
        check=True,
    )


def weighted_bounds(signal: np.ndarray, low: float = 0.01, high: float = 0.99) -> tuple[int, int, int, int]:
    rows = signal.sum(axis=1)
    columns = signal.sum(axis=0)

    def quantile_bounds(weights: np.ndarray) -> tuple[int, int]:
        cumulative = np.cumsum(weights)
        if cumulative[-1] <= 0:
            return 0, len(weights) - 1
        lower = int(np.searchsorted(cumulative, cumulative[-1] * low))
        upper = int(np.searchsorted(cumulative, cumulative[-1] * high))
        return lower, upper

    top, bottom = quantile_bounds(rows)
    left, right = quantile_bounds(columns)
    return left, top, right, bottom


def weighted_centroid(signal: np.ndarray) -> tuple[float, float]:
    total = float(signal.sum())
    y, x = np.indices(signal.shape)
    return float((x * signal).sum() / total), float((y * signal).sum() / total)


def cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    a = left.ravel().astype(np.float64)
    b = right.ravel().astype(np.float64)
    denominator = math.sqrt(float(a @ a) * float(b @ b))
    return float((a @ b) / denominator) if denominator else 0.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--output-video", required=True, type=Path)
    parser.add_argument("--ffmpeg", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--segment-id")
    args = parser.parse_args()

    project = json.loads(args.project.read_text(encoding="utf-8"))
    segments = [
        segment
        for lane in project["subtitle"]["lanes"]
        for segment in lane["segments"]
        if segment.get("render_cache") and segment.get("source") == "lyrics"
    ]
    segment = (
        next(item for item in segments if item["id"] == args.segment_id)
        if args.segment_id
        else segments[0]
    )
    source = Path(str(args.project).removesuffix(".sub.songcut"))
    timestamp = min(float(segment["end"]) - 0.05, float(segment["start"]) + 0.5)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    source_frame_path = args.output_dir / "source-frame.png"
    output_frame_path = args.output_dir / "output-frame.png"
    overlay_path = args.output_dir / "cached-overlay.png"
    expected_path = args.output_dir / "expected-composite.png"
    comparison_path = args.output_dir / "comparison.png"
    metrics_path = args.output_dir / "metrics.json"

    extract_frame(args.ffmpeg, source, timestamp, source_frame_path)
    extract_frame(args.ffmpeg, args.output_video, timestamp, output_frame_path)
    overlay_path.write_bytes(base64.b64decode(segment["render_cache"]["png_base64"]))

    source_image = Image.open(source_frame_path).convert("RGBA")
    output_image = Image.open(output_frame_path).convert("RGB")
    overlay_image = Image.open(overlay_path).convert("RGBA")
    if source_image.size != overlay_image.size or source_image.size != output_image.size:
        raise RuntimeError(
            f"frame size mismatch: source={source_image.size}, overlay={overlay_image.size}, output={output_image.size}"
        )
    expected_image = Image.alpha_composite(source_image, overlay_image).convert("RGB")
    expected_image.save(expected_path)

    source_rgb = np.asarray(source_image.convert("RGB"), dtype=np.float32)
    expected_rgb = np.asarray(expected_image, dtype=np.float32)
    output_rgb = np.asarray(output_image, dtype=np.float32)
    alpha = np.asarray(overlay_image.getchannel("A"), dtype=np.float32) / 255.0
    alpha_points = np.argwhere(alpha > 0.01)
    top, left = alpha_points.min(axis=0)
    bottom, right = alpha_points.max(axis=0)
    padding = 32
    roi_left = max(0, int(left) - padding)
    roi_top = max(0, int(top) - padding)
    roi_right = min(source_image.width - 1, int(right) + padding)
    roi_bottom = min(source_image.height - 1, int(bottom) + padding)
    roi = np.s_[roi_top : roi_bottom + 1, roi_left : roi_right + 1]

    expected_effect = np.sqrt(np.mean((expected_rgb - source_rgb) ** 2, axis=2))[roi]
    actual_effect = np.sqrt(np.mean((output_rgb - source_rgb) ** 2, axis=2))[roi]
    outside = np.ones(alpha.shape, dtype=bool)
    outside[roi] = False
    artifact_floor = float(np.percentile(np.sqrt(np.mean((output_rgb - source_rgb) ** 2, axis=2))[outside], 95))
    expected_signal = expected_effect**2
    actual_signal = np.maximum(actual_effect - artifact_floor, 0.0) ** 2

    expected_bounds_local = weighted_bounds(expected_signal)
    actual_bounds_local = weighted_bounds(actual_signal)
    expected_centroid_local = weighted_centroid(expected_signal)
    actual_centroid_local = weighted_centroid(actual_signal)

    def global_bounds(bounds: tuple[int, int, int, int]) -> dict[str, int]:
        x1, y1, x2, y2 = bounds
        return {
            "left": x1 + roi_left,
            "top": y1 + roi_top,
            "right": x2 + roi_left,
            "bottom": y2 + roi_top,
            "width": x2 - x1 + 1,
            "height": y2 - y1 + 1,
        }

    expected_bounds = global_bounds(expected_bounds_local)
    actual_bounds = global_bounds(actual_bounds_local)
    expected_centroid = {
        "x": expected_centroid_local[0] + roi_left,
        "y": expected_centroid_local[1] + roi_top,
    }
    actual_centroid = {
        "x": actual_centroid_local[0] + roi_left,
        "y": actual_centroid_local[1] + roi_top,
    }
    expected_roi = expected_rgb[roi]
    output_roi = output_rgb[roi]
    source_roi = source_rgb[roi]
    composite_mae = float(np.mean(np.abs(expected_roi - output_roi)))
    source_mae = float(np.mean(np.abs(source_roi - output_roi)))
    composite_mse = float(np.mean((expected_roi - output_roi) ** 2))
    psnr = float(20 * math.log10(255.0 / math.sqrt(composite_mse))) if composite_mse else float("inf")
    metrics = {
        "segment_id": segment["id"],
        "text": segment["text"],
        "timestamp_seconds": timestamp,
        "frame_size": {"width": source_image.width, "height": source_image.height},
        "alpha_bbox": {
            "left": int(left),
            "top": int(top),
            "right": int(right),
            "bottom": int(bottom),
            "width": int(right - left + 1),
            "height": int(bottom - top + 1),
        },
        "expected_effect_bbox_98_percent": expected_bounds,
        "actual_effect_bbox_98_percent": actual_bounds,
        "centroid": {
            "expected": expected_centroid,
            "actual": actual_centroid,
            "delta_pixels": {
                "x": actual_centroid["x"] - expected_centroid["x"],
                "y": actual_centroid["y"] - expected_centroid["y"],
            },
        },
        "size_ratio": {
            "width": actual_bounds["width"] / expected_bounds["width"],
            "height": actual_bounds["height"] / expected_bounds["height"],
        },
        "effect_cosine_similarity": cosine_similarity(expected_signal, actual_signal),
        "roi_composite_mae": composite_mae,
        "roi_source_mae": source_mae,
        "composite_improvement_ratio": source_mae / composite_mae,
        "roi_composite_psnr_db": psnr,
        "estimated_compression_artifact_floor": artifact_floor,
    }
    metrics_path.write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")

    scale = 0.5
    panels = []
    for label, image in [
        ("Source", source_image.convert("RGB")),
        ("Expected: source + cached PNG", expected_image),
        ("Exported video", output_image),
    ]:
        panel = image.resize((int(image.width * scale), int(image.height * scale)), Image.Resampling.LANCZOS)
        draw = ImageDraw.Draw(panel)
        draw.rectangle(
            (
                int(roi_left * scale),
                int(roi_top * scale),
                int(roi_right * scale),
                int(roi_bottom * scale),
            ),
            outline=(255, 64, 64),
            width=2,
        )
        draw.rectangle((0, 0, panel.width, 28), fill=(0, 0, 0))
        draw.text((8, 7), label, fill=(255, 255, 255))
        panels.append(panel)
    comparison = Image.new("RGB", (sum(panel.width for panel in panels), panels[0].height))
    x = 0
    for panel in panels:
        comparison.paste(panel, (x, 0))
        x += panel.width
    comparison.save(comparison_path)
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

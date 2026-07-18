from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class FfmpegPaths:
    ffmpeg: Path
    ffprobe: Path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _candidate_dirs(root: Path | None = None) -> Iterable[Path]:
    env_dir = os.environ.get("SONGCUT_FFMPEG_DIR")
    if env_dir:
        env_path = Path(env_dir)
        yield env_path
        yield env_path / "bin"

    base = root or repo_root()
    yield base / "third_party" / "ffmpeg" / "bin"
    yield base / "third_party" / "ffmpeg"


def find_ffmpeg(root: Path | None = None) -> FfmpegPaths:
    for directory in _candidate_dirs(root):
        ffmpeg = directory / "ffmpeg.exe"
        ffprobe = directory / "ffprobe.exe"
        if ffmpeg.exists() and ffprobe.exists():
            return FfmpegPaths(ffmpeg=ffmpeg, ffprobe=ffprobe)

    ffmpeg_on_path = shutil.which("ffmpeg")
    ffprobe_on_path = shutil.which("ffprobe")
    if ffmpeg_on_path and ffprobe_on_path:
        return FfmpegPaths(ffmpeg=Path(ffmpeg_on_path), ffprobe=Path(ffprobe_on_path))

    searched = ", ".join(str(path) for path in _candidate_dirs(root))
    raise FileNotFoundError(
        "ffmpeg.exe and ffprobe.exe were not found. Put them under "
        f"third_party/ffmpeg/bin or set SONGCUT_FFMPEG_DIR. Searched: {searched}"
    )


def ffprobe_json(ffprobe: Path, source: Path, extra_args: list[str]) -> dict:
    command = [str(ffprobe), "-v", "error", *extra_args, "-of", "json", str(source)]
    result = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(result.stdout or "{}")


def probe_duration(ffprobe: Path, source: Path) -> float:
    data = ffprobe_json(ffprobe, source, ["-show_entries", "format=duration"])
    return float(data.get("format", {}).get("duration", 0.0))


def probe_format_tags(ffprobe: Path, source: Path) -> dict[str, str]:
    data = ffprobe_json(ffprobe, source, ["-show_entries", "format_tags"])
    tags = data.get("format", {}).get("tags", {})
    return {str(key): str(value) for key, value in tags.items()}


def read_pcm_s16le(
    ffmpeg: Path,
    source: Path,
    *,
    sample_rate: int = 16000,
    channels: int = 2,
) -> bytes:
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-vn",
        "-ac",
        str(channels),
        "-ar",
        str(sample_rate),
        "-f",
        "s16le",
        "pipe:1",
    ]
    result = subprocess.run(command, check=True, capture_output=True)
    return result.stdout


def export_clip(
    ffmpeg: Path,
    source: Path,
    target: Path,
    *,
    start: float,
    end: float,
    mode: str = "accurate",
) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    duration = max(0.0, end - start)
    if mode == "copy":
        codec_args = ["-c", "copy"]
    else:
        codec_args = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k"]

    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
        *codec_args,
        str(target),
    ]
    subprocess.run(command, check=True)

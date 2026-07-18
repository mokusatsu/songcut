from __future__ import annotations

import json
import shutil
import sys
import win_safesubprocess as subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FfmpegPaths:
    ffmpeg: Path
    ffprobe: Path


CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _search_root(root: Path | None = None) -> Path:
    if root is not None:
        return root
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return repo_root()


def _paired_tools(directory: Path) -> FfmpegPaths | None:
    ffmpeg = directory / "ffmpeg.exe"
    ffprobe = directory / "ffprobe.exe"
    if ffmpeg.exists() and ffprobe.exists():
        return FfmpegPaths(ffmpeg=ffmpeg, ffprobe=ffprobe)
    return None


def _recursive_ffmpeg(root: Path) -> FfmpegPaths | None:
    common_dirs = [
        root / "third_party" / "ffmpeg" / "bin",
        root / "third_party" / "ffmpeg",
    ]
    seen: set[Path] = set()
    for directory in common_dirs:
        resolved = directory.resolve() if directory.exists() else directory
        seen.add(resolved)
        paths = _paired_tools(directory)
        if paths:
            return paths

    if not root.exists():
        return None

    for ffmpeg in sorted(root.rglob("ffmpeg.exe")):
        directory = ffmpeg.parent
        resolved = directory.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        paths = _paired_tools(directory)
        if paths:
            return paths
    return None


def find_ffmpeg(root: Path | None = None) -> FfmpegPaths:
    search_root = _search_root(root)
    bundled = _recursive_ffmpeg(search_root)
    if bundled:
        return bundled

    ffmpeg_on_path = shutil.which("ffmpeg")
    ffprobe_on_path = shutil.which("ffprobe")
    if ffmpeg_on_path and ffprobe_on_path:
        return FfmpegPaths(ffmpeg=Path(ffmpeg_on_path), ffprobe=Path(ffprobe_on_path))

    raise FileNotFoundError(
        "ffmpeg.exe and ffprobe.exe were not found. Searched recursively under "
        f"{search_root} first, then searched PATH."
    )


def ffprobe_json(ffprobe: Path, source: Path, extra_args: list[str]) -> dict:
    command = [str(ffprobe), "-v", "error", *extra_args, "-of", "json", str(source)]
    result = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8", creationflags=CREATE_NO_WINDOW)
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
    result = subprocess.run(command, check=True, capture_output=True, creationflags=CREATE_NO_WINDOW)
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
    subprocess.run(command, check=True, creationflags=CREATE_NO_WINDOW)

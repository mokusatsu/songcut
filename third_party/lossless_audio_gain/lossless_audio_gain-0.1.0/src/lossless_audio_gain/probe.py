"""Codec/container detection without decoding audio."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

try:
    import win_safesubprocess as subprocess
except ImportError:  # pragma: no cover - non-Windows or win_safesubprocess absent
    import subprocess

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

from .exceptions import (
    DependencyNotFoundError,
    InvalidMediaError,
    UnsupportedFormatError,
)
from .models import MediaInfo
from .opus import inspect_ogg_opus

_MP4_FORMAT_NAMES = {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"}
_AAC_LC_PROFILES = {"lc", "aac lc", "low complexity"}


def _is_ogg_opus(path: Path) -> bool:
    with path.open("rb") as stream:
        prefix = stream.read(1024 * 1024)
    return prefix.startswith(b"OggS") and b"OpusHead" in prefix


def _resolve_ffprobe(ffprobe_bin: str) -> str:
    candidate = Path(ffprobe_bin)
    if candidate.is_absolute() or candidate.parent != Path("."):
        if candidate.is_file():
            return str(candidate)
        raise DependencyNotFoundError(f"ffprobe executable was not found: {ffprobe_bin}")
    resolved = shutil.which(ffprobe_bin)
    if resolved is None:
        raise DependencyNotFoundError(
            "AAC inspection requires ffprobe. Install FFmpeg/ffprobe or pass "
            "ffprobe_bin/--ffprobe explicitly."
        )
    return resolved


def _ffprobe_media(path: Path, ffprobe_bin: str) -> MediaInfo:
    ffprobe = _resolve_ffprobe(ffprobe_bin)
    completed = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_name,profile,index,channels:format=format_name",
            "-of",
            "json",
            str(path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        creationflags=CREATE_NO_WINDOW,
    )
    if completed.returncode != 0:
        raise InvalidMediaError(
            f"ffprobe could not inspect {path}:\n{completed.stderr[-2000:]}"
        )
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise InvalidMediaError("ffprobe returned invalid JSON") from exc

    streams = payload.get("streams") or []
    if not streams:
        raise UnsupportedFormatError("No audio stream was found")
    if len(streams) != 1:
        raise UnsupportedFormatError(
            f"Exactly one audio stream is required; detected {len(streams)}"
        )

    stream = streams[0]
    codec = str(stream.get("codec_name", "")).lower()
    container = str((payload.get("format") or {}).get("format_name", "unknown"))
    container_tokens = {part.strip().lower() for part in container.split(",")}

    if codec != "aac":
        raise UnsupportedFormatError(
            f"Only Ogg Opus or AAC-LC in MP4 is supported; detected codec {codec!r}"
        )
    if not (container_tokens & _MP4_FORMAT_NAMES):
        raise UnsupportedFormatError(
            f"Raw/ADTS AAC is not supported; detected container {container!r}"
        )

    try:
        channels = int(stream.get("channels"))
    except (TypeError, ValueError) as exc:
        raise UnsupportedFormatError("ffprobe did not report a valid AAC channel count") from exc
    if channels not in {1, 2}:
        raise UnsupportedFormatError(
            "Only mono or stereo AAC-LC is supported safely; "
            f"ffprobe reported {channels} channels"
        )

    profile = str(stream.get("profile") or "").strip() or None
    if profile is None or profile.lower() not in _AAC_LC_PROFILES:
        raise UnsupportedFormatError(
            "Only AAC-LC is supported safely; "
            f"ffprobe reported profile {profile or 'unknown'!r}"
        )
    return MediaInfo("aac", container, profile, 1, channels)


def detect_media(
    input_path: str | Path,
    *,
    ffprobe_bin: str = "ffprobe",
) -> MediaInfo:
    """Detect and validate a supported input without decoding audio."""

    path = Path(input_path)
    if not path.is_file():
        raise FileNotFoundError(path)
    if _is_ogg_opus(path):
        details = inspect_ogg_opus(path)
        streams = int(details["streams"])
        logical_streams = int(details.get("logical_streams", streams))
        if streams != 1 or logical_streams != 1:
            raise UnsupportedFormatError(
                "Exactly one Ogg Opus logical stream and no multiplexed logical "
                f"streams are required; detected {logical_streams} logical stream(s)"
            )
        channel_counts = details.get("channel_counts")
        channels = (
            int(channel_counts[0])
            if isinstance(channel_counts, list) and len(channel_counts) == 1
            else None
        )
        return MediaInfo("opus", "ogg", None, streams, channels)
    return _ffprobe_media(path, ffprobe_bin)

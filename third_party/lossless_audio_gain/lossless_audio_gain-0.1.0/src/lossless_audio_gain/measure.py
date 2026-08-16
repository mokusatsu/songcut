"""Decoded-audio measurement and verification using FFmpeg."""

from __future__ import annotations

import json
import math
import re
import shutil
from pathlib import Path

try:
    import win_safesubprocess as subprocess
except ImportError:  # pragma: no cover - non-Windows or win_safesubprocess absent
    import subprocess

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

from .exceptions import (
    DependencyNotFoundError,
    MeasurementError,
    VerificationError,
)

_JSON_BLOCK_RE = re.compile(r"\{\s*\"input_i\"\s*:.*?\}", re.DOTALL)
_APSNR_RE = re.compile(
    r"PSNR\s+ch(?P<channel>\d+):\s*(?P<value>[+-]?(?:inf|nan|\d+(?:\.\d+)?))\s*dB",
    re.IGNORECASE,
)


def _resolve_executable(name_or_path: str, friendly_name: str) -> str:
    candidate = Path(name_or_path)
    if candidate.parent != Path(".") or candidate.is_absolute():
        if candidate.is_file():
            return str(candidate)
        raise DependencyNotFoundError(
            f"{friendly_name} executable was not found: {name_or_path}"
        )
    resolved = shutil.which(name_or_path)
    if resolved is None:
        raise DependencyNotFoundError(
            f"{friendly_name} executable was not found on PATH: {name_or_path}"
        )
    return resolved


def parse_loudnorm_json(stderr: str) -> dict[str, str]:
    """Extract the last loudnorm JSON report from FFmpeg stderr."""

    for match in reversed(_JSON_BLOCK_RE.findall(stderr)):
        try:
            value = json.loads(match)
        except json.JSONDecodeError:
            continue
        if "input_tp" in value:
            return value
    raise MeasurementError("FFmpeg output did not contain loudnorm input_tp JSON")


def _parse_db_value(value: object, field_name: str) -> float:
    try:
        result = float(str(value))
    except (TypeError, ValueError) as exc:
        raise MeasurementError(f"Invalid {field_name} value from FFmpeg: {value!r}") from exc
    if math.isnan(result):
        raise MeasurementError(f"FFmpeg returned NaN for {field_name}")
    return result


def measure_true_peak(
    input_path: str | Path,
    *,
    ffmpeg_bin: str = "ffmpeg",
    audio_stream: int = 0,
) -> float:
    """Measure maximum decoded true peak in dBTP.

    The source file itself is never modified. FFmpeg decodes the selected audio
    stream and performs a loudnorm analysis pass; only ``input_tp`` is used.
    """

    path = Path(input_path)
    if not path.is_file():
        raise FileNotFoundError(path)
    ffmpeg = _resolve_executable(ffmpeg_bin, "FFmpeg")
    command = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-nostats",
        "-v",
        "info",
        "-i",
        str(path),
        "-map",
        f"0:a:{audio_stream}",
        "-vn",
        "-sn",
        "-dn",
        "-af",
        "loudnorm=I=-24:LRA=7:TP=-1:print_format=json",
        "-f",
        "null",
        "-",
    ]
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
        creationflags=CREATE_NO_WINDOW,
    )
    if completed.returncode != 0:
        tail = completed.stderr[-4000:]
        raise MeasurementError(
            f"FFmpeg true-peak measurement failed with exit code "
            f"{completed.returncode}:\n{tail}"
        )
    report = parse_loudnorm_json(completed.stderr)
    return _parse_db_value(report["input_tp"], "input_tp")


def parse_apsnr(stderr: str) -> list[float]:
    """Extract one APSNR value per channel from FFmpeg log output."""

    values: dict[int, float] = {}
    for match in _APSNR_RE.finditer(stderr):
        channel = int(match.group("channel"))
        raw = match.group("value").lower()
        try:
            value = float(raw)
        except ValueError as exc:
            raise MeasurementError(f"Invalid APSNR value from FFmpeg: {raw!r}") from exc
        values[channel] = value
    if not values:
        raise MeasurementError("FFmpeg output did not contain APSNR channel results")
    return [values[index] for index in sorted(values)]


def verify_decoded_gain(
    input_path: str | Path,
    output_path: str | Path,
    *,
    expected_gain_db: float,
    ffmpeg_bin: str = "ffmpeg",
    minimum_psnr_db: float = 90.0,
) -> tuple[float, ...]:
    """Verify that decoded output equals decoded input times the expected gain.

    FFmpeg decodes both files to planar double precision. The reference input is
    multiplied by the exact linear gain, then the ``apsnr`` filter compares it
    with the decoded output. Infinite PSNR is an exact match; finite values must
    meet ``minimum_psnr_db`` on every channel.
    """

    source = Path(input_path)
    destination = Path(output_path)
    if not source.is_file():
        raise FileNotFoundError(source)
    if not destination.is_file():
        raise FileNotFoundError(destination)
    if not math.isfinite(expected_gain_db):
        raise ValueError("expected_gain_db must be finite")
    if not math.isfinite(minimum_psnr_db) or minimum_psnr_db <= 0:
        raise ValueError("minimum_psnr_db must be finite and positive")

    ffmpeg = _resolve_executable(ffmpeg_bin, "FFmpeg")
    linear_gain = 10.0 ** (expected_gain_db / 20.0)
    filter_graph = (
        f"[0:a:0]volume={linear_gain:.17g}:precision=double,"
        "aformat=sample_fmts=dblp[reference];"
        "[1:a:0]aformat=sample_fmts=dblp[test];"
        "[reference][test]apsnr"
    )
    completed = subprocess.run(
        [
            ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-nostats",
            "-v",
            "info",
            "-i",
            str(source),
            "-i",
            str(destination),
            "-filter_complex",
            filter_graph,
            "-f",
            "null",
            "-",
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
        raise MeasurementError(
            f"FFmpeg decoded-gain verification failed with exit code "
            f"{completed.returncode}:\n{completed.stderr[-4000:]}"
        )

    psnr_values = parse_apsnr(completed.stderr)
    failed = [
        (channel, value)
        for channel, value in enumerate(psnr_values)
        if math.isnan(value) or value < minimum_psnr_db
    ]
    if failed:
        description = ", ".join(
            f"ch{channel}={value:.2f} dB" for channel, value in failed
        )
        raise VerificationError(
            "Decoded output is not a uniform application of the requested gain; "
            f"APSNR below {minimum_psnr_db:.1f} dB ({description})"
        )
    return tuple(psnr_values)

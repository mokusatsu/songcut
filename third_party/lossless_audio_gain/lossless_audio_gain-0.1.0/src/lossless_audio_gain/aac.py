"""AAC-LC ``global_gain`` backend powered by the external mp3rgain CLI."""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import struct
import tempfile
from pathlib import Path
from typing import Any, Literal

try:
    import win_safesubprocess as subprocess
except ImportError:  # pragma: no cover - non-Windows or win_safesubprocess absent
    import subprocess

CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

from .exceptions import (
    BackendError,
    DependencyNotFoundError,
    GainRangeError,
    InvalidMediaError,
)

# AAC scalefactors are powers of 2^(n/4), so one global_gain step is exact:
# 20*log10(2^(1/4)) = 1.505149978... dB. mp3rgain's user-facing output
# conventionally rounds this to 1.5 dB.
AAC_GAIN_STEP_DB = 20.0 * math.log10(2.0 ** 0.25)
AacRounding = Literal["nearest", "not_above", "toward_zero"]


def quantize_aac_gain(
    requested_gain_db: float,
    *,
    rounding: AacRounding = "nearest",
) -> tuple[int, float]:
    """Convert a dB request to integer AAC ``global_gain`` steps."""

    if not math.isfinite(requested_gain_db):
        raise ValueError("requested_gain_db must be finite")
    units = requested_gain_db / AAC_GAIN_STEP_DB
    if rounding == "not_above":
        steps = math.floor(units + 1e-12)
    elif rounding == "toward_zero":
        steps = math.trunc(units)
    elif rounding == "nearest":
        if units >= 0:
            steps = math.floor(units + 0.5)
        else:
            steps = math.ceil(units - 0.5)
    else:
        raise ValueError(f"Unknown AAC rounding mode: {rounding}")
    if steps < -255 or steps > 255:
        raise GainRangeError(
            f"Requested AAC gain {requested_gain_db:.6f} dB needs {steps} "
            "global_gain steps, outside the representable 8-bit span"
        )
    return int(steps), int(steps) * AAC_GAIN_STEP_DB


def resolve_mp3rgain(executable: str | None = None) -> str:
    """Resolve the AAC backend from an explicit path, env var, or PATH."""

    candidate = executable or os.environ.get("MP3RGAIN_BIN") or "mp3rgain"
    path = Path(candidate)
    if path.is_absolute() or path.parent != Path("."):
        if path.is_file():
            return str(path)
        raise DependencyNotFoundError(f"mp3rgain executable was not found: {candidate}")
    resolved = shutil.which(candidate)
    if resolved is None:
        raise DependencyNotFoundError(
            "AAC modification requires mp3rgain. Install it and place the "
            "'mp3rgain' executable on PATH, or set MP3RGAIN_BIN."
        )
    return resolved


def _read_exact(stream: Any, size: int, context: str) -> bytes:
    data = stream.read(size)
    if len(data) != size:
        raise InvalidMediaError(f"Truncated MP4 while reading {context}")
    return data


def hash_mp4_mdat(path: str | Path) -> tuple[str, int, int]:
    """Hash all top-level MP4 ``mdat`` payloads, independent of box offsets.

    The hash is used for a forward/inverse AAC gain round-trip check. Metadata
    boxes may be rewritten by mp3rgain, so comparing the whole file would be
    too strict; the compressed media payload must nevertheless return exactly.
    """

    target = Path(path)
    file_size = target.stat().st_size
    digest = hashlib.sha256()
    mdat_count = 0
    payload_total = 0
    cursor = 0

    with target.open("rb") as stream:
        while cursor < file_size:
            stream.seek(cursor)
            header = _read_exact(stream, 8, "box header")
            size32, box_type = struct.unpack(">I4s", header)
            header_size = 8
            if size32 == 1:
                box_size = struct.unpack(">Q", _read_exact(stream, 8, "extended box size"))[0]
                header_size = 16
            elif size32 == 0:
                box_size = file_size - cursor
            else:
                box_size = size32

            if box_size < header_size:
                raise InvalidMediaError(
                    f"Invalid MP4 box size {box_size} for {box_type!r} at byte {cursor}"
                )
            box_end = cursor + box_size
            if box_end > file_size:
                raise InvalidMediaError(
                    f"MP4 box {box_type!r} at byte {cursor} extends beyond EOF"
                )

            payload_size = box_size - header_size
            if box_type == b"mdat":
                mdat_count += 1
                payload_total += payload_size
                digest.update(struct.pack(">Q", payload_size))
                remaining = payload_size
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise InvalidMediaError("Truncated MP4 mdat payload")
                    digest.update(chunk)
                    remaining -= len(chunk)
            cursor = box_end

    if cursor != file_size:
        raise InvalidMediaError("MP4 box traversal did not end at EOF")
    if mdat_count == 0:
        raise InvalidMediaError("MP4 file contains no top-level mdat box")
    return digest.hexdigest(), mdat_count, payload_total


def _parse_backend_json(stdout: str) -> dict[str, Any]:
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise BackendError(
            "mp3rgain did not return valid JSON. Version 3.2.0 or newer is "
            f"recommended. Output:\n{stdout[-3000:]}"
        ) from exc
    if not isinstance(payload, dict):
        raise BackendError("mp3rgain JSON root is not an object")
    files = payload.get("files")
    if not isinstance(files, list) or len(files) != 1 or not isinstance(files[0], dict):
        raise BackendError(
            "mp3rgain JSON did not contain exactly one per-file result"
        )
    return files[0]


def _run_mp3rgain(
    target: Path,
    *,
    steps: int,
    backend: str,
    write_undo: bool,
) -> dict[str, Any]:
    command = [backend, "-g", str(steps), "-k", "-o", "json"]
    if not write_undo:
        command.extend(["-s", "s"])
    command.append(str(target))
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
        raise BackendError(
            f"mp3rgain failed with exit code {completed.returncode}:\n"
            f"{completed.stdout[-3000:]}\n{completed.stderr[-3000:]}"
        )

    record = _parse_backend_json(completed.stdout)
    status = str(record.get("status", "")).lower()
    if status != "success" or record.get("error"):
        raise BackendError(
            f"mp3rgain reported failure: {record.get('error') or status or record}"
        )
    warning = record.get("warning")
    if warning:
        raise BackendError(
            "mp3rgain reported a warning; refusing a potentially clipped or "
            f"partial gain change: {warning}"
        )
    if "warning" in completed.stderr.lower():
        raise BackendError(
            "mp3rgain wrote a warning to stderr; refusing the result:\n"
            f"{completed.stderr[-3000:]}"
        )

    try:
        actual_steps = int(record["gain_applied_steps"])
    except (KeyError, TypeError, ValueError) as exc:
        raise BackendError(
            "mp3rgain JSON omitted gain_applied_steps; cannot verify the exact change"
        ) from exc
    if actual_steps != steps:
        raise BackendError(
            "mp3rgain could not apply the requested AAC gain without reaching "
            f"a global_gain boundary: requested {steps} step(s), applied {actual_steps}"
        )
    try:
        modified = int(record["frames"])
    except (KeyError, TypeError, ValueError) as exc:
        raise BackendError(
            "mp3rgain JSON omitted the AAC modified-field count; cannot verify "
            "that a non-zero gain changed the bitstream"
        ) from exc
    if modified <= 0:
        raise BackendError(
            "mp3rgain reported zero modified AAC gain fields for a non-zero "
            "request; refusing to claim that the gain was applied"
        )
    record["frames"] = modified
    record["stdout"] = completed.stdout
    record["stderr"] = completed.stderr
    return record


def apply_aac_global_gain(
    path: str | Path,
    *,
    steps: int,
    mp3rgain_bin: str | None = None,
    write_undo: bool = True,
    check_reversible: bool = True,
) -> dict[str, object]:
    """Apply integer AAC ``global_gain`` steps atomically using mp3rgain.

    The caller-visible file is replaced only after every requested check has
    succeeded. By default, a forward/inverse operation on a disposable copy
    must restore every top-level MP4 ``mdat`` payload byte-for-byte. This
    catches 0/255 ``global_gain`` saturation, for which an inverse step could
    not recover the original compressed bitstream.
    """

    target = Path(path)
    if not target.is_file():
        raise FileNotFoundError(target)
    if not isinstance(steps, int):
        raise TypeError("steps must be an integer")
    if steps == 0:
        return {
            "steps": 0,
            "nominal_tool_db": 0.0,
            "exact_gain_db": 0.0,
            "modified_gain_fields": 0,
            "reversibility_checked": False,
            "write_undo": write_undo,
            "stdout": "",
            "stderr": "",
        }

    backend = resolve_mp3rgain(mp3rgain_bin)
    original_hash = hash_mp4_mdat(target) if check_reversible else None

    # Work on a sibling copy so a backend failure, a saturation finding, or a
    # process interruption before commit never leaves the caller's file in a
    # knowingly rejected state. A .m4a suffix also accommodates tools that use
    # the extension as a secondary format hint.
    handle, work_name = tempfile.mkstemp(
        prefix=f".{target.name}.gain-work.", suffix=".m4a", dir=target.parent
    )
    os.close(handle)
    work_path = Path(work_name)
    reverse_path: Path | None = None
    try:
        shutil.copy2(target, work_path)
        record = _run_mp3rgain(
            work_path,
            steps=steps,
            backend=backend,
            write_undo=write_undo,
        )

        if check_reversible and original_hash is not None:
            reverse_handle, reverse_name = tempfile.mkstemp(
                prefix=f".{target.name}.reverse-check.",
                suffix=".m4a",
                dir=target.parent,
            )
            os.close(reverse_handle)
            reverse_path = Path(reverse_name)
            shutil.copy2(work_path, reverse_path)
            _run_mp3rgain(
                reverse_path,
                steps=-steps,
                backend=backend,
                write_undo=False,
            )
            restored_hash = hash_mp4_mdat(reverse_path)
            if restored_hash != original_hash:
                raise BackendError(
                    "AAC global_gain round-trip did not restore the original mdat "
                    "payload. A gain field likely saturated at 0 or 255; refusing "
                    "to accept the change as lossless."
                )

        with work_path.open("rb+") as stream:
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(work_path, target)
    finally:
        work_path.unlink(missing_ok=True)
        if reverse_path is not None:
            reverse_path.unlink(missing_ok=True)

    modified = int(record["frames"])
    return {
        "steps": steps,
        "nominal_tool_db": steps * 1.5,
        "exact_gain_db": steps * AAC_GAIN_STEP_DB,
        "modified_gain_fields": modified,
        "reversibility_checked": check_reversible,
        "write_undo": write_undo,
        "stdout": record.get("stdout", ""),
        "stderr": record.get("stderr", ""),
    }


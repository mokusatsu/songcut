"""Low-level FFmpeg process helpers shared by export modes.

The export modules intentionally keep their own command construction, progress
semantics, and output validation.  This module only owns the process boundary:
Windows console suppression, UTF-8 replacement decoding, bounded diagnostics,
and exit-code handling for synchronous and streaming invocations.
"""

from __future__ import annotations

import subprocess as _stdlib_subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import win_safesubprocess as subprocess


CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
DEFAULT_TAIL_LINES = 30


@dataclass(frozen=True)
class FfmpegStreamResult:
    """Summary returned after a streaming FFmpeg process exits successfully."""

    command: tuple[str, ...]
    returncode: int
    output_tail: tuple[str, ...]


class FfmpegProcessError(RuntimeError):
    """Raised when a streaming FFmpeg process exits with a non-zero status."""

    def __init__(
        self,
        command: Sequence[str],
        returncode: int,
        output_tail: Sequence[str] = (),
    ) -> None:
        self.command = tuple(str(item) for item in command)
        self.returncode = int(returncode)
        self.output_tail = tuple(str(item) for item in output_tail if str(item).strip())
        detail = "\n".join(self.output_tail)
        message = f"FFmpeg command failed with exit code {self.returncode}: {list(self.command)}"
        if detail:
            message += f"\noutput tail:\n{detail}"
        super().__init__(message)


def run_ffmpeg_sync(
    command: Sequence[str],
    *,
    process_module: Any = subprocess,
    tail_lines: int = DEFAULT_TAIL_LINES,
) -> Any:
    """Run one FFmpeg command synchronously with UTF-8 diagnostics.

    ``CalledProcessError`` is deliberately re-raised unchanged so smart export
    can retain its existing fallback contract.  A bounded decoded tail is
    attached as ``ffmpeg_output_tail`` for callers that need a common failure
    diagnostic without changing the standard exception type.
    """

    command_list = [str(item) for item in command]
    flags = getattr(process_module, "CREATE_NO_WINDOW", CREATE_NO_WINDOW)
    try:
        return process_module.run(
            command_list,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=flags,
        )
    except _called_process_error(process_module) as exc:
        output_tail = _collect_process_output_tail(
            getattr(exc, "stdout", None),
            getattr(exc, "stderr", None),
            tail_lines=tail_lines,
        )
        try:
            setattr(exc, "ffmpeg_output_tail", output_tail)
        except Exception:
            # Third-party process wrappers may expose a read-only exception;
            # the original CalledProcessError remains the source of truth.
            pass
        raise


def run_ffmpeg_stream(
    command: Sequence[str],
    *,
    on_line: Callable[[str], None] | None = None,
    process_module: Any = subprocess,
    tail_lines: int = DEFAULT_TAIL_LINES,
) -> FfmpegStreamResult:
    """Stream combined FFmpeg stdout/stderr while retaining a bounded tail.

    ``on_line`` is intentionally line-oriented rather than progress-specific;
    subtitle export (and future callers) can parse their own protocol and map
    it to their own progress range.  Synchronous and streaming contracts stay
    separate while sharing process setup and failure diagnostics.
    """

    command_list = [str(item) for item in command]
    flags = getattr(process_module, "CREATE_NO_WINDOW", CREATE_NO_WINDOW)
    process = process_module.Popen(
        command_list,
        stdin=process_module.DEVNULL,
        stdout=process_module.PIPE,
        stderr=process_module.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=flags,
    )
    output_tail: list[str] = []
    if process.stdout is not None:
        for raw_line in process.stdout:
            line = _decode_line(raw_line).strip()
            if line:
                output_tail.append(line)
                limit = max(0, int(tail_lines))
                if limit:
                    del output_tail[:-limit]
                else:
                    output_tail.clear()
            if on_line is not None:
                on_line(line)
    return_code = int(process.wait())
    if return_code != 0:
        raise FfmpegProcessError(command_list, return_code, output_tail)
    return FfmpegStreamResult(tuple(command_list), return_code, tuple(output_tail))


def _called_process_error(process_module: Any) -> type[BaseException]:
    return getattr(process_module, "CalledProcessError", _stdlib_subprocess.CalledProcessError)


def _decode_line(value: object) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _collect_process_output_tail(*values: object, tail_lines: int) -> tuple[str, ...]:
    lines: list[str] = []
    for value in values:
        if value is None:
            continue
        text = _decode_line(value)
        lines.extend(line.strip() for line in text.splitlines() if line.strip())
    limit = max(0, int(tail_lines))
    return tuple(lines[-limit:] if limit else ())

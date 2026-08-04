from __future__ import annotations

import json
from pathlib import Path

from .models import AlignmentResult


def write_json(result: AlignmentResult, path: str | Path) -> None:
    Path(path).write_text(
        json.dumps(result.to_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _srt_timestamp(value: float) -> str:
    milliseconds = max(0, round(value * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def write_srt(result: AlignmentResult, path: str | Path) -> None:
    chunks = [
        f"{index}\n{_srt_timestamp(line.start)} --> {_srt_timestamp(line.end)}\n{line.text}"
        for index, line in enumerate(result.lines, 1)
    ]
    Path(path).write_text("\n\n".join(chunks) + "\n", encoding="utf-8")


def _lrc_timestamp(value: float) -> str:
    centiseconds = max(0, round(value * 100))
    minutes, remainder = divmod(centiseconds, 6000)
    seconds, centis = divmod(remainder, 100)
    return f"[{minutes:02d}:{seconds:02d}.{centis:02d}]"


def write_lrc(result: AlignmentResult, path: str | Path) -> None:
    Path(path).write_text(
        "".join(f"{_lrc_timestamp(line.start)}{line.text}\n" for line in result.lines),
        encoding="utf-8",
    )

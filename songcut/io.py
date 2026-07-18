from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .timestamps import Segment, format_timecode


def segments_to_dicts(segments: list[Segment]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, segment in enumerate(segments, start=1):
        flags: list[str] = []
        if segment.source == "video-metadata":
            flags.append("authored_timestamp")
        if segment.source == "acoustic-dsp" and segment.confidence < 0.6:
            flags.append("needs_review")
        if segment.duration > 600:
            flags.append("long_candidate")
        rows.append(
            {
                "id": f"seg-{index:03d}",
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "start_timecode": format_timecode(segment.start),
                "end_timecode": format_timecode(segment.end),
                "duration": round(float(segment.duration), 3),
                "confidence": round(float(segment.confidence), 4),
                "source": segment.source,
                "flags": flags,
                "user_edited": False,
            }
        )
    return rows


def write_segments_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_segments_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))

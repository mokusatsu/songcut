from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


TIME_RANGE_RE = re.compile(
    r"(?<!\d)(\d+:\d{2}(?::\d{2})?)\s*(?:[~-]|to)\s*(\d+:\d{2}(?::\d{2})?)(?!\d)"
)


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    confidence: float = 1.0
    source: str = "unknown"

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


def parse_timecode(value: str) -> float:
    parts = [int(part) for part in value.strip().split(":")]
    if len(parts) == 2:
        minutes, seconds = parts
        return float(minutes * 60 + seconds)
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return float(hours * 3600 + minutes * 60 + seconds)
    raise ValueError(f"Unsupported timecode: {value!r}")


def format_timecode(seconds: float) -> str:
    whole = int(round(seconds))
    hours, rem = divmod(whole, 3600)
    minutes, sec = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{sec:02d}"
    return f"{minutes}:{sec:02d}"


def parse_timestamp_text(text: str, *, source: str = "text") -> list[Segment]:
    segments: list[Segment] = []
    for match in TIME_RANGE_RE.finditer(text):
        start = parse_timecode(match.group(1))
        end = parse_timecode(match.group(2))
        if end > start:
            segments.append(Segment(start=start, end=end, confidence=1.0, source=source))
    return merge_duplicate_segments(segments)


def read_timestamp_file(path: Path) -> list[Segment]:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp932", "shift_jis"):
        try:
            return parse_timestamp_text(raw.decode(encoding), source=str(path))
        except UnicodeDecodeError:
            continue
    return parse_timestamp_text(raw.decode("utf-8", errors="ignore"), source=str(path))


def merge_duplicate_segments(segments: list[Segment]) -> list[Segment]:
    seen: set[tuple[int, int]] = set()
    unique: list[Segment] = []
    for segment in segments:
        key = (round(segment.start), round(segment.end))
        if key in seen:
            continue
        seen.add(key)
        unique.append(segment)
    return sorted(unique, key=lambda item: (item.start, item.end))

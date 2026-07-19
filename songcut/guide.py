from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .timestamps import format_timecode, parse_timecode


YOUTUBE_TIMECODE_RE = re.compile(r"(?<!\d)(\d+:\d{2}(?::\d{2})?)(?!\d)")
INVALID_FILENAME_CHARS_RE = re.compile(r'[<>:"|?*\x00-\x1f]')
GUIDE_DECORATION_RE = re.compile(r"^[\s　]*(?:[├└┏┗┣┃│┝┕┠┖┬┴┼─━]+|[-*・･]+)\s*")
FULLWIDTH_DIGIT_TRANS = str.maketrans("０１２３４５６７８９", "0123456789")


@dataclass(frozen=True)
class GuideEntry:
    index: int
    line_number: int
    raw_line: str
    title: str
    timestamps: list[float]

    @property
    def is_explicit_range(self) -> bool:
        return len(self.timestamps) >= 2


@dataclass(frozen=True)
class GuidedExport:
    index: int
    title: str
    filename_stem: str
    start: float
    end: float
    match_source: str
    guide_line_number: int
    guide_line: str
    distance_seconds: float | None = None


def read_guide_file(path: Path) -> list[GuideEntry]:
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp932", "shift_jis"):
        try:
            return parse_guide_text(raw.decode(encoding))
        except UnicodeDecodeError:
            continue
    return parse_guide_text(raw.decode("utf-8", errors="ignore"))


def parse_guide_text(text: str) -> list[GuideEntry]:
    entries: list[GuideEntry] = []
    lines = text.splitlines()
    for line_number, raw_line in enumerate(lines, start=1):
        matches = list(YOUTUBE_TIMECODE_RE.finditer(raw_line))
        if not matches:
            continue
        timestamps = [parse_timecode(match.group(1)) for match in matches]
        title = extract_guide_title(raw_line)
        raw_lines = [raw_line.rstrip()]
        if not is_meaningful_guide_title(title):
            continuation_title, continuation_lines = find_continuation_title(lines[line_number:])
            raw_lines.extend(continuation_lines)
            title = continuation_title
        if not title:
            title = f"guide-{len(entries) + 1:03d}"
        entries.append(
            GuideEntry(
                index=len(entries) + 1,
                line_number=line_number,
                raw_line="\n".join(raw_lines),
                title=title,
                timestamps=timestamps,
            )
        )
    return entries


def extract_guide_title(line: str) -> str:
    without_times = YOUTUBE_TIMECODE_RE.sub(" ", line)
    compact = re.sub(r"\s+", " ", without_times).strip()
    compact = compact.strip(" \t-~:|/")
    compact = re.sub(r"^[0-9０-９]+\s*[\.)．）]\s*", "", compact)
    return clean_guide_title(compact)


def find_continuation_title(lines: list[str]) -> tuple[str, list[str]]:
    consumed: list[str] = []
    for raw_line in lines:
        if YOUTUBE_TIMECODE_RE.search(raw_line):
            break
        consumed.append(raw_line.rstrip())
        candidate = clean_guide_title(raw_line)
        if is_meaningful_guide_title(candidate) and not is_supplemental_guide_title(candidate):
            return candidate, consumed
    return "", consumed


def clean_guide_title(line: str) -> str:
    compact = re.sub(r"\s+", " ", line).strip()
    compact = GUIDE_DECORATION_RE.sub("", compact)
    compact = compact.strip(" \t-~:|/")
    return compact.strip()


def is_meaningful_guide_title(title: str) -> bool:
    normalized = title.strip().translate(FULLWIDTH_DIGIT_TRANS)
    normalized = re.sub(r"^[0-9]+\s*[\.)．）]\s*", "", normalized)
    normalized = re.sub(r"[\s\W_]+", "", normalized, flags=re.UNICODE)
    return bool(normalized)


def is_supplemental_guide_title(title: str) -> bool:
    value = title.strip()
    return (value.startswith("(") and value.endswith(")")) or (value.startswith("（") and value.endswith("）"))


def safe_filename_stem(title: str, *, fallback: str = "clip", max_length: int = 120) -> str:
    value = title.replace("/", " - ").replace("\\", " - ")
    value = INVALID_FILENAME_CHARS_RE.sub("", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    if not value:
        value = fallback
    if len(value) > max_length:
        value = value[:max_length].rstrip(" .")
    return value or fallback


def build_guided_exports(
    entries: list[GuideEntry],
    segment_items: list[dict[str, Any]],
    *,
    max_distance_seconds: float = 90.0,
    numbered_filenames: bool = True,
) -> list[GuidedExport]:
    exports: list[GuidedExport] = []
    used_stems: set[str] = set()
    for entry_position, entry in enumerate(entries):
        if entry.is_explicit_range:
            start = float(entry.timestamps[0])
            end = float(entry.timestamps[-1])
            if end <= start:
                raise ValueError(f"Guide line {entry.line_number} has a non-positive range: {entry.raw_line}")
            match_source = "guide-range"
            distance = None
        else:
            start, end, distance = find_nearby_segment(
                float(entry.timestamps[0]), segment_items, max_distance_seconds=max_distance_seconds
            )
            if entry_position + 1 < len(entries):
                next_timestamp = float(entries[entry_position + 1].timestamps[0])
                if start < next_timestamp < end:
                    end = next_timestamp
            match_source = "guide-nearby-segment"

        base = safe_filename_stem(entry.title, fallback=f"clip-{entry.index:03d}")
        if numbered_filenames:
            base = f"{entry.index:02d}_{base}"
        stem = make_unique_stem(base, used_stems)
        exports.append(
            GuidedExport(
                index=entry.index,
                title=entry.title,
                filename_stem=stem,
                start=start,
                end=end,
                match_source=match_source,
                guide_line_number=entry.line_number,
                guide_line=entry.raw_line,
                distance_seconds=distance,
            )
        )
    return exports


def guided_exports_to_segment_dicts(exports: list[GuidedExport]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in exports:
        duration = max(0.0, item.end - item.start)
        flags = ["guide"]
        if item.match_source == "guide-range":
            flags.append("explicit_range")
        else:
            flags.append("nearby_segment")
        rows.append(
            {
                "id": f"guide-{item.index:03d}",
                "title": item.title,
                "filename_stem": item.filename_stem,
                "start": round(float(item.start), 3),
                "end": round(float(item.end), 3),
                "start_timecode": format_timecode(item.start),
                "end_timecode": format_timecode(item.end),
                "duration": round(duration, 3),
                "confidence": 1.0 if item.match_source == "guide-range" else 0.9,
                "source": item.match_source,
                "guide_line_number": item.guide_line_number,
                "guide_line": item.guide_line,
                "distance_seconds": None
                if item.distance_seconds is None
                else round(float(item.distance_seconds), 3),
                "flags": flags,
                "user_edited": False,
            }
        )
    return rows


def find_nearby_segment(
    timestamp: float,
    segment_items: list[dict[str, Any]],
    *,
    max_distance_seconds: float,
) -> tuple[float, float, float]:
    if not segment_items:
        raise ValueError("Guide entries with one timestamp require at least one detected segment.")

    best_item: dict[str, Any] | None = None
    best_key: tuple[float, float] | None = None
    for item in segment_items:
        start = float(item["start"])
        end = float(item["end"])
        if end <= timestamp:
            continue
        if start <= timestamp <= end:
            distance = 0.0
        else:
            distance = abs(timestamp - start)
        # Prefer containing segments, then the segment whose start is closest to the guide tag.
        key = (distance, abs(timestamp - start))
        if best_key is None or key < best_key:
            best_key = key
            best_item = item

    if best_item is None or best_key is None:
        raise ValueError(f"No detected segment ends after guide timestamp {timestamp:.3f}.")
    if best_key[0] > max_distance_seconds:
        raise ValueError(
            f"No detected segment is within {max_distance_seconds:.1f}s of guide timestamp {timestamp:.3f}."
        )
    return float(timestamp), float(best_item["end"]), float(best_key[0])


def make_unique_stem(stem: str, used: set[str]) -> str:
    candidate = stem
    suffix = 2
    while candidate.casefold() in used:
        candidate = f"{stem} ({suffix})"
        suffix += 1
    used.add(candidate.casefold())
    return candidate

from __future__ import annotations

from pathlib import Path

from .ffmpeg_tools import probe_format_tags
from .timestamps import Segment, parse_timestamp_text


METADATA_TEXT_FIELDS = ("comment", "description", "synopsis", "title")


def metadata_segments(ffprobe: Path, source: Path) -> list[Segment]:
    tags = probe_format_tags(ffprobe, source)
    text_parts = [tags[key] for key in METADATA_TEXT_FIELDS if key in tags]
    if not text_parts:
        return []
    text = "\n".join(text_parts)
    parsed = parse_timestamp_text(text, source="video-metadata")
    return [
        Segment(segment.start, segment.end, confidence=0.98, source="video-metadata")
        for segment in parsed
    ]


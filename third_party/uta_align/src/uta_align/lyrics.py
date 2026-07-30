from __future__ import annotations

from pathlib import Path

from .models import LyricLine
from .normalize import match_normalize


def parse_lyrics_text(text: str) -> list[LyricLine]:
    lines: list[LyricLine] = []
    block = 0
    pending_break = False
    for position, raw in enumerate(text.splitlines()):
        if position == 0:
            raw = raw.removeprefix("\ufeff")
        clean = raw.strip()
        if not clean:
            if lines:
                pending_break = True
            continue
        if pending_break:
            block += 1
            pending_break = False
        normalized = match_normalize(clean)
        if not normalized:
            continue
        lines.append(LyricLine(len(lines), block, clean, normalized))
    if not lines:
        raise ValueError("lyrics contain no non-empty lines")
    return lines


def load_lyrics(path: str | Path) -> list[LyricLine]:
    return parse_lyrics_text(Path(path).read_text(encoding="utf-8-sig"))

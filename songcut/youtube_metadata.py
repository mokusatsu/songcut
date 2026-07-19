from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .guide import YOUTUBE_TIMECODE_RE


MIN_CANDIDATE_TIMESTAMPS = 2


def load_timestamp_comment_candidates(source: Path) -> tuple[list[dict[str, Any]], str | None]:
    info_path = source.with_suffix(".info.json")
    if not info_path.is_file():
        return [], None

    try:
        data = json.loads(info_path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return [], f"Could not read {info_path.name}: {exc}"

    if not isinstance(data, dict):
        return [], f"Could not read {info_path.name}: expected a JSON object."

    description_candidate = _description_candidate(data)
    comment_candidates = _comment_candidates(data.get("comments"))

    if description_candidate is not None:
        return [description_candidate, *comment_candidates[:1]], None
    return comment_candidates[:2], None


def count_youtube_timecodes(text: str) -> int:
    return len(YOUTUBE_TIMECODE_RE.findall(text))


def _description_candidate(data: dict[str, Any]) -> dict[str, Any] | None:
    text = data.get("description")
    if not isinstance(text, str):
        return None
    timestamp_count = count_youtube_timecodes(text)
    if timestamp_count < MIN_CANDIDATE_TIMESTAMPS:
        return None
    uploader = data.get("uploader")
    return {
        "source": "description",
        "id": "description",
        "author": uploader if isinstance(uploader, str) and uploader.strip() else "Video uploader",
        "text": text,
        "timestamp_count": timestamp_count,
        "like_count": None,
    }


def _comment_candidates(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    ranked: list[tuple[int, int, int, dict[str, Any]]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if not isinstance(text, str):
            continue
        timestamp_count = count_youtube_timecodes(text)
        if timestamp_count < MIN_CANDIDATE_TIMESTAMPS:
            continue

        like_count = _nonnegative_integer(item.get("like_count"))
        comment_id = item.get("id")
        author = item.get("author")
        candidate = {
            "source": "comment",
            "id": comment_id if isinstance(comment_id, str) and comment_id else f"comment-{index + 1}",
            "author": author if isinstance(author, str) and author.strip() else "Unknown author",
            "text": text,
            "timestamp_count": timestamp_count,
            "like_count": like_count,
        }
        ranked.append((-timestamp_count, -like_count, index, candidate))

    ranked.sort(key=lambda item: item[:3])
    return [item[3] for item in ranked]


def _nonnegative_integer(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return 0

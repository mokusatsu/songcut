from __future__ import annotations

import re
import unicodedata

_SPACE_RE = re.compile(r"\s+")
_MATCH_IGNORABLE = re.compile(r"[\s、。！？!?・,，.．…‥「」『』（）()\[\]【】〈〉《》:：;；]+")
_CREDIT_PATTERNS = (
    re.compile(r"^(作詞|作曲|編曲|歌|唄|lyrics?|music|arrang(?:e|ement))[:：]?", re.IGNORECASE),
    re.compile(r"(ご視聴|ご清聴).*(ありがとう|有難う)"),
    re.compile(r"チャンネル登録"),
    re.compile(r"字幕.*(作成|提供)"),
)


def display_normalize(text: str) -> str:
    """Normalize compatibility variants without destroying lyrics punctuation or long marks."""
    normalized = unicodedata.normalize("NFKC", text).replace("\r", "")
    return _SPACE_RE.sub(" ", normalized).strip()


def match_normalize(text: str) -> str:
    """Normalization for matching; preserves alphanumerics, kana and the Japanese long mark."""
    normalized = display_normalize(text).casefold()
    return _MATCH_IGNORABLE.sub("", normalized)


def is_credit_hallucination(text: str) -> bool:
    normalized = display_normalize(text)
    return any(pattern.search(normalized) is not None for pattern in _CREDIT_PATTERNS)

"""Public data models."""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

CodecName = Literal["opus", "aac"]
ModeName = Literal["auto", "specified"]


def _json_safe(value: Any) -> Any:
    """Convert dataclass values to strict-JSON-compatible values."""

    if isinstance(value, Path):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        if math.isnan(value):
            return "nan"
        return "-inf" if value < 0 else "+inf"
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


@dataclass(frozen=True, slots=True)
class MediaInfo:
    """Detected media properties relevant to gain adjustment."""

    codec: CodecName
    container: str
    profile: str | None = None
    audio_streams: int | None = None
    channels: int | None = None


@dataclass(frozen=True, slots=True)
class GainResult:
    """Result returned by :func:`adjust_gain` and :func:`normalize_true_peak`."""

    input_path: Path
    output_path: Path
    codec: CodecName
    container: str
    mode: ModeName
    requested_gain_db: float
    applied_gain_db: float
    measured_true_peak_dbtp: float | None
    predicted_true_peak_dbtp: float | None
    verified_true_peak_dbtp: float | None
    target_true_peak_dbtp: float | None
    backend: str
    reencoded: bool = False
    quantization_error_db: float = 0.0
    details: dict[str, Any] = field(default_factory=dict)
    warnings: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        """Return a strict-JSON-serializable representation."""

        return _json_safe(asdict(self))

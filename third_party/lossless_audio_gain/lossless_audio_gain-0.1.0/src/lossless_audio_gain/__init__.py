"""Lossless gain adjustment for Ogg Opus and AAC-LC MP4/M4A."""

from .aac import AAC_GAIN_STEP_DB, quantize_aac_gain
from .api import adjust_gain, normalize_true_peak
from .exceptions import (
    BackendError,
    DependencyNotFoundError,
    GainRangeError,
    InvalidMediaError,
    LosslessAudioGainError,
    MeasurementError,
    UnsupportedFormatError,
    VerificationError,
)
from .measure import measure_true_peak, verify_decoded_gain
from .models import GainResult, MediaInfo
from .opus import inspect_ogg_opus
from .probe import detect_media

__version__ = "0.1.0"

__all__ = [
    "AAC_GAIN_STEP_DB",
    "BackendError",
    "DependencyNotFoundError",
    "GainRangeError",
    "GainResult",
    "InvalidMediaError",
    "LosslessAudioGainError",
    "MeasurementError",
    "MediaInfo",
    "UnsupportedFormatError",
    "VerificationError",
    "__version__",
    "adjust_gain",
    "detect_media",
    "inspect_ogg_opus",
    "measure_true_peak",
    "normalize_true_peak",
    "quantize_aac_gain",
    "verify_decoded_gain",
]

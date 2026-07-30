"""Known-lyrics alignment for Japanese singing."""

from .alignment import AlignmentError
from .config import AlignConfig
from .models import AlignedLine, AlignmentResult, Observation
from .pipeline import align_lyrics

__all__ = [
    "AlignmentError",
    "AlignConfig",
    "AlignedLine",
    "AlignmentResult",
    "Observation",
    "align_lyrics",
]

__version__ = "0.1.0"

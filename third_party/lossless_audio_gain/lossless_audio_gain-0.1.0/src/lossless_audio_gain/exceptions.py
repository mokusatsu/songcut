"""Exception hierarchy for :mod:`lossless_audio_gain`."""


class LosslessAudioGainError(Exception):
    """Base class for all package-specific failures."""


class DependencyNotFoundError(LosslessAudioGainError):
    """A required external executable was not found."""


class UnsupportedFormatError(LosslessAudioGainError):
    """The codec, container, or profile is not supported safely."""


class InvalidMediaError(LosslessAudioGainError):
    """The input file is malformed or internally inconsistent."""


class MeasurementError(LosslessAudioGainError):
    """True-peak measurement failed."""


class GainRangeError(LosslessAudioGainError):
    """The requested gain cannot be represented without overflow."""


class BackendError(LosslessAudioGainError):
    """An external gain backend failed."""


class VerificationError(LosslessAudioGainError):
    """Post-write verification did not meet the requested constraint."""

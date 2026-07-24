"""ASS appearance/disappearance effects."""

from .core import (
    CONTEXT_REQUIRED_EFFECTS,
    EFFECT_NAMES_JA,
    DialogueEvent,
    Direction,
    Effect,
    EffectContext,
    EffectError,
    EffectParameterError,
    Rect,
    decorate_dialogue,
    parse_dialogue,
)

__all__ = [
    "CONTEXT_REQUIRED_EFFECTS",
    "EFFECT_NAMES_JA",
    "DialogueEvent",
    "Direction",
    "Effect",
    "EffectContext",
    "EffectError",
    "EffectParameterError",
    "Rect",
    "decorate_dialogue",
    "parse_dialogue",
]

__version__ = "1.0.0"

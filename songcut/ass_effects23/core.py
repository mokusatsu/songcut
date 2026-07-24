"""Core implementation for decorating ASS Dialogue events.

The public entry point is :func:`decorate_dialogue`.  The first four
parameters are deliberately mandatory.  Effects that cannot be represented
by one ASS event return several Dialogue lines.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum
import math
import random
import re
import unicodedata
from collections.abc import Mapping, Sequence
from typing import Any


class EffectError(ValueError):
    """Base error raised for invalid input or unsupported combinations."""


class EffectParameterError(EffectError):
    """Raised when effect-specific parameters are invalid."""


class Effect(str, Enum):
    CUT = "cut"
    FAD = "fad"
    FADE = "fade"
    ALPHA = "alpha"
    ZOOM = "zoom"
    POP = "pop"
    BOUNCE = "bounce"
    SLIDE = "slide"
    WIPE = "wipe"
    BLUR = "blur"
    ROTATE = "rotate"
    FLIP = "flip"
    SPACING = "spacing"
    STRETCH = "stretch"
    OUTLINE = "outline"
    GLOW = "glow"
    FLICKER = "flicker"
    TYPEWRITER = "typewriter"
    KARAOKE = "karaoke"
    SCANLINE = "scanline"
    DISTORT = "distort"
    GLITCH = "glitch"
    DISSOLVE = "dissolve"


EFFECT_NAMES_JA: dict[Effect, str] = {
    Effect.CUT: "カットイン／カットアウト",
    Effect.FAD: "通常フェードイン／フェードアウト",
    Effect.FADE: "多段階フェード",
    Effect.ALPHA: "透明度アニメーション",
    Effect.ZOOM: "ズームイン／ズームアウト",
    Effect.POP: "ポップイン／ポップアウト",
    Effect.BOUNCE: "バウンス表示",
    Effect.SLIDE: "スライドイン／スライドアウト",
    Effect.WIPE: "ワイプ表示／マスク消去",
    Effect.BLUR: "ブラーイン／ブラーアウト",
    Effect.ROTATE: "回転イン／回転アウト",
    Effect.FLIP: "3Dフリップイン／フリップアウト",
    Effect.SPACING: "文字間隔を広げて出現／収束して消失",
    Effect.STRETCH: "縦伸び／横伸び表示",
    Effect.OUTLINE: "輪郭から塗りが現れる",
    Effect.GLOW: "グローイン／発光しながら消失",
    Effect.FLICKER: "点滅／フリッカー",
    Effect.TYPEWRITER: "タイプライター表示",
    Effect.KARAOKE: "カラオケ・スイープ表示",
    Effect.SCANLINE: "スキャンライン表示",
    Effect.DISTORT: "歪みながら出現",
    Effect.GLITCH: "グリッチ表示",
    Effect.DISSOLVE: "ディゾルブ／粒子消失",
}

CONTEXT_REQUIRED_EFFECTS = frozenset(
    {
        Effect.SLIDE,
        Effect.WIPE,
        Effect.KARAOKE,
        Effect.SCANLINE,
        Effect.GLITCH,
        Effect.DISSOLVE,
    }
)


class Direction(str, Enum):
    LEFT_TO_RIGHT = "left_to_right"
    RIGHT_TO_LEFT = "right_to_left"
    TOP_TO_BOTTOM = "top_to_bottom"
    BOTTOM_TO_TOP = "bottom_to_top"
    CLOCKWISE = "clockwise"
    COUNTERCLOCKWISE = "counterclockwise"
    HORIZONTAL = "horizontal"
    VERTICAL = "vertical"


@dataclass(frozen=True)
class Rect:
    x1: int
    y1: int
    x2: int
    y2: int

    def __post_init__(self) -> None:
        if self.x1 >= self.x2 or self.y1 >= self.y2:
            raise EffectParameterError("Rect requires x1 < x2 and y1 < y2")

    @property
    def width(self) -> int:
        return self.x2 - self.x1

    @property
    def height(self) -> int:
        return self.y2 - self.y1


@dataclass(frozen=True)
class EffectContext:
    """Geometry not contained in a single Dialogue line.

    ``text_box`` should cover the rendered text including outline and shadow.
    It is required for exact wipe/scanline/dissolve geometry; the default is a
    generous box around the screen centre.
    """

    play_res_x: int = 1920
    play_res_y: int = 1080
    anchor_x: int | None = None
    anchor_y: int | None = None
    text_box: Rect | None = None
    offscreen_margin: int = 240
    strict: bool = True

    def __post_init__(self) -> None:
        if self.play_res_x <= 0 or self.play_res_y <= 0:
            raise EffectParameterError("play_res_x/play_res_y must be positive")
        if self.offscreen_margin < 0:
            raise EffectParameterError("offscreen_margin must be non-negative")
        if self.text_box is not None:
            if not (
                0 <= self.text_box.x1 < self.text_box.x2 <= self.play_res_x
                and 0 <= self.text_box.y1 < self.text_box.y2 <= self.play_res_y
            ):
                raise EffectParameterError("text_box must be inside PlayRes")

    @property
    def anchor(self) -> tuple[int, int]:
        return (
            self.play_res_x // 2 if self.anchor_x is None else self.anchor_x,
            self.play_res_y // 2 if self.anchor_y is None else self.anchor_y,
        )

    @property
    def box(self) -> Rect:
        if self.text_box is not None:
            return self.text_box
        return Rect(
            round(self.play_res_x * 0.25),
            round(self.play_res_y * 0.38),
            round(self.play_res_x * 0.75),
            round(self.play_res_y * 0.62),
        )


_TIME_RE = re.compile(r"^\s*(\d+):([0-5]?\d):([0-5]?\d)(?:\.(\d{1,3}))?\s*$")
_DIALOGUE_RE = re.compile(r"^\s*Dialogue\s*:\s*(.*)$", re.IGNORECASE)
_LEADING_OVERRIDE_RE = re.compile(r"^\{([^{}]*)\}")
_OVERRIDE_RE = re.compile(r"\{[^{}]*\}")
_POS_RE = re.compile(
    r"\\pos\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)",
    re.IGNORECASE,
)
_CONFLICT_RE = re.compile(
    r"\\(?:fad|fade|t|move|clip|iclip|k|K|kf|ko)(?=[(\d\\])",
)
_DRAWING_RE = re.compile(r"\\p\s*[1-9]", re.IGNORECASE)


def _parse_time(value: str) -> int:
    match = _TIME_RE.fullmatch(value)
    if not match:
        raise EffectError(f"invalid ASS timestamp: {value!r}")
    hours, minutes, seconds = map(int, match.group(1, 2, 3))
    fraction = match.group(4) or ""
    millis = int((fraction + "000")[:3])
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis


def _format_time(milliseconds: int) -> str:
    if milliseconds < 0:
        raise EffectError("ASS timestamp cannot be negative")
    # ASS timestamps are centisecond based. Round halves upward.
    centiseconds = (milliseconds + 5) // 10
    hours, remainder = divmod(centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    seconds, centis = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centis:02d}"


@dataclass(frozen=True)
class DialogueEvent:
    layer: int
    start_ms: int
    end_ms: int
    style: str
    name: str
    margin_l: str
    margin_r: str
    margin_v: str
    effect_field: str
    text: str

    def __post_init__(self) -> None:
        if self.end_ms <= self.start_ms:
            raise EffectError("Dialogue end time must be after start time")

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms

    def format(self) -> str:
        return (
            f"Dialogue: {self.layer},{_format_time(self.start_ms)},"
            f"{_format_time(self.end_ms)},{self.style},{self.name},"
            f"{self.margin_l},{self.margin_r},{self.margin_v},"
            f"{self.effect_field},{self.text}"
        )


def parse_dialogue(line: str) -> DialogueEvent:
    """Parse one ASS v4+ ``Dialogue:`` line.

    The text field may contain commas because only the first nine commas are
    treated as separators.
    """

    if "\n" in line or "\r" in line:
        raise EffectError("exactly one Dialogue line is required")
    match = _DIALOGUE_RE.fullmatch(line)
    if not match:
        raise EffectError("input must begin with 'Dialogue:'")
    fields = match.group(1).split(",", 9)
    if len(fields) != 10:
        raise EffectError(
            "Dialogue line must contain 10 ASS fields "
            "(Layer through Text); text may contain commas"
        )
    try:
        layer = int(fields[0].strip())
    except ValueError as exc:
        raise EffectError(f"invalid Dialogue layer: {fields[0]!r}") from exc
    return DialogueEvent(
        layer=layer,
        start_ms=_parse_time(fields[1]),
        end_ms=_parse_time(fields[2]),
        style=fields[3].strip(),
        name=fields[4],
        margin_l=fields[5].strip(),
        margin_r=fields[6].strip(),
        margin_v=fields[7].strip(),
        effect_field=fields[8],
        text=fields[9],
    )


def _coerce_effect(value: Effect | str | int) -> Effect:
    if isinstance(value, Effect):
        return value
    effects = list(Effect)
    if isinstance(value, int):
        if 1 <= value <= len(effects):
            return effects[value - 1]
        raise EffectParameterError("numeric effect must be in the range 1..23")
    candidate = str(value).strip()
    if candidate.isdecimal():
        return _coerce_effect(int(candidate))
    normalized = candidate.lower().replace("-", "_").replace(" ", "_")
    aliases: dict[str, Effect] = {effect.value: effect for effect in Effect}
    aliases.update(
        {
            "normal_fade": Effect.FAD,
            "multistage_fade": Effect.FADE,
            "3d_flip": Effect.FLIP,
            "karaoke_sweep": Effect.KARAOKE,
        }
    )
    for effect, label in EFFECT_NAMES_JA.items():
        aliases[label] = effect
    try:
        return aliases[normalized] if normalized in aliases else aliases[candidate]
    except KeyError as exc:
        choices = ", ".join(effect.value for effect in Effect)
        raise EffectParameterError(
            f"unknown effect {value!r}; choose 1..23 or one of: {choices}"
        ) from exc


def _coerce_params(params: Mapping[str, Any] | None) -> dict[str, Any]:
    if params is None:
        return {}
    if not isinstance(params, Mapping):
        raise EffectParameterError("params must be a mapping or None")
    result = dict(params)
    forbidden = {
        "start_direction",
        "end_direction",
        "in_direction",
        "out_direction",
        "enter_direction",
        "exit_direction",
    }
    used_forbidden = forbidden.intersection(result)
    if used_forbidden:
        names = ", ".join(sorted(used_forbidden))
        raise EffectParameterError(
            f"separate start/end directions are not supported: {names}; "
            "use the single 'direction' parameter"
        )
    return result


def _validate_param_names(params: Mapping[str, Any], allowed: set[str]) -> None:
    unknown = set(params) - allowed
    if unknown:
        raise EffectParameterError(
            "unsupported parameter(s): " + ", ".join(sorted(unknown))
        )


def _number(
    params: Mapping[str, Any],
    name: str,
    default: float,
    *,
    minimum: float,
    maximum: float,
) -> float:
    value = params.get(name, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EffectParameterError(f"{name} must be a number")
    value = float(value)
    if not math.isfinite(value) or not minimum <= value <= maximum:
        raise EffectParameterError(
            f"{name} must be between {minimum:g} and {maximum:g}"
        )
    return value


def _integer(
    params: Mapping[str, Any],
    name: str,
    default: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    value = params.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise EffectParameterError(f"{name} must be an integer")
    if not minimum <= value <= maximum:
        raise EffectParameterError(
            f"{name} must be between {minimum} and {maximum}"
        )
    return value


def _direction(
    params: Mapping[str, Any],
    allowed: Sequence[Direction],
    default: Direction,
) -> Direction:
    raw = params.get("direction", default)
    try:
        direction = raw if isinstance(raw, Direction) else Direction(str(raw))
    except ValueError as exc:
        names = ", ".join(item.value for item in allowed)
        raise EffectParameterError(f"direction must be one of: {names}") from exc
    if direction not in allowed:
        names = ", ".join(item.value for item in allowed)
        raise EffectParameterError(f"direction must be one of: {names}")
    return direction


def _add_tags(text: str, tags: str) -> str:
    if not tags:
        return text
    match = _LEADING_OVERRIDE_RE.match(text)
    if match:
        # Append effect tags so they win over conflicting static values in the
        # original leading block while retaining the user's formatting.
        return "{" + match.group(1) + tags + "}" + text[match.end() :]
    return "{" + tags + "}" + text


def _remove_position_tags(text: str) -> str:
    def clean(match: re.Match[str]) -> str:
        body = re.sub(r"\\(?:pos|move|org)\([^)]*\)", "", match.group(0))
        return "" if body == "{}" else body

    return _OVERRIDE_RE.sub(clean, text)


def _event_anchor(event: DialogueEvent, context: EffectContext) -> tuple[int, int]:
    match = _POS_RE.search(event.text)
    if match:
        return round(float(match.group(1))), round(float(match.group(2)))
    return context.anchor


def _clone(
    event: DialogueEvent,
    *,
    start_ms: int | None = None,
    end_ms: int | None = None,
    text: str | None = None,
    layer: int | None = None,
) -> DialogueEvent:
    return replace(
        event,
        start_ms=event.start_ms if start_ms is None else start_ms,
        end_ms=event.end_ms if end_ms is None else end_ms,
        text=event.text if text is None else text,
        layer=event.layer if layer is None else layer,
    )


def _t(start: int, end: int, tags: str) -> str:
    if end <= start:
        return ""
    return rf"\t({start},{end},{tags})"


def _fmt(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _single(event: DialogueEvent, tags: str) -> list[DialogueEvent]:
    return [_clone(event, text=_add_tags(event.text, tags))]


def _simple_transform(
    event: DialogueEvent,
    start_duration: int,
    end_duration: int,
    initial: str,
    visible: str,
    hidden: str,
) -> list[DialogueEvent]:
    duration = event.duration_ms
    tags = ""
    if start_duration:
        tags += initial + _t(0, start_duration, visible)
    if end_duration:
        tags += _t(duration - end_duration, duration, hidden)
    return _single(event, tags)


def _clip_tuple(rect: Rect) -> str:
    return f"{rect.x1},{rect.y1},{rect.x2},{rect.y2}"


def _zero_clip(rect: Rect, direction: Direction, *, at_end: bool) -> Rect:
    if direction is Direction.LEFT_TO_RIGHT:
        x = rect.x2 if at_end else rect.x1
        return Rect(x - 1, rect.y1, x, rect.y2)
    if direction is Direction.RIGHT_TO_LEFT:
        x = rect.x1 if at_end else rect.x2
        return Rect(x, rect.y1, x + 1, rect.y2)
    if direction is Direction.TOP_TO_BOTTOM:
        y = rect.y2 if at_end else rect.y1
        return Rect(rect.x1, y - 1, rect.x2, y)
    y = rect.y1 if at_end else rect.y2
    return Rect(rect.x1, y, rect.x2, y + 1)


def _wipe_tags(
    duration: int,
    start_duration: int,
    end_duration: int,
    rect: Rect,
    direction: Direction,
) -> str:
    tags = ""
    full = _clip_tuple(rect)
    if start_duration:
        first = _clip_tuple(_zero_clip(rect, direction, at_end=False))
        tags += rf"\clip({first})" + _t(
            0, start_duration, rf"\clip({full})"
        )
    else:
        tags += rf"\clip({full})"
    if end_duration:
        last = _clip_tuple(_zero_clip(rect, direction, at_end=True))
        tags += _t(
            duration - end_duration,
            duration,
            rf"\clip({last})",
        )
    return tags


def _plain_text_parts(text: str) -> tuple[str, list[str]]:
    """Return leading overrides and visible tokens for character effects."""

    leading = ""
    match = _LEADING_OVERRIDE_RE.match(text)
    payload = text
    if match:
        leading = match.group(0)
        payload = text[match.end() :]
    if _OVERRIDE_RE.search(payload):
        raise EffectError(
            "typewriter does not support inline override blocks; "
            "move static tags to the leading override block"
        )
    if _DRAWING_RE.search(leading):
        raise EffectError("typewriter cannot process ASS vector drawings")

    tokens: list[str] = []
    index = 0
    while index < len(payload):
        if payload[index] == "\\" and index + 1 < len(payload):
            if payload[index + 1] in {"N", "n", "h"}:
                tokens.append(payload[index : index + 2])
                index += 2
                continue
        char = payload[index]
        if unicodedata.combining(char) and tokens:
            tokens[-1] += char
        else:
            tokens.append(char)
        index += 1
    if not tokens:
        raise EffectError("Dialogue text must contain visible text")
    return leading, tokens


def _slice_rects(rect: Rect, direction: Direction, count: int) -> list[Rect]:
    result: list[Rect] = []
    if direction in (Direction.LEFT_TO_RIGHT, Direction.RIGHT_TO_LEFT):
        for index in range(count):
            x1 = rect.x1 + round(rect.width * index / count)
            x2 = rect.x1 + round(rect.width * (index + 1) / count)
            result.append(Rect(x1, rect.y1, max(x1 + 1, x2), rect.y2))
    else:
        for index in range(count):
            y1 = rect.y1 + round(rect.height * index / count)
            y2 = rect.y1 + round(rect.height * (index + 1) / count)
            result.append(Rect(rect.x1, y1, rect.x2, max(y1 + 1, y2)))
    if direction in (Direction.RIGHT_TO_LEFT, Direction.BOTTOM_TO_TOP):
        result.reverse()
    return result


def _effect_cut(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, set())
    return [event]


def _effect_fad(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, set())
    return _single(event, rf"\fad({start},{end})")


def _effect_fade(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, set())
    duration = event.duration_ms
    return _single(
        event,
        rf"\fade(255,0,255,0,{start},{duration-end},{duration})",
    )


def _effect_alpha(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, set())
    return _simple_transform(
        event,
        start,
        end,
        r"\alpha&HFF&",
        r"\alpha&H00&",
        r"\alpha&HFF&",
    )


def _effect_zoom(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"min_scale"})
    minimum = _number(params, "min_scale", 0, minimum=0, maximum=99)
    small = rf"\fscx{_fmt(minimum)}\fscy{_fmt(minimum)}\alpha&HFF&"
    return _simple_transform(
        event,
        start,
        end,
        small,
        r"\fscx100\fscy100\alpha&H00&",
        small,
    )


def _effect_pop(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"overshoot"})
    overshoot = _number(params, "overshoot", 122, minimum=101, maximum=200)
    duration = event.duration_ms
    tags = ""
    if start:
        split = round(start * 0.62)
        tags += r"\fscx0\fscy0\alpha&HFF&"
        tags += _t(
            0,
            split,
            rf"\fscx{_fmt(overshoot)}\fscy{_fmt(overshoot)}\alpha&H00&",
        )
        tags += _t(
            split,
            start,
            r"\fscx100\fscy100",
        )
    if end:
        begin = duration - end
        split = begin + round(end * 0.35)
        tags += _t(
            begin,
            split,
            rf"\fscx{_fmt(overshoot)}\fscy{_fmt(overshoot)}",
        )
        tags += _t(
            split,
            duration,
            r"\fscx0\fscy0\alpha&HFF&",
        )
    return _single(event, tags)


def _effect_bounce(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"peak", "valley", "rebound"})
    peak = _number(params, "peak", 128, minimum=105, maximum=220)
    valley = _number(params, "valley", 88, minimum=40, maximum=99)
    rebound = _number(params, "rebound", 108, minimum=101, maximum=160)
    duration = event.duration_ms
    tags = ""
    if start:
        points = [round(start * f) for f in (0.34, 0.56, 0.76)]
        tags += r"\fscx0\fscy0\alpha&HFF&"
        tags += _t(0, points[0], rf"\fscx{_fmt(peak)}\fscy{_fmt(peak)}\alpha&H00&")
        tags += _t(points[0], points[1], rf"\fscx{_fmt(valley)}\fscy{_fmt(valley)}")
        tags += _t(points[1], points[2], rf"\fscx{_fmt(rebound)}\fscy{_fmt(rebound)}")
        tags += _t(points[2], start, r"\fscx100\fscy100")
    if end:
        begin = duration - end
        p1 = begin + round(end * 0.25)
        p2 = begin + round(end * 0.48)
        tags += _t(begin, p1, rf"\fscx{_fmt(rebound)}\fscy{_fmt(rebound)}")
        tags += _t(p1, p2, rf"\fscx{_fmt(valley)}\fscy{_fmt(valley)}")
        tags += _t(p2, duration, r"\fscx0\fscy0\alpha&HFF&")
    return _single(event, tags)


def _effect_slide(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"direction"})
    direction = _direction(
        params,
        (
            Direction.LEFT_TO_RIGHT,
            Direction.RIGHT_TO_LEFT,
            Direction.TOP_TO_BOTTOM,
            Direction.BOTTOM_TO_TOP,
        ),
        Direction.LEFT_TO_RIGHT,
    )
    anchor_x, anchor_y = _event_anchor(event, context)
    stripped = _remove_position_tags(event.text)
    margin = context.offscreen_margin
    if direction is Direction.LEFT_TO_RIGHT:
        source = (-margin, anchor_y)
        target = (context.play_res_x + margin, anchor_y)
    elif direction is Direction.RIGHT_TO_LEFT:
        source = (context.play_res_x + margin, anchor_y)
        target = (-margin, anchor_y)
    elif direction is Direction.TOP_TO_BOTTOM:
        source = (anchor_x, -margin)
        target = (anchor_x, context.play_res_y + margin)
    else:
        source = (anchor_x, context.play_res_y + margin)
        target = (anchor_x, -margin)

    result: list[DialogueEvent] = []
    middle_start = event.start_ms + start
    middle_end = event.end_ms - end
    if start:
        tags = rf"\move({source[0]},{source[1]},{anchor_x},{anchor_y},0,{start})"
        result.append(
            _clone(
                event,
                end_ms=middle_start,
                text=_add_tags(stripped, tags),
            )
        )
    if middle_end > middle_start:
        result.append(
            _clone(
                event,
                start_ms=middle_start,
                end_ms=middle_end,
                text=_add_tags(stripped, rf"\pos({anchor_x},{anchor_y})"),
            )
        )
    if end:
        tags = rf"\move({anchor_x},{anchor_y},{target[0]},{target[1]},0,{end})"
        result.append(
            _clone(
                event,
                start_ms=middle_end,
                text=_add_tags(stripped, tags),
            )
        )
    return result


def _effect_wipe(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"direction"})
    direction = _direction(
        params,
        (
            Direction.LEFT_TO_RIGHT,
            Direction.RIGHT_TO_LEFT,
            Direction.TOP_TO_BOTTOM,
            Direction.BOTTOM_TO_TOP,
        ),
        Direction.LEFT_TO_RIGHT,
    )
    return _single(
        event,
        _wipe_tags(event.duration_ms, start, end, context.box, direction),
    )


def _effect_blur(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"radius"})
    radius = _number(params, "radius", 14, minimum=0.1, maximum=100)
    hidden = rf"\blur{_fmt(radius)}\alpha&HFF&"
    return _simple_transform(
        event,
        start,
        end,
        hidden,
        r"\blur0\alpha&H00&",
        hidden,
    )


def _effect_rotate(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"direction", "degrees"})
    direction = _direction(
        params,
        (Direction.CLOCKWISE, Direction.COUNTERCLOCKWISE),
        Direction.CLOCKWISE,
    )
    degrees = _number(params, "degrees", 120, minimum=1, maximum=1440)
    sign = 1 if direction is Direction.CLOCKWISE else -1
    hidden_in = (
        rf"\frz{_fmt(-sign * degrees)}\fscx0\fscy0\alpha&HFF&"
    )
    hidden_out = (
        rf"\frz{_fmt(sign * degrees)}\fscx0\fscy0\alpha&HFF&"
    )
    return _simple_transform(
        event,
        start,
        end,
        hidden_in,
        r"\frz0\fscx100\fscy100\alpha&H00&",
        hidden_out,
    )


def _effect_flip(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"direction", "degrees"})
    direction = _direction(
        params,
        (Direction.HORIZONTAL, Direction.VERTICAL),
        Direction.HORIZONTAL,
    )
    degrees = _number(params, "degrees", 90, minimum=1, maximum=720)
    tag = "fry" if direction is Direction.HORIZONTAL else "frx"
    hidden_in = rf"\{tag}{_fmt(degrees)}\fscx5\alpha&HFF&"
    hidden_out = rf"\{tag}{_fmt(-degrees)}\fscx5\alpha&HFF&"
    return _simple_transform(
        event,
        start,
        end,
        hidden_in,
        rf"\{tag}0\fscx100\alpha&H00&",
        hidden_out,
    )


def _effect_spacing(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"spacing"})
    spacing = _number(params, "spacing", 42, minimum=0.1, maximum=300)
    hidden = rf"\fsp{_fmt(spacing)}\alpha&HFF&"
    return _simple_transform(
        event,
        start,
        end,
        hidden,
        r"\fsp0\alpha&H00&",
        hidden,
    )


def _effect_stretch(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"direction", "min_scale"})
    direction = _direction(
        params,
        (Direction.HORIZONTAL, Direction.VERTICAL),
        Direction.HORIZONTAL,
    )
    minimum = _number(params, "min_scale", 0, minimum=0, maximum=99)
    if direction is Direction.HORIZONTAL:
        hidden = rf"\fscx{_fmt(minimum)}\fscy100\alpha&HFF&"
    else:
        hidden = rf"\fscx100\fscy{_fmt(minimum)}\alpha&HFF&"
    return _simple_transform(
        event,
        start,
        end,
        hidden,
        r"\fscx100\fscy100\alpha&H00&",
        hidden,
    )


def _effect_outline(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"border"})
    border = _number(params, "border", 4, minimum=0.1, maximum=30)
    duration = event.duration_ms
    tags = rf"\bord{_fmt(border)}"
    if start:
        tags += r"\1a&HFF&\3a&H00&"
        tags += _t(0, start, r"\1a&H00&")
    if end:
        begin = duration - end
        split = begin + round(end * 0.70)
        tags += _t(begin, split, r"\1a&HFF&")
        tags += _t(split, duration, r"\3a&HFF&")
    return _single(event, tags)


def _effect_glow(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"radius", "border", "color"})
    radius = _number(params, "radius", 16, minimum=0.1, maximum=100)
    border = _number(params, "border", 16, minimum=0.1, maximum=100)
    color = str(params.get("color", "&HFFD742&"))
    if not re.fullmatch(r"&H[0-9A-Fa-f]{6}&", color):
        raise EffectParameterError(
            "color must be an ASS BGR value such as '&HFFD742&'"
        )
    duration = event.duration_ms
    glow_tags = (
        rf"\bord{_fmt(border)}\blur{_fmt(radius)}"
        rf"\1a&HFF&\3c{color}\3a&H20&"
    )
    if start:
        glow_tags += _t(
            0,
            start,
            r"\bord3\blur1\3a&H80&",
        )
    if end:
        glow_tags += _t(
            duration - end,
            duration,
            rf"\bord{_fmt(border * 1.5)}\blur{_fmt(radius * 1.5)}\3a&HFF&",
        )
    base_tags = rf"\fad({start},{end})"
    return [
        _clone(event, text=_add_tags(event.text, glow_tags)),
        _clone(event, layer=event.layer + 1, text=_add_tags(event.text, base_tags)),
    ]


def _effect_flicker(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"interval_ms", "seed"})
    interval = _integer(
        params, "interval_ms", 90, minimum=20, maximum=1000
    )
    seed = _integer(params, "seed", 1701, minimum=0, maximum=2**31 - 1)
    rng = random.Random(seed)
    result: list[DialogueEvent] = []

    def pulses(begin: int, finish: int, appear: bool) -> None:
        cursor = begin
        visible = not appear
        while cursor < finish:
            width = max(10, round(interval * rng.uniform(0.55, 1.45)))
            next_cursor = min(finish, cursor + width)
            if visible:
                result.append(_clone(event, start_ms=cursor, end_ms=next_cursor))
            visible = not visible
            cursor = next_cursor

    if start:
        pulses(event.start_ms, event.start_ms + start, True)
    middle_start = event.start_ms + start
    middle_end = event.end_ms - end
    if middle_end > middle_start:
        result.append(
            _clone(event, start_ms=middle_start, end_ms=middle_end)
        )
    if end:
        pulses(event.end_ms - end, event.end_ms, False)
    return result


def _effect_typewriter(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"direction"})
    direction = _direction(
        params,
        (Direction.LEFT_TO_RIGHT, Direction.RIGHT_TO_LEFT),
        Direction.LEFT_TO_RIGHT,
    )
    leading, tokens = _plain_text_parts(event.text)
    result: list[DialogueEvent] = []
    count = len(tokens)

    def compose(visible: Sequence[str]) -> str:
        return leading + "".join(visible)

    if start:
        for index in range(count):
            begin = event.start_ms + round(start * index / count)
            finish = event.start_ms + round(start * (index + 1) / count)
            if finish <= begin:
                continue
            if direction is Direction.LEFT_TO_RIGHT:
                visible = tokens[: index + 1]
            else:
                visible = tokens[count - index - 1 :]
            result.append(
                _clone(
                    event,
                    start_ms=begin,
                    end_ms=finish,
                    text=compose(visible),
                )
            )
    middle_start = event.start_ms + start
    middle_end = event.end_ms - end
    if middle_end > middle_start:
        result.append(
            _clone(
                event,
                start_ms=middle_start,
                end_ms=middle_end,
                text=event.text,
            )
        )
    if end:
        for index in range(count):
            begin = event.end_ms - end + round(end * index / count)
            finish = event.end_ms - end + round(end * (index + 1) / count)
            if finish <= begin:
                continue
            remaining = count - index
            if direction is Direction.LEFT_TO_RIGHT:
                visible = tokens[count - remaining :]
            else:
                visible = tokens[:remaining]
            result.append(
                _clone(
                    event,
                    start_ms=begin,
                    end_ms=finish,
                    text=compose(visible),
                )
            )
    return result


def _effect_karaoke(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"direction"})
    direction = _direction(
        params,
        (Direction.LEFT_TO_RIGHT, Direction.RIGHT_TO_LEFT),
        Direction.LEFT_TO_RIGHT,
    )
    duration = event.duration_ms
    if direction is Direction.LEFT_TO_RIGHT:
        tags = ""
        if start:
            centiseconds = max(1, round(start / 10))
            tags += rf"\2a&HFF&\kf{centiseconds}"
        tags += _wipe_tags(
            duration,
            0,
            end,
            context.box,
            Direction.LEFT_TO_RIGHT,
        )
    else:
        tags = _wipe_tags(
            duration,
            start,
            end,
            context.box,
            Direction.RIGHT_TO_LEFT,
        )
    return _single(event, tags)


def _effect_scanline(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"direction", "steps", "softness_ms"})
    direction = _direction(
        params,
        (
            Direction.LEFT_TO_RIGHT,
            Direction.RIGHT_TO_LEFT,
            Direction.TOP_TO_BOTTOM,
            Direction.BOTTOM_TO_TOP,
        ),
        Direction.LEFT_TO_RIGHT,
    )
    steps = _integer(params, "steps", 24, minimum=2, maximum=200)
    softness = _integer(
        params, "softness_ms", 70, minimum=0, maximum=1000
    )
    duration = event.duration_ms
    result: list[DialogueEvent] = []
    rects = _slice_rects(context.box, direction, steps)
    for index, rect in enumerate(rects):
        tags = rf"\clip({_clip_tuple(rect)})"
        if start:
            delay = round(start * index / steps)
            finish = min(start, delay + softness)
            tags += r"\alpha&HFF&" + _t(
                delay, finish, r"\alpha&H00&"
            )
        if end:
            delay = duration - end + round(end * index / steps)
            finish = min(duration, delay + softness)
            tags += _t(delay, finish, r"\alpha&HFF&")
        result.append(_clone(event, text=_add_tags(event.text, tags)))
    return result


def _effect_distort(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"direction", "amount"})
    direction = _direction(
        params,
        (Direction.LEFT_TO_RIGHT, Direction.RIGHT_TO_LEFT),
        Direction.LEFT_TO_RIGHT,
    )
    amount = _number(params, "amount", 1.25, minimum=0.05, maximum=5)
    sign = 1 if direction is Direction.LEFT_TO_RIGHT else -1
    hidden_in = (
        rf"\fax{_fmt(-sign * amount)}\fay{_fmt(sign * amount * 0.2)}"
        r"\fscx145\alpha&HFF&"
    )
    hidden_out = (
        rf"\fax{_fmt(sign * amount)}\fay{_fmt(-sign * amount * 0.2)}"
        r"\fscx145\alpha&HFF&"
    )
    return _simple_transform(
        event,
        start,
        end,
        hidden_in,
        r"\fax0\fay0\fscx100\alpha&H00&",
        hidden_out,
    )


def _effect_glitch(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"slices", "intensity", "seed"})
    slices = _integer(params, "slices", 28, minimum=3, maximum=300)
    intensity = _number(params, "intensity", 28, minimum=1, maximum=300)
    seed = _integer(params, "seed", 2207, minimum=0, maximum=2**31 - 1)
    rng = random.Random(seed)
    anchor_x, anchor_y = _event_anchor(event, context)
    stripped = _remove_position_tags(event.text)
    box = context.box
    colors = ("&H4A62FF&", "&HFFD64A&", "&HFFFFFF&")
    result: list[DialogueEvent] = []

    def fragments(begin: int, length: int) -> None:
        if length <= 0:
            return
        for index in range(slices):
            relative = round(length * index / slices)
            event_begin = begin + relative
            width = max(20, round(length / slices * rng.uniform(1.2, 3.5)))
            event_end = min(begin + length, event_begin + width)
            if event_end <= event_begin:
                continue
            band_y1 = rng.randint(box.y1, max(box.y1, box.y2 - 2))
            band_y2 = min(box.y2, band_y1 + rng.randint(8, max(9, box.height // 4)))
            dx = round(rng.uniform(-intensity, intensity))
            color = rng.choice(colors)
            tags = (
                rf"\pos({anchor_x + dx},{anchor_y})"
                rf"\clip({box.x1},{band_y1},{box.x2},{band_y2})"
                rf"\1c{color}\3c{color}"
            )
            result.append(
                _clone(
                    event,
                    start_ms=event_begin,
                    end_ms=event_end,
                    layer=event.layer + 1,
                    text=_add_tags(stripped, tags),
                )
            )

    fragments(event.start_ms, start)
    middle_start = event.start_ms + start
    middle_end = event.end_ms - end
    if middle_end > middle_start:
        result.append(
            _clone(event, start_ms=middle_start, end_ms=middle_end)
        )
    fragments(event.end_ms - end, end)
    return result


def _effect_dissolve(
    event: DialogueEvent, start: int, end: int, params: Mapping[str, Any], context: EffectContext
) -> list[DialogueEvent]:
    _validate_param_names(params, {"columns", "rows", "seed", "blur"})
    columns = _integer(params, "columns", 12, minimum=2, maximum=50)
    rows = _integer(params, "rows", 5, minimum=2, maximum=30)
    seed = _integer(params, "seed", 2311, minimum=0, maximum=2**31 - 1)
    blur = _number(params, "blur", 4, minimum=0, maximum=30)
    rng = random.Random(seed)
    duration = event.duration_ms
    box = context.box
    result: list[DialogueEvent] = []
    for row in range(rows):
        for column in range(columns):
            x1 = box.x1 + round(box.width * column / columns)
            x2 = box.x1 + round(box.width * (column + 1) / columns)
            y1 = box.y1 + round(box.height * row / rows)
            y2 = box.y1 + round(box.height * (row + 1) / rows)
            rect = Rect(x1, y1, max(x1 + 1, x2), max(y1 + 1, y2))
            tags = rf"\clip({_clip_tuple(rect)})"
            if start:
                delay = round(start * rng.uniform(0.0, 0.70))
                finish = min(start, delay + round(start * rng.uniform(0.18, 0.42)))
                tags += r"\alpha&HFF&" + _t(
                    delay,
                    finish,
                    rf"\alpha&H00&\blur0",
                )
            if end:
                delay = duration - end + round(end * rng.uniform(0.0, 0.70))
                finish = min(
                    duration,
                    delay + round(end * rng.uniform(0.18, 0.42)),
                )
                tags += _t(
                    delay,
                    finish,
                    rf"\alpha&HFF&\blur{_fmt(blur)}",
                )
            result.append(_clone(event, text=_add_tags(event.text, tags)))
    return result


_HANDLERS = {
    Effect.CUT: _effect_cut,
    Effect.FAD: _effect_fad,
    Effect.FADE: _effect_fade,
    Effect.ALPHA: _effect_alpha,
    Effect.ZOOM: _effect_zoom,
    Effect.POP: _effect_pop,
    Effect.BOUNCE: _effect_bounce,
    Effect.SLIDE: _effect_slide,
    Effect.WIPE: _effect_wipe,
    Effect.BLUR: _effect_blur,
    Effect.ROTATE: _effect_rotate,
    Effect.FLIP: _effect_flip,
    Effect.SPACING: _effect_spacing,
    Effect.STRETCH: _effect_stretch,
    Effect.OUTLINE: _effect_outline,
    Effect.GLOW: _effect_glow,
    Effect.FLICKER: _effect_flicker,
    Effect.TYPEWRITER: _effect_typewriter,
    Effect.KARAOKE: _effect_karaoke,
    Effect.SCANLINE: _effect_scanline,
    Effect.DISTORT: _effect_distort,
    Effect.GLITCH: _effect_glitch,
    Effect.DISSOLVE: _effect_dissolve,
}


def decorate_dialogue(
    dialogue_line: str,
    start_duration_ms: int,
    end_duration_ms: int,
    effect: Effect | str | int,
    *,
    params: Mapping[str, Any] | None = None,
    context: EffectContext | None = None,
) -> list[str]:
    """Apply one of 23 effects to a cut-in/cut-out Dialogue event.

    Parameters
    ----------
    dialogue_line:
        One ASS v4+ ``Dialogue:`` line.
    start_duration_ms:
        Duration of the appearance effect in milliseconds.
    end_duration_ms:
        Duration of the disappearance effect in milliseconds.
    effect:
        :class:`Effect`, an English effect name, Japanese catalogue label, or
        a 1-based number from 1 through 23.
    params:
        Effect-specific parameters.  Directional effects accept one
        ``direction`` value; separate start/end direction keys are rejected.
    context:
        PlayRes and geometry needed by coordinate-based effects.

    Returns
    -------
    list[str]
        One or more complete ASS Dialogue lines.
    """

    event = parse_dialogue(dialogue_line)
    if isinstance(start_duration_ms, bool) or not isinstance(start_duration_ms, int):
        raise EffectParameterError("start_duration_ms must be an integer")
    if isinstance(end_duration_ms, bool) or not isinstance(end_duration_ms, int):
        raise EffectParameterError("end_duration_ms must be an integer")
    if start_duration_ms < 0 or end_duration_ms < 0:
        raise EffectParameterError("effect durations must be non-negative")
    if start_duration_ms + end_duration_ms > event.duration_ms:
        raise EffectParameterError(
            "start_duration_ms + end_duration_ms must not exceed "
            f"the Dialogue duration ({event.duration_ms} ms)"
        )
    selected = _coerce_effect(effect)
    effect_params = _coerce_params(params)
    if selected in CONTEXT_REQUIRED_EFFECTS and context is None:
        raise EffectParameterError(
            f"effect '{selected.value}' requires an explicit EffectContext "
            "because a Dialogue line does not contain PlayRes, anchor, or "
            "rendered text bounds"
        )
    render_context = context or EffectContext()

    if selected is not Effect.CUT and _CONFLICT_RE.search(event.text):
        message = (
            "input Dialogue already contains a dynamic tag "
            "(fad/fade/t/move/clip/karaoke); pass a cut-in/cut-out line "
            "containing only static tags"
        )
        if render_context.strict:
            raise EffectError(message)

    generated = _HANDLERS[selected](
        event,
        start_duration_ms,
        end_duration_ms,
        effect_params,
        render_context,
    )
    if not generated:
        raise EffectError("effect produced no Dialogue events")
    return [item.format() for item in generated]

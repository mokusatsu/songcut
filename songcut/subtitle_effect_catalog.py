"""The songcut boundary for the ASS Lyric Effects v3 catalogue.

The effect catalogue is owned by :mod:`ass_lyric_effects`.  This module only
loads that public API, makes a defensive JSON-safe copy, and applies the
published parameter schema at the boundary used by the REST API.  Keeping the
validation here prevents the GUI, project payloads, and subtitle jobs from
drifting into separate copies of the 97-effect schema.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from enum import Enum
import importlib
import math
from typing import Any


_ALLOWED_PARAMETER_KINDS = frozenset(
    {"integer", "number", "choice", "color", "palette", "string", "boolean"}
)


def _is_finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(float(value))
    except (OverflowError, ValueError):
        return False


class SubtitleEffectCatalogError(RuntimeError):
    """Raised when the v3 engine is unavailable or its catalog is malformed."""


class SubtitleEffectValidationError(ValueError):
    """Raised when an effect ID or parameter value violates the public schema."""


class UnknownSubtitleEffectError(SubtitleEffectValidationError):
    """Raised when a caller sends an effect name that is not a stable ID."""


class UnknownSubtitleEffectParameterError(SubtitleEffectValidationError):
    """Raised when a caller sends a parameter not declared for an effect."""


def _load_engine() -> Any:
    """Import the fixed v3 package only when a catalog operation is requested."""

    try:
        return importlib.import_module("ass_lyric_effects")
    except Exception as exc:  # pragma: no cover - exercised without the optional wheel
        raise SubtitleEffectCatalogError(
            "ASS_Lyric_Effects v3 is unavailable; install ass-lyric-effects==3.0.0 "
            "before using subtitle effects"
        ) from exc


def _json_safe(value: Any) -> Any:
    """Return a recursively copied value containing only strict JSON values."""

    if isinstance(value, Enum):
        return _json_safe(value.value)
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (tuple, list, set, frozenset)):
        return [_json_safe(item) for item in value]
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise SubtitleEffectCatalogError("effect catalog contains a non-finite number")
        return value
    raise SubtitleEffectCatalogError(
        f"effect catalog contains a non-JSON value: {type(value).__name__}"
    )


def _effect_rows(catalog: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    pages = catalog.get("pages")
    if not isinstance(pages, Mapping):
        raise SubtitleEffectCatalogError("effect catalog must contain a pages object")
    for page_name in ("base_url", "catalog_page_url_en", "catalog_page_url_ja"):
        if not isinstance(pages.get(page_name), str):
            raise SubtitleEffectCatalogError(
                f"effect catalog pages.{page_name} must be a string"
            )
    effects = catalog.get("effects")
    if not isinstance(effects, Sequence) or isinstance(effects, (str, bytes)):
        raise SubtitleEffectCatalogError("effect catalog must contain an effects list")

    rows: dict[str, Mapping[str, Any]] = {}
    for row in effects:
        if not isinstance(row, Mapping):
            raise SubtitleEffectCatalogError("effect catalog contains a non-object effect")
        effect_id = row.get("effect_id")
        if not isinstance(effect_id, str) or not effect_id:
            raise SubtitleEffectCatalogError("effect catalog contains an invalid effect_id")
        if row.get("stable_effect_id") is not True:
            raise SubtitleEffectCatalogError(
                f"effect {effect_id!r} is not marked as a stable effect_id"
            )
        if effect_id in rows:
            raise SubtitleEffectCatalogError(f"duplicate effect_id: {effect_id!r}")
        for url_name in ("preview_url", "catalog_page_url_en", "catalog_page_url_ja"):
            if not isinstance(row.get(url_name), str):
                raise SubtitleEffectCatalogError(
                    f"effect {effect_id!r}.{url_name} must be a string"
                )
        parameters = row.get("parameters", {})
        if not isinstance(parameters, Mapping):
            raise SubtitleEffectCatalogError(
                f"parameters for effect {effect_id!r} must be an object"
            )
        for parameter_name, schema in parameters.items():
            try:
                _validate_schema(effect_id, parameter_name, schema)
            except SubtitleEffectValidationError as exc:
                raise SubtitleEffectCatalogError(str(exc)) from exc
        rows[effect_id] = row
    if not rows:
        raise SubtitleEffectCatalogError("effect catalog contains no effects")
    return rows


def _validate_schema(effect_id: str, parameter_name: Any, schema: Any) -> None:
    if not isinstance(parameter_name, str) or not parameter_name:
        raise SubtitleEffectCatalogError(
            f"effect {effect_id!r} contains an invalid parameter name"
        )
    if not isinstance(schema, Mapping):
        raise SubtitleEffectCatalogError(
            f"schema for {effect_id!r}.{parameter_name} must be an object"
        )
    kind = schema.get("kind")
    if kind not in _ALLOWED_PARAMETER_KINDS:
        allowed = ", ".join(sorted(_ALLOWED_PARAMETER_KINDS))
        raise SubtitleEffectCatalogError(
            f"unsupported parameter kind for {effect_id!r}.{parameter_name}: "
            f"{kind!r}; expected one of {allowed}"
        )
    choices = schema.get("choices", [])
    if not isinstance(choices, Sequence) or isinstance(choices, (str, bytes)):
        raise SubtitleEffectCatalogError(
            f"choices for {effect_id!r}.{parameter_name} must be a list"
        )
    if kind == "choice" and not choices:
        raise SubtitleEffectCatalogError(
            f"choice parameter {effect_id!r}.{parameter_name} has no choices"
        )
    if kind == "choice" and not all(isinstance(choice, str) for choice in choices):
        raise SubtitleEffectCatalogError(
            f"choices for {effect_id!r}.{parameter_name} must contain only strings"
        )
    choice_labels_en = schema.get("choice_labels_en", {})
    choice_labels_ja = schema.get("choice_labels_ja", {})
    if not isinstance(choice_labels_en, Mapping) or not isinstance(choice_labels_ja, Mapping):
        raise SubtitleEffectCatalogError(
            f"choice labels for {effect_id!r}.{parameter_name} must be objects"
        )
    expected_labels = set(choices) if kind == "choice" else set()
    if set(choice_labels_en) != expected_labels or set(choice_labels_ja) != expected_labels:
        raise SubtitleEffectCatalogError(
            f"choice labels for {effect_id!r}.{parameter_name} must match choices"
        )
    if not all(isinstance(label, str) for label in (*choice_labels_en.values(), *choice_labels_ja.values())):
        raise SubtitleEffectCatalogError(
            f"choice labels for {effect_id!r}.{parameter_name} must contain only strings"
        )
    minimum = schema.get("min")
    maximum = schema.get("max")
    if minimum is not None and not _is_finite_number(minimum):
        raise SubtitleEffectCatalogError(
            f"minimum for {effect_id!r}.{parameter_name} must be numeric or null"
        )
    if maximum is not None and not _is_finite_number(maximum):
        raise SubtitleEffectCatalogError(
            f"maximum for {effect_id!r}.{parameter_name} must be numeric or null"
        )
    if minimum is not None and maximum is not None and minimum > maximum:
        raise SubtitleEffectCatalogError(
            f"range for {effect_id!r}.{parameter_name} is inverted"
        )
    _validate_parameter_value(effect_id, parameter_name, schema, schema.get("default"))


def _validate_parameter_value(
    effect_id: str,
    parameter_name: str,
    schema: Mapping[str, Any],
    value: Any,
) -> None:
    kind = schema["kind"]
    if kind == "integer":
        valid_type = isinstance(value, int) and not isinstance(value, bool)
    elif kind == "number":
        valid_type = _is_finite_number(value)
    elif kind in {"string", "color"}:
        valid_type = isinstance(value, str)
    elif kind == "choice":
        valid_type = isinstance(value, str)
    elif kind == "palette":
        valid_type = isinstance(value, Sequence) and not isinstance(value, (str, bytes))
    elif kind == "boolean":
        valid_type = isinstance(value, bool)
    else:  # _validate_schema catches this before values are inspected.
        valid_type = False
    if not valid_type:
        raise SubtitleEffectValidationError(
            f"invalid {kind} parameter {effect_id!r}.{parameter_name}: "
            f"expected {kind}, got {type(value).__name__}"
        )

    if kind in {"integer", "number"}:
        minimum = schema.get("min")
        maximum = schema.get("max")
        try:
            numeric = float(value)
        except (OverflowError, ValueError) as exc:
            raise SubtitleEffectValidationError(
                f"invalid {kind} parameter {effect_id!r}.{parameter_name}: "
                f"expected a finite {kind}"
            ) from exc
        if minimum is not None and numeric < float(minimum):
            raise SubtitleEffectValidationError(
                f"parameter {effect_id!r}.{parameter_name} must be >= {minimum}"
            )
        if maximum is not None and numeric > float(maximum):
            raise SubtitleEffectValidationError(
                f"parameter {effect_id!r}.{parameter_name} must be <= {maximum}"
            )
    elif kind == "choice" and value not in schema.get("choices", []):
        choices = ", ".join(repr(choice) for choice in schema.get("choices", []))
        raise SubtitleEffectValidationError(
            f"parameter {effect_id!r}.{parameter_name} must be one of: {choices}"
        )
    elif kind == "palette":
        if not all(isinstance(item, str) for item in value):
            raise SubtitleEffectValidationError(
                f"parameter {effect_id!r}.{parameter_name} must contain only strings"
            )


def get_subtitle_effect_catalog() -> dict[str, Any]:
    """Return a fresh JSON-safe copy of the upstream v3 effect catalogue."""

    engine = _load_engine()
    get_catalog = getattr(engine, "get_effect_catalog", None)
    version = getattr(engine, "__version__", None)
    if not callable(get_catalog):
        raise SubtitleEffectCatalogError(
            "ASS_Lyric_Effects v3 does not expose get_effect_catalog()"
        )
    if version != "3.0.0":
        raise SubtitleEffectCatalogError(
            f"unsupported ASS_Lyric_Effects version: {version!r}; expected '3.0.0'"
        )
    try:
        raw_catalog = get_catalog()
    except Exception as exc:
        raise SubtitleEffectCatalogError(
            "ASS_Lyric_Effects v3 failed to provide an effect catalog"
        ) from exc
    catalog = _json_safe(raw_catalog)
    if not isinstance(catalog, Mapping):
        raise SubtitleEffectCatalogError("effect catalog must be a JSON object")
    if catalog.get("version") != version:
        raise SubtitleEffectCatalogError(
            "effect catalog version does not match ass_lyric_effects.__version__"
        )
    _effect_rows(catalog)
    # _json_safe returns a new mapping; converting it to a plain dict keeps the
    # endpoint's return type stable even if a custom Mapping is supplied.
    return dict(catalog)


def _validate_effect_against_catalog(
    effect_id: str,
    params: Mapping[str, Any] | None,
    catalog: Mapping[str, Any],
) -> tuple[dict[str, Any], Mapping[str, Any]]:
    if not isinstance(effect_id, str) or not effect_id:
        raise UnknownSubtitleEffectError(
            f"unknown effect_id: {effect_id!r}; effect_id must be a stable string ID"
        )
    rows = _effect_rows(catalog)
    row = rows.get(effect_id)
    if row is None:
        raise UnknownSubtitleEffectError(f"unknown effect_id: {effect_id!r}")
    if params is None:
        return {}, row
    if not isinstance(params, Mapping):
        raise SubtitleEffectValidationError("effect params must be a mapping")
    schemas = row.get("parameters", {})
    unknown = sorted(set(params) - set(schemas), key=repr)
    if unknown:
        names = ", ".join(repr(name) for name in unknown)
        raise UnknownSubtitleEffectParameterError(
            f"unknown parameter(s) for effect {effect_id!r}: {names}"
        )
    supplied: dict[str, Any] = {}
    for parameter_name, value in params.items():
        schema = schemas[parameter_name]
        _validate_parameter_value(effect_id, parameter_name, schema, value)
        supplied[parameter_name] = _json_safe(value)
    return supplied, row


def validate_subtitle_effect(
    effect_id: str,
    params: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate a stable effect ID and supplied parameters without fallback.

    The returned mapping contains only explicitly supplied parameters.  Use
    :func:`normalize_subtitle_effect_params` when defaults should be included.
    """

    supplied, _row = _validate_effect_against_catalog(
        effect_id, params, get_subtitle_effect_catalog()
    )
    return supplied


def normalize_subtitle_effect_params(
    effect_id: str,
    params: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Validate parameters and fill every declared parameter with its default."""

    supplied, row = _validate_effect_against_catalog(
        effect_id, params, get_subtitle_effect_catalog()
    )
    normalized: dict[str, Any] = {}
    for parameter_name, schema in row.get("parameters", {}).items():
        value = supplied[parameter_name] if parameter_name in supplied else schema.get("default")
        # Validate defaults as well so a malformed upstream catalog fails at
        # this boundary instead of silently reaching the renderer.
        _validate_parameter_value(effect_id, parameter_name, schema, value)
        normalized[parameter_name] = _json_safe(value)
    return normalized


def estimate_subtitle_effect_event_count(
    effect_id: str,
    duration_ms: int,
    *,
    grapheme_count: int = 1,
    line_count: int = 1,
    params: Mapping[str, Any] | None = None,
    budget: int | None = None,
) -> dict[str, Any]:
    """Estimate output events through the upstream v3 API after validation."""

    engine = _load_engine()
    estimate = getattr(engine, "estimate_event_count", None)
    if not callable(estimate):
        raise SubtitleEffectCatalogError(
            "ASS_Lyric_Effects v3 does not expose estimate_event_count()"
        )
    budget_error = getattr(engine, "EventBudgetExceededError", None)
    if not isinstance(budget_error, type) or not issubclass(budget_error, ValueError):
        raise SubtitleEffectCatalogError(
            "ASS_Lyric_Effects v3 does not expose EventBudgetExceededError"
        )
    normalized = normalize_subtitle_effect_params(effect_id, params)
    try:
        result = estimate(
            effect_id,
            duration_ms,
            grapheme_count=grapheme_count,
            line_count=line_count,
            params=normalized,
            budget=budget,
        )
    except budget_error:
        # Preserve the upstream exception identity and its effect/budget
        # fields so callers can render a precise pre-flight warning.
        raise
    safe_result = _json_safe(result)
    if not isinstance(safe_result, dict):
        raise SubtitleEffectCatalogError("event estimate must be a JSON object")
    return safe_result


__all__ = [
    "SubtitleEffectCatalogError",
    "SubtitleEffectValidationError",
    "UnknownSubtitleEffectError",
    "UnknownSubtitleEffectParameterError",
    "estimate_subtitle_effect_event_count",
    "get_subtitle_effect_catalog",
    "normalize_subtitle_effect_params",
    "validate_subtitle_effect",
]

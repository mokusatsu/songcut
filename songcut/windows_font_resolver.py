"""Resolve a Windows font family to the physical DirectWrite face.

The subtitle renderer receives a family name, but libass ultimately opens a
specific local SFNT face.  A policy-free MSVC DLL collects raw DirectWrite
metadata; this module owns every selection, style, coverage, and ambiguity
decision before validating the physical file locally.

No registry-only guess or style fallback is made.  A caller gets a
``FontResolutionError`` when the requested face cannot be proven to be local,
to have the requested style, or to cover all requested characters.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
import struct
import threading
import unicodedata
from typing import Any, Mapping, Sequence

from .windows_font_native import (
    FACE_CREATED,
    GLYPH_QUERY_FAILED,
    LOCAL_LOADER_AVAILABLE,
    MULTIPLE_FILES,
    NAME_FACE,
    NAME_FAMILY,
    NAME_FULL,
    NAME_POSTSCRIPT,
    PATH_RESOLVED,
    NativeFontCandidate,
    NativeFontCollectorError,
    get_native_font_collector,
    reset_native_font_collector,
)


class FontResolutionError(RuntimeError):
    """Base error for a font request that cannot be proven safe to use."""


class FontResolverUnavailableError(FontResolutionError):
    """The native DirectWrite collector is unavailable or incompatible."""


class FontNotFoundError(FontResolutionError):
    """No installed face advertises the requested family."""


class FontStyleMismatchError(FontResolutionError):
    """A family exists, but no physical face has the requested style."""


class FontCoverageError(FontResolutionError):
    """The selected physical face does not contain requested characters."""


class FontMetadataError(FontResolutionError):
    """The local file/face index or SFNT metadata is not trustworthy."""


class FontAmbiguityError(FontResolutionError):
    """More than one physical face remains after strict matching."""


@dataclass(frozen=True, slots=True)
class ResolvedFont:
    """A concrete local font face selected by the Windows font stack."""

    family: str
    bold: bool
    italic: bool
    font_path: Path
    face_index: int
    postscript_name: str
    full_name: str
    family_name: str
    subfamily_name: str
    weight: int
    style: str
    style_simulations: str
    file_sha256: str

    @property
    def path(self) -> Path:
        """Short alias useful to callers that use ``path`` terminology."""

        return self.font_path


@dataclass(frozen=True, slots=True)
class LibassFontSelection:
    """One ``fontselect`` line emitted by libass in debug logging."""

    requested_family: str
    requested_weight: int
    requested_italic: bool
    postscript_name: str
    face_index: int
    selected_name: str


_FONTSELECT_RE = re.compile(
    r"fontselect:\s*\((?P<family>.*?),\s*(?P<weight>\d+),\s*(?P<italic>[01])\)"
    r"\s*->\s*(?P<postscript>[^,\r\n]+),\s*(?P<index>\d+)"
    r"(?:,\s*(?P<selected>[^\r\n]+))?",
    re.IGNORECASE,
)

_CACHE: dict[tuple[str, bool, bool, str], ResolvedFont] = {}
_CACHE_LOCK = threading.RLock()


def _normalise_name(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).strip().split()).casefold()


def _normalise_for_log(value: str) -> str:
    return re.sub(r"[^0-9a-z]+", "", value.casefold())


def _as_names(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, Mapping):
        value = value.values()
    try:
        return [str(item) for item in value if str(item).strip()]
    except TypeError:
        return [str(value)]


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().casefold() in {"1", "true", "yes"}
    return bool(value)


def _as_int(value: Any, *, field: str) -> int:
    if value is None or value == "":
        raise FontMetadataError(f"font probe did not return {field}")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise FontMetadataError(f"font probe returned invalid {field}: {value!r}") from exc


def _u16(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 2 > len(data):
        raise FontMetadataError("font table is truncated while reading uint16")
    return struct.unpack_from(">H", data, offset)[0]


def _u32(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 4 > len(data):
        raise FontMetadataError("font table is truncated while reading uint32")
    return struct.unpack_from(">I", data, offset)[0]


def _face_offset(data: bytes, face_index: int) -> tuple[int, int]:
    if face_index < 0:
        raise FontMetadataError(f"font face index must be non-negative: {face_index}")
    signature = data[:4]
    if signature == b"ttcf":
        if len(data) < 12:
            raise FontMetadataError("truncated TTC header")
        count = _u32(data, 8)
        if count == 0 or count > 4096:
            raise FontMetadataError(f"invalid TTC face count: {count}")
        if face_index >= count:
            raise FontMetadataError(f"TTC face index {face_index} is outside {count} faces")
        offset = _u32(data, 12 + face_index * 4)
        if offset + 12 > len(data):
            raise FontMetadataError(f"TTC face {face_index} points outside the file")
        return offset, count
    if face_index != 0:
        raise FontMetadataError(f"single-face font cannot use face index {face_index}")
    if signature not in {b"\x00\x01\x00\x00", b"OTTO", b"true", b"typ1"}:
        raise FontMetadataError(f"unsupported/non-SFNT font signature: {signature!r}")
    return 0, 1


def _table_directory(data: bytes, face_offset: int) -> dict[bytes, tuple[int, int]]:
    num_tables = _u16(data, face_offset + 4)
    directory_end = face_offset + 12 + num_tables * 16
    if directory_end > len(data):
        raise FontMetadataError("truncated SFNT table directory")
    tables: dict[bytes, tuple[int, int]] = {}
    for index in range(num_tables):
        row = face_offset + 12 + index * 16
        tag = data[row : row + 4]
        offset = _u32(data, row + 8)
        length = _u32(data, row + 12)
        if offset + length > len(data):
            raise FontMetadataError(f"SFNT table {tag!r} points outside the file")
        tables[tag] = (offset, length)
    return tables


def _decode_name(platform_id: int, payload: bytes) -> str:
    try:
        if platform_id in {0, 3}:
            return payload.decode("utf-16-be")
        if platform_id == 1:
            return payload.decode("mac_roman")
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        return payload.decode("utf-8", errors="replace")


def _parse_name_table(data: bytes, table: tuple[int, int]) -> dict[int, list[str]]:
    offset, length = table
    if length < 6 or offset + length > len(data):
        raise FontMetadataError("truncated font name table")
    count = _u16(data, offset + 2)
    storage_offset = _u16(data, offset + 4)
    records_end = offset + 6 + count * 12
    storage_start = offset + storage_offset
    if records_end > offset + length or storage_start > offset + length:
        raise FontMetadataError("invalid font name table offsets")
    names: dict[int, list[str]] = {}
    for index in range(count):
        row = offset + 6 + index * 12
        platform_id = _u16(data, row)
        name_id = _u16(data, row + 6)
        value_length = _u16(data, row + 8)
        value_offset = _u16(data, row + 10)
        start = storage_start + value_offset
        end = start + value_length
        if start < storage_start or end > offset + length:
            continue
        value = _decode_name(platform_id, data[start:end]).strip()
        if value:
            names.setdefault(name_id, []).append(value)
    return names


def _first_name(names: Mapping[int, Sequence[str]], name_id: int, default: str = "") -> str:
    values = names.get(name_id, ())
    if not values:
        return default
    # Prefer the first stable value, removing duplicate localized records.
    return next((str(value) for value in values if str(value).strip()), default)


def _inspect_font_face(path: Path, face_index: int) -> dict[str, str]:
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise FontMetadataError(f"cannot read resolved font file {path}: {exc}") from exc
    face_offset, _ = _face_offset(data, face_index)
    tables = _table_directory(data, face_offset)
    if b"name" not in tables:
        raise FontMetadataError(f"font face {path}#{face_index} has no SFNT name table")
    names = _parse_name_table(data, tables[b"name"])
    postscript = _first_name(names, 6)
    family = _first_name(names, 1)
    subfamily = _first_name(names, 2)
    full = _first_name(names, 4) or " ".join(part for part in (family, subfamily) if part)
    if not postscript:
        raise FontMetadataError(f"font face {path}#{face_index} has no PostScript name")
    if not family:
        raise FontMetadataError(f"font face {path}#{face_index} has no family name")
    return {
        "postscript_name": postscript,
        "family_name": family,
        "subfamily_name": subfamily,
        "full_name": full,
    }


def _candidate_matches_family(candidate: Mapping[str, Any], requested: str) -> bool:
    wanted = _normalise_name(requested)
    values: list[str] = []
    for key in (
        "family_source",
        "family_names",
        "win32_family_names",
        "face_names",
        "win32_face_names",
        "full_names",
        "postscript_name",
        "postscript_names",
    ):
        values.extend(_as_names(candidate.get(key)))
    return wanted in {_normalise_name(value) for value in values if value.strip()}


def _native_style_name(style: int) -> str:
    return {0: "Normal", 1: "Oblique", 2: "Italic"}.get(style, f"Unknown({style})")


def _native_simulation_name(simulations: int) -> str:
    names: list[str] = []
    if simulations & 1:
        names.append("BoldSimulation")
    if simulations & 2:
        names.append("ObliqueSimulation")
    unknown = simulations & ~3
    if unknown:
        names.append(f"UnknownSimulation(0x{unknown:X})")
    return "|".join(names) or "None"


def _native_candidate_mapping(candidate: NativeFontCandidate) -> dict[str, Any]:
    names_by_kind: dict[int, list[str]] = {
        NAME_FAMILY: [],
        NAME_FACE: [],
        NAME_FULL: [],
        NAME_POSTSCRIPT: [],
    }
    for name in candidate.names:
        if name.kind in names_by_kind and name.value.strip() and name.value not in names_by_kind[name.kind]:
            names_by_kind[name.kind].append(name.value)
    family_names = names_by_kind[NAME_FAMILY]
    return {
        "native_candidate": candidate,
        "family_source": family_names[0] if family_names else "",
        "family_names": family_names,
        "win32_family_names": [],
        "face_names": names_by_kind[NAME_FACE],
        "win32_face_names": [],
        "full_names": names_by_kind[NAME_FULL],
        "postscript_names": names_by_kind[NAME_POSTSCRIPT],
        "postscript_name": names_by_kind[NAME_POSTSCRIPT][0] if names_by_kind[NAME_POSTSCRIPT] else "",
        "weight": candidate.weight,
        "style": _native_style_name(candidate.style),
        "stretch": candidate.stretch,
        "style_simulations": _native_simulation_name(candidate.simulations),
    }


def _enumerate_native_candidates() -> list[dict[str, Any]]:
    try:
        return [_native_candidate_mapping(item) for item in get_native_font_collector().enumerate()]
    except NativeFontCollectorError as exc:
        raise FontResolverUnavailableError(f"native DirectWrite font collection failed: {exc}") from exc


def _probe_native_candidate(candidate: Mapping[str, Any], text: str) -> dict[str, Any]:
    native_candidate = candidate.get("native_candidate")
    if not isinstance(native_candidate, NativeFontCandidate):
        raise FontMetadataError("native candidate identity is missing")
    codepoints = tuple(dict.fromkeys(ord(character) for character in text if not _is_coverage_ignorable(ord(character))))
    try:
        face = get_native_font_collector().inspect_face(native_candidate, codepoints)
    except NativeFontCollectorError as exc:
        raise FontMetadataError(f"native DirectWrite face inspection failed: {exc}") from exc
    glyph_map = {glyph.codepoint: glyph for glyph in face.glyphs}
    coverage_checked = (
        not (face.status_flags & GLYPH_QUERY_FAILED)
        and face.glyph_hresult >= 0
        and set(glyph_map) == set(codepoints)
        and all(glyph.hresult >= 0 for glyph in glyph_map.values())
    )
    missing = [codepoint for codepoint in codepoints if codepoint not in glyph_map or glyph_map[codepoint].glyph_index == 0]
    files = [item for item in face.files if item.path]
    path = face.path or (files[0].path if len(files) == 1 else None)
    result = dict(candidate)
    result.update(
        {
            "path": path,
            "is_file": bool(face.status_flags & PATH_RESOLVED),
            "face_created": bool(face.status_flags & FACE_CREATED),
            "local_loader_available": bool(face.status_flags & LOCAL_LOADER_AVAILABLE),
            "multiple_files": bool(face.status_flags & MULTIPLE_FILES),
            "file_count": face.file_count,
            "local_file_count": face.local_file_count,
            "face_index": face.face_index,
            "face_index_known": bool(face.status_flags & FACE_CREATED) and face.hresult >= 0,
            "style_simulations": _native_simulation_name(face.simulations),
            "coverage_checked": coverage_checked,
            "missing_codepoints": missing,
        }
    )
    return result


def _style_matches(candidate: Mapping[str, Any], *, bold: bool, italic: bool) -> None:
    weight = _as_int(candidate.get("weight"), field="weight")
    if not 1 <= weight <= 999:
        raise FontStyleMismatchError(f"font face returned invalid OpenType weight {weight}")
    is_bold_weight = weight >= 600
    if is_bold_weight != bold:
        raise FontStyleMismatchError(
            f"requested {'bold' if bold else 'non-bold'} face got weight {weight}"
        )
    style = str(candidate.get("style") or "").strip().casefold()
    expected_styles = {"oblique", "italic"} if italic else {"normal", "roman"}
    if style not in expected_styles:
        raise FontStyleMismatchError(f"requested {'italic' if italic else 'upright'} face got style {style!r}")
    simulations = str(candidate.get("style_simulations") or "none").strip().casefold()
    if simulations not in {"", "none", "0"}:
        raise FontStyleMismatchError(
            f"font face relies on a synthesized style simulation ({candidate.get('style_simulations')!r})"
        )


def _missing_codepoints(candidate: Mapping[str, Any]) -> list[int]:
    if not _as_bool(candidate.get("coverage_checked")):
        raise FontCoverageError("font probe did not verify character coverage")
    value = candidate.get("missing_codepoints")
    if value is None:
        raise FontCoverageError("font probe omitted its missing-codepoint list")
    missing: list[int] = []
    for item in _as_names(value):
        try:
            codepoint = int(item)
        except ValueError as exc:
            raise FontCoverageError(f"font probe returned invalid missing codepoint: {item!r}") from exc
        if not 0 <= codepoint <= 0x10FFFF:
            raise FontCoverageError(f"font probe returned invalid Unicode codepoint: {item!r}")
        if _is_coverage_ignorable(codepoint):
            continue
        if codepoint not in missing:
            missing.append(codepoint)
    return missing


def _is_coverage_ignorable(codepoint: int) -> bool:
    """Return whether a codepoint is shaping/control syntax, not a glyph."""

    if 0xFE00 <= codepoint <= 0xFE0F or 0xE0100 <= codepoint <= 0xE01EF:
        return True
    try:
        return unicodedata.category(chr(codepoint)) in {"Cc", "Cf", "Cs"}
    except (TypeError, ValueError):
        return False


def _resolve_candidate(
    candidate: Mapping[str, Any],
    *,
    requested_family: str,
    bold: bool,
    italic: bool,
) -> ResolvedFont:
    if not _as_bool(candidate.get("face_created")):
        raise FontMetadataError("DirectWrite did not create a physical font face")
    if _as_int(candidate.get("file_count"), field="file_count") != 1:
        raise FontMetadataError("font face must resolve to exactly one physical file")
    if _as_int(candidate.get("local_file_count"), field="local_file_count") != 1:
        raise FontMetadataError("font face does not expose exactly one local file")
    if _as_bool(candidate.get("multiple_files")):
        raise FontMetadataError("multi-file font faces are not supported")
    if not _as_bool(candidate.get("local_loader_available")):
        raise FontMetadataError("font face does not use the DirectWrite local file loader")
    if not _as_bool(candidate.get("is_file")):
        raise FontMetadataError("font provider returned a remote, in-memory, or non-file font URI")
    raw_path = candidate.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise FontMetadataError("font provider did not return a local font path")
    path = Path(raw_path)
    if not path.is_absolute():
        raise FontMetadataError(f"font path is not absolute: {raw_path!r}")
    try:
        path = path.resolve(strict=True)
    except OSError as exc:
        raise FontMetadataError(f"font path does not exist: {raw_path!r}") from exc
    face_index = _as_int(candidate.get("face_index"), field="face_index")
    if "face_index_known" not in candidate or not _as_bool(candidate.get("face_index_known")):
        raise FontMetadataError("font provider did not expose a trustworthy TTC face index")
    if face_index < 0:
        raise FontMetadataError(f"font face index must be non-negative: {face_index}")
    _style_matches(candidate, bold=bold, italic=italic)
    missing = _missing_codepoints(candidate)
    if missing:
        rendered = ", ".join(f"U+{codepoint:04X}" for codepoint in missing[:16])
        if len(missing) > 16:
            rendered += ", ..."
        raise FontCoverageError(f"font face lacks requested character coverage: {rendered}")
    names = _inspect_font_face(path, face_index)
    advertised_names = {
        _normalise_name(value)
        for key in (
            "family_source",
            "family_names",
            "win32_family_names",
            "face_names",
            "win32_face_names",
            "full_names",
            "postscript_names",
        )
        for value in _as_names(candidate.get(key))
        if value.strip()
    }
    binary_names = {
        _normalise_name(names["family_name"]),
        _normalise_name(names["subfamily_name"]),
        _normalise_name(names["full_name"]),
        _normalise_name(names["postscript_name"]),
    }
    if advertised_names and not advertised_names.intersection(binary_names):
        raise FontMetadataError(
            "resolved SFNT identity disagrees with the Windows provider: "
            f"{sorted(binary_names)!r} has no identity in {sorted(advertised_names)!r}"
        )
    try:
        file_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError as exc:
        raise FontMetadataError(f"cannot hash resolved font file {path}: {exc}") from exc
    return ResolvedFont(
        family=requested_family,
        bold=bold,
        italic=italic,
        font_path=path,
        face_index=face_index,
        postscript_name=names["postscript_name"],
        full_name=names["full_name"],
        family_name=names["family_name"],
        subfamily_name=names["subfamily_name"],
        weight=_as_int(candidate.get("weight"), field="weight"),
        style=str(candidate.get("style") or ""),
        style_simulations=str(candidate.get("style_simulations") or "None"),
        file_sha256=file_sha256,
    )


def _resolve_uncached(family: str, *, bold: bool, italic: bool, text: str) -> ResolvedFont:
    candidates = _enumerate_native_candidates()
    candidates = [candidate for candidate in candidates if _candidate_matches_family(candidate, family)]
    if not candidates:
        raise FontNotFoundError(f"Windows font family was not found exactly: {family!r}")

    valid: list[ResolvedFont] = []
    failures: list[FontResolutionError] = []
    for candidate in candidates:
        try:
            _style_matches(candidate, bold=bold, italic=italic)
            valid.append(
                _resolve_candidate(
                    _probe_native_candidate(candidate, text),
                    requested_family=family,
                    bold=bold,
                    italic=italic,
                )
            )
        except FontResolutionError as exc:
            failures.append(exc)
    if not valid:
        # Keep the most actionable strict failure category rather than falling
        # back to a different family or a synthesized style.
        for error_type in (FontCoverageError, FontStyleMismatchError, FontMetadataError):
            for failure in failures:
                if isinstance(failure, error_type):
                    raise failure
        raise FontResolutionError(f"no usable local face for {family!r}")

    unique: dict[tuple[str, int], ResolvedFont] = {
        (str(item.font_path).casefold(), item.face_index): item for item in valid
    }
    if len(unique) > 1:
        exact_source = [
            item
            for item in unique.values()
            if _normalise_name(item.family_name) == _normalise_name(family)
        ]
        if len(exact_source) == 1:
            return exact_source[0]
        raise FontAmbiguityError(
            f"font family {family!r} maps to multiple local faces: "
            + ", ".join(f"{item.font_path}#{item.face_index}" for item in unique.values())
        )
    return next(iter(unique.values()))


def resolve_windows_font(
    family: str,
    *,
    bold: bool = False,
    italic: bool = False,
    text: str = "",
) -> ResolvedFont:
    """Resolve and cache one exact local Windows font face.

    ``text`` participates in the cache key because coverage is part of the
    contract: a face accepted for one lyric line cannot be silently reused for
    another line containing a missing grapheme.
    """

    if not isinstance(family, str) or not family.strip():
        raise FontNotFoundError("font family must be a non-empty string")
    if not isinstance(text, str):
        raise FontCoverageError("font coverage text must be a string")
    normalized_family = " ".join(unicodedata.normalize("NFC", family).strip().split())
    normalized_text = unicodedata.normalize("NFC", text)
    try:
        normalized_text.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise FontCoverageError("font coverage text contains an unpaired surrogate") from exc
    key = (normalized_family.casefold(), bool(bold), bool(italic), normalized_text)
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
    if cached is not None:
        return cached
    resolved = _resolve_uncached(
        normalized_family,
        bold=bool(bold),
        italic=bool(italic),
        text=normalized_text,
    )
    with _CACHE_LOCK:
        _CACHE[key] = resolved
    return resolved


def clear_font_cache() -> None:
    """Drop cached resolutions after fonts are installed/uninstalled."""

    with _CACHE_LOCK:
        _CACHE.clear()
    reset_native_font_collector()


def parse_libass_fontselect(log: str) -> list[LibassFontSelection]:
    """Parse DirectWrite/libass ``fontselect`` diagnostics from FFmpeg logs."""

    selections: list[LibassFontSelection] = []
    for match in _FONTSELECT_RE.finditer(log):
        selected = (match.group("selected") or "").strip()
        selections.append(
            LibassFontSelection(
                requested_family=match.group("family").strip(),
                requested_weight=int(match.group("weight")),
                requested_italic=match.group("italic") == "1",
                postscript_name=match.group("postscript").strip(),
                face_index=int(match.group("index")),
                selected_name=selected,
            )
        )
    return selections


def verify_libass_fontselect(resolved: ResolvedFont, log: str) -> LibassFontSelection:
    """Return the matching libass selection or raise on provider disagreement."""

    expected_weight = 700 if resolved.bold else 400
    expected_italic = resolved.italic
    expected_postscript = _normalise_for_log(resolved.postscript_name)
    for selection in parse_libass_fontselect(log):
        if selection.face_index != resolved.face_index:
            continue
        if selection.requested_weight != expected_weight or selection.requested_italic != expected_italic:
            continue
        if expected_postscript and _normalise_for_log(selection.postscript_name) != expected_postscript:
            continue
        return selection
    raise FontResolutionError(
        "libass DirectWrite fontselect did not select the resolved face "
        f"{resolved.postscript_name}#{resolved.face_index}"
    )


__all__ = [
    "FontAmbiguityError",
    "FontCoverageError",
    "FontMetadataError",
    "FontNotFoundError",
    "FontResolutionError",
    "FontResolverUnavailableError",
    "FontStyleMismatchError",
    "LibassFontSelection",
    "ResolvedFont",
    "clear_font_cache",
    "parse_libass_fontselect",
    "resolve_windows_font",
    "verify_libass_fontselect",
]

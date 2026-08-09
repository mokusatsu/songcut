"""Resolve a Windows font family to the file and face that DirectWrite can use.

The subtitle renderer receives a family name, but libass ultimately opens a
specific local SFNT face.  This module asks Windows' WPF font stack for that
mapping and then validates the answer locally.  WPF's ``GlyphTypeface.FontUri``
is important here: unlike the registry, it contains both the physical file
and (for a collection) the face fragment.

No registry-only guess or style fallback is made.  A caller gets a
``FontResolutionError`` when the requested face cannot be proven to be local,
to have the requested style, or to cover all requested characters.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import threading
import unicodedata
from typing import Any, Mapping, Sequence


class FontResolutionError(RuntimeError):
    """Base error for a font request that cannot be proven safe to use."""


class FontResolverUnavailableError(FontResolutionError):
    """Windows/WPF is unavailable or the probe process failed."""


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


_POWERSHELL_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = $utf8 } catch {}
$OutputEncoding = $utf8
$requestedFamily = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__FAMILY__'))
$requestedText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__TEXT__'))

Add-Type -AssemblyName PresentationCore -ErrorAction Stop

function Get-MapNames($map) {
  if ($null -eq $map) { return @() }
  $values = @()
  foreach ($value in $map.Values) {
    if ($null -ne $value -and ([string]$value).Trim().Length -gt 0) {
      $values += [string]$value
    }
  }
  return @($values | Select-Object -Unique)
}

function Name-Matches($value, $needle) {
  if ($null -eq $value) { return $false }
  $left = ([string]$value).Normalize([Text.NormalizationForm]::FormKC).Trim()
  $right = ([string]$needle).Normalize([Text.NormalizationForm]::FormKC).Trim()
  return [string]::Equals($left, $right, [StringComparison]::OrdinalIgnoreCase)
}

function Test-CoverageIgnorable($text, $offset, $codePoint) {
  # ZWJ/ZWNJ, tag characters, and other Unicode controls/format characters
  # are shaping instructions rather than standalone glyphs.  Variation
  # selectors are Mn, not Cf, so cover both BMP and supplementary ranges.
  if (($codePoint -ge 0xfe00 -and $codePoint -le 0xfe0f) -or
      ($codePoint -ge 0xe0100 -and $codePoint -le 0xe01ef)) {
    return $true
  }
  try {
    $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($text, $offset)
    if ($category -eq [Globalization.UnicodeCategory]::Control -or
        $category -eq [Globalization.UnicodeCategory]::Format -or
        $category -eq [Globalization.UnicodeCategory]::Surrogate) {
      return $true
    }
  } catch {}
  return $false
}

$rows = New-Object System.Collections.Generic.List[object]
foreach ($fontFamily in [System.Windows.Media.Fonts]::SystemFontFamilies) {
  $source = [string]$fontFamily.Source
  $familyNames = @(Get-MapNames $fontFamily.FamilyNames)
  $familyCandidateNames = @($source) + $familyNames
  $typefaces = @($fontFamily.GetTypefaces())

  foreach ($typeface in $typefaces) {
    $glyph = $null
    if (-not $typeface.TryGetGlyphTypeface([ref]$glyph)) { continue }
    $win32FamilyNames = @(Get-MapNames $glyph.Win32FamilyNames)
    $faceNames = @(Get-MapNames $glyph.FaceNames)
    $win32FaceNames = @(Get-MapNames $glyph.Win32FaceNames)
    $allNames = @($familyCandidateNames + $win32FamilyNames + $faceNames + $win32FaceNames)
    $isMatch = $false
    foreach ($name in $allNames) {
      if (Name-Matches $name $requestedFamily) { $isMatch = $true; break }
    }
    if (-not $isMatch) { continue }

    $fontUri = $glyph.FontUri
    $isFile = $false
    $path = $null
    $faceIndex = $null
    $faceIndexKnown = $false
    if ($null -ne $fontUri -and $fontUri.IsFile) {
      $isFile = $true
      $path = $fontUri.LocalPath
      if ([string]::IsNullOrEmpty($fontUri.Fragment)) {
        $faceIndex = 0
        $extension = [IO.Path]::GetExtension($path)
        $faceIndexKnown = $extension -notin @('.ttc', '.otc')
      } else {
        $fragment = $fontUri.Fragment.TrimStart('#')
        $parsedIndex = 0
        if ([int]::TryParse($fragment, [ref]$parsedIndex) -and $parsedIndex -ge 0) {
          $faceIndex = $parsedIndex
          $faceIndexKnown = $true
        }
      }
    }

    $weight = 400
    try { $weight = [int]$typeface.Weight.ToOpenTypeWeight() } catch {
      try { $weight = [int]$glyph.Weight.ToOpenTypeWeight() } catch {}
    }
    $style = [string]$typeface.Style
    $simulations = [string]$glyph.StyleSimulations

    $missing = New-Object System.Collections.Generic.List[int]
    for ($offset = 0; $offset -lt $requestedText.Length; $offset++) {
      $codePoint = [char]::ConvertToUtf32($requestedText, $offset)
      if (Test-CoverageIgnorable $requestedText $offset $codePoint) {
        if ($codePoint -gt 0xffff) { $offset++ }
        continue
      }
      if ($codePoint -gt 0xffff) { $offset++ }
      $glyphId = 0
      try {
        if ($glyph.CharacterToGlyphMap.ContainsKey($codePoint)) {
          $glyphId = [int]$glyph.CharacterToGlyphMap[$codePoint]
        }
      } catch {}
      if ($glyphId -eq 0 -and -not $missing.Contains($codePoint)) {
        [void]$missing.Add($codePoint)
      }
    }

    [void]$rows.Add([pscustomobject]@{
      family_source = $source
      family_names = @($familyNames)
      win32_family_names = @($win32FamilyNames)
      face_names = @($faceNames)
      win32_face_names = @($win32FaceNames)
      path = $path
      is_file = $isFile
      face_index = $faceIndex
      face_index_known = $faceIndexKnown
      weight = $weight
      style = $style
      style_simulations = $simulations
      coverage_checked = $true
      missing_codepoints = @($missing)
    })
  }
}

$rowsArray = [object[]]$rows.ToArray()
[Console]::WriteLine((ConvertTo-Json -InputObject $rowsArray -Compress -Depth 10))
"""

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


def _powershell_executable() -> str:
    configured = os.environ.get("SONGCUT_POWERSHELL")
    if configured:
        return configured
    return shutil.which("powershell.exe") or "powershell.exe"


def _run_wpf_probe(family: str, text: str) -> list[dict[str, Any]]:
    """Run the built-in WPF probe and decode its candidate records."""

    family_b64 = base64.b64encode(family.encode("utf-8")).decode("ascii")
    text_b64 = base64.b64encode(text.encode("utf-8")).decode("ascii")
    script = _POWERSHELL_SCRIPT.replace("__FAMILY__", family_b64).replace("__TEXT__", text_b64)
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    try:
        completed = subprocess.run(
            [
                _powershell_executable(),
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-EncodedCommand",
                encoded,
            ],
            capture_output=True,
            check=False,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as exc:
        raise FontResolverUnavailableError(f"cannot start PowerShell/WPF font probe: {exc}") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise FontResolverUnavailableError(f"WPF font probe failed ({completed.returncode}): {detail}")
    output = (completed.stdout or "").strip()
    if not output:
        raise FontResolverUnavailableError("WPF font probe returned no JSON")
    try:
        decoded = json.loads(output)
    except json.JSONDecodeError as exc:
        raise FontResolverUnavailableError(f"WPF font probe returned invalid JSON: {output[:240]!r}") from exc
    if decoded is None:
        return []
    if isinstance(decoded, Mapping):
        return [dict(decoded)]
    if not isinstance(decoded, list):
        raise FontResolverUnavailableError("WPF font probe returned a non-array JSON value")
    return [dict(item) for item in decoded if isinstance(item, Mapping)]


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
    ):
        values.extend(_as_names(candidate.get(key)))
    return wanted in {_normalise_name(value) for value in values if value.strip()}


def _style_matches(candidate: Mapping[str, Any], *, bold: bool, italic: bool) -> None:
    expected_weight = 700 if bold else 400
    weight = _as_int(candidate.get("weight"), field="weight")
    if weight != expected_weight:
        raise FontStyleMismatchError(
            f"requested {'bold' if bold else 'regular'} face requires weight {expected_weight}, got {weight}"
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
    advertised_families = {
        _normalise_name(value)
        for key in ("family_source", "family_names", "win32_family_names")
        for value in _as_names(candidate.get(key))
        if value.strip()
    }
    if advertised_families and _normalise_name(names["family_name"]) not in advertised_families:
        raise FontMetadataError(
            "resolved SFNT family disagrees with the Windows provider: "
            f"{names['family_name']!r} is not one of {sorted(advertised_families)!r}"
        )
    advertised_faces = {
        _normalise_name(value)
        for key in ("face_names", "win32_face_names")
        for value in _as_names(candidate.get(key))
        if value.strip()
    }
    if advertised_faces:
        binary_face_names = {
            _normalise_name(names["subfamily_name"]),
            _normalise_name(names["full_name"]),
            _normalise_name(names["postscript_name"]),
        }
        if not advertised_faces.intersection(binary_face_names):
            raise FontMetadataError(
                "resolved SFNT face disagrees with the Windows provider: "
                f"{names['subfamily_name']!r} is not one of {sorted(advertised_faces)!r}"
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
    candidates = _run_wpf_probe(family, text)
    candidates = [candidate for candidate in candidates if _candidate_matches_family(candidate, family)]
    if not candidates:
        raise FontNotFoundError(f"Windows font family was not found exactly: {family!r}")

    valid: list[ResolvedFont] = []
    failures: list[FontResolutionError] = []
    for candidate in candidates:
        try:
            valid.append(
                _resolve_candidate(
                    candidate,
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

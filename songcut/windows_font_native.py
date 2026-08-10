"""Policy-free ctypes binding for SongCut's MSVC DirectWrite collector."""

from __future__ import annotations

import ctypes
from dataclasses import dataclass
from pathlib import Path
import sys
import threading
from typing import Sequence


ABI_VERSION = 1
STATUS_OK = 0
STATUS_BUFFER_TOO_SMALL = 3

NAME_FAMILY = 1
NAME_FACE = 2
NAME_FULL = 3
NAME_POSTSCRIPT = 4

FACE_CREATED = 1 << 0
LOCAL_LOADER_AVAILABLE = 1 << 1
PATH_RESOLVED = 1 << 2
MULTIPLE_FILES = 1 << 3
GLYPH_QUERY_FAILED = 1 << 4

DLL_NAME = "songcut_font_resolver.dll"


class NativeFontCollectorError(RuntimeError):
    """The native collector ABI or DirectWrite mechanism failed."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        category: int | None = None,
        hresult: int | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.category = category
        self.hresult = hresult


class _CreateRequest(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("struct_size", ctypes.c_uint32),
        ("flags", ctypes.c_uint32),
        ("reserved", ctypes.c_uint32),
    ]


class _EnumRequest(ctypes.Structure):
    _fields_ = _CreateRequest._fields_


class _CandidateRecord(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("struct_size", ctypes.c_uint32),
        ("candidate_id", ctypes.c_uint64),
        ("generation", ctypes.c_uint32),
        ("family_index", ctypes.c_uint32),
        ("font_index", ctypes.c_uint32),
        ("weight", ctypes.c_uint32),
        ("style", ctypes.c_uint32),
        ("stretch", ctypes.c_uint32),
        ("simulations", ctypes.c_uint32),
        ("first_name", ctypes.c_uint32),
        ("name_count", ctypes.c_uint32),
    ]


class _NameRecord(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("struct_size", ctypes.c_uint32),
        ("candidate_id", ctypes.c_uint64),
        ("kind", ctypes.c_uint32),
        ("locale_offset", ctypes.c_uint32),
        ("locale_length", ctypes.c_uint32),
        ("value_offset", ctypes.c_uint32),
        ("value_length", ctypes.c_uint32),
    ]


class _FaceRequest(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("struct_size", ctypes.c_uint32),
        ("candidate_id", ctypes.c_uint64),
        ("generation", ctypes.c_uint32),
        ("flags", ctypes.c_uint32),
        ("codepoints", ctypes.POINTER(ctypes.c_uint32)),
        ("codepoint_count", ctypes.c_uint32),
        ("reserved", ctypes.c_uint32),
    ]


class _FaceRecord(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("struct_size", ctypes.c_uint32),
        ("candidate_id", ctypes.c_uint64),
        ("generation", ctypes.c_uint32),
        ("hresult", ctypes.c_int32),
        ("status_flags", ctypes.c_uint32),
        ("face_index", ctypes.c_uint32),
        ("simulations", ctypes.c_uint32),
        ("file_count", ctypes.c_uint32),
        ("local_file_count", ctypes.c_uint32),
        ("glyph_count", ctypes.c_uint32),
        ("first_file", ctypes.c_uint32),
        ("first_glyph", ctypes.c_uint32),
        ("path_offset", ctypes.c_uint32),
        ("path_length", ctypes.c_uint32),
        ("glyph_hresult", ctypes.c_int32),
    ]


class _FileRecord(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("struct_size", ctypes.c_uint32),
        ("candidate_id", ctypes.c_uint64),
        ("file_index", ctypes.c_uint32),
        ("local_loader_available", ctypes.c_uint32),
        ("key_size", ctypes.c_uint32),
        ("loader_hresult", ctypes.c_int32),
        ("path_offset", ctypes.c_uint32),
        ("path_length", ctypes.c_uint32),
    ]


class _GlyphRecord(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("struct_size", ctypes.c_uint32),
        ("codepoint", ctypes.c_uint32),
        ("glyph_index", ctypes.c_uint16),
        ("flags", ctypes.c_uint16),
        ("hresult", ctypes.c_int32),
    ]


class _ErrorRecord(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("struct_size", ctypes.c_uint32),
        ("category", ctypes.c_uint32),
        ("status", ctypes.c_int32),
        ("hresult", ctypes.c_int32),
        ("detail_bytes", ctypes.c_uint32),
    ]


@dataclass(frozen=True, slots=True)
class NativeFontName:
    kind: int
    locale: str
    value: str


@dataclass(frozen=True, slots=True)
class NativeFontCandidate:
    candidate_id: int
    generation: int
    family_index: int
    font_index: int
    weight: int
    style: int
    stretch: int
    simulations: int
    names: tuple[NativeFontName, ...]


@dataclass(frozen=True, slots=True)
class NativeFontFile:
    file_index: int
    local_loader_available: bool
    key_size: int
    loader_hresult: int
    path: str


@dataclass(frozen=True, slots=True)
class NativeFontGlyph:
    codepoint: int
    glyph_index: int
    flags: int
    hresult: int


@dataclass(frozen=True, slots=True)
class NativeFontFace:
    candidate_id: int
    generation: int
    hresult: int
    status_flags: int
    face_index: int
    simulations: int
    file_count: int
    local_file_count: int
    glyph_hresult: int
    path: str
    files: tuple[NativeFontFile, ...]
    glyphs: tuple[NativeFontGlyph, ...]


def _versioned(struct_type: type[ctypes.Structure]) -> ctypes.Structure:
    value = struct_type()
    value.abi_version = ABI_VERSION
    value.struct_size = ctypes.sizeof(struct_type)
    return value


def _decode_utf16(blob: bytes, offset: int, length: int, *, field: str) -> str:
    if offset < 0 or length < 0 or offset > len(blob) or length > len(blob) - offset:
        raise NativeFontCollectorError(f"native {field} string range is outside the returned buffer")
    if offset % 2 or length % 2:
        raise NativeFontCollectorError(f"native {field} string range is not UTF-16 aligned")
    try:
        return blob[offset : offset + length].decode("utf-16-le", errors="strict")
    except UnicodeDecodeError as exc:
        raise NativeFontCollectorError(f"native {field} string is not valid UTF-16LE") from exc


def _dll_paths() -> tuple[Path, ...]:
    paths: list[Path] = []
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        paths.append(Path(bundle_root) / "songcut_native" / DLL_NAME)
    repo_root = Path(__file__).resolve().parents[1]
    paths.extend(
        [
            repo_root / "build" / "native" / "windows_font_resolver" / "x64" / "Release" / DLL_NAME,
            repo_root / "native" / "windows_font_resolver" / "x64" / "Release" / DLL_NAME,
        ]
    )
    return tuple(dict.fromkeys(path.resolve(strict=False) for path in paths))


def resolve_native_dll_path() -> Path:
    """Return the single deterministic native DLL path or raise explicitly."""

    paths = _dll_paths()
    existing = [path for path in paths if path.is_file()]
    if len(existing) == 1:
        return existing[0]
    if len(existing) > 1:
        raise NativeFontCollectorError(
            "multiple native font resolver DLLs were found: " + ", ".join(str(path) for path in existing)
        )
    raise NativeFontCollectorError(
        "native font resolver DLL was not found; build it with "
        "packaging\\build_native_font_resolver.ps1 (searched: "
        + ", ".join(str(path) for path in paths)
        + ")"
    )


class NativeFontCollector:
    """Own one native DirectWrite collection handle and caller-owned buffers."""

    def __init__(self, dll_path: Path | None = None) -> None:
        path = (dll_path or resolve_native_dll_path()).resolve(strict=True)
        try:
            dll = ctypes.WinDLL(str(path))
        except (AttributeError, OSError) as exc:
            raise NativeFontCollectorError(f"cannot load native font resolver DLL {path}: {exc}") from exc
        self._path = path
        self._dll = dll
        self._handle = ctypes.c_void_p()
        self._lock = threading.RLock()
        self._configure_abi()
        request = _versioned(_CreateRequest)
        status = self._dll.scut_font_resolver_create(ctypes.byref(request), ctypes.byref(self._handle))
        if status != STATUS_OK or not self._handle.value:
            raise NativeFontCollectorError(
                f"native font resolver create failed with status {status}",
                status=int(status),
            )

    @property
    def dll_path(self) -> Path:
        return self._path

    def _configure_abi(self) -> None:
        dll = self._dll
        dll.scut_font_resolver_create.argtypes = [ctypes.POINTER(_CreateRequest), ctypes.POINTER(ctypes.c_void_p)]
        dll.scut_font_resolver_create.restype = ctypes.c_int
        dll.scut_font_resolver_destroy.argtypes = [ctypes.c_void_p]
        dll.scut_font_resolver_destroy.restype = None
        dll.scut_font_resolver_refresh.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        dll.scut_font_resolver_refresh.restype = ctypes.c_int
        dll.scut_font_resolver_enumerate.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(_EnumRequest),
            ctypes.POINTER(_CandidateRecord),
            ctypes.c_uint32,
            ctypes.POINTER(_NameRecord),
            ctypes.c_uint32,
            ctypes.POINTER(ctypes.c_uint8),
            ctypes.c_uint32,
            ctypes.POINTER(ctypes.c_uint32),
            ctypes.POINTER(ctypes.c_uint32),
            ctypes.POINTER(ctypes.c_uint32),
            ctypes.POINTER(ctypes.c_uint32),
        ]
        dll.scut_font_resolver_enumerate.restype = ctypes.c_int
        dll.scut_font_resolver_inspect_face.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(_FaceRequest),
            ctypes.POINTER(_FaceRecord),
            ctypes.POINTER(_FileRecord),
            ctypes.c_uint32,
            ctypes.POINTER(_GlyphRecord),
            ctypes.c_uint32,
            ctypes.POINTER(ctypes.c_uint8),
            ctypes.c_uint32,
            ctypes.POINTER(ctypes.c_uint32),
            ctypes.POINTER(ctypes.c_uint32),
            ctypes.POINTER(ctypes.c_uint32),
        ]
        dll.scut_font_resolver_inspect_face.restype = ctypes.c_int
        dll.scut_font_resolver_get_error.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(_ErrorRecord),
            ctypes.POINTER(ctypes.c_uint8),
            ctypes.c_uint32,
            ctypes.POINTER(ctypes.c_uint32),
        ]
        dll.scut_font_resolver_get_error.restype = ctypes.c_int

    def close(self) -> None:
        with self._lock:
            if self._handle.value:
                self._dll.scut_font_resolver_destroy(self._handle)
                self._handle = ctypes.c_void_p()

    def __del__(self) -> None:  # pragma: no cover - interpreter shutdown is not deterministic
        try:
            self.close()
        except Exception:
            pass

    def _raise_status(self, status: int, operation: str) -> None:
        error = _versioned(_ErrorRecord)
        needed = ctypes.c_uint32()
        first = self._dll.scut_font_resolver_get_error(
            self._handle,
            ctypes.byref(error),
            None,
            0,
            ctypes.byref(needed),
        )
        detail = ""
        if first in {STATUS_OK, STATUS_BUFFER_TOO_SMALL} and needed.value:
            buffer = (ctypes.c_uint8 * needed.value)()
            second = self._dll.scut_font_resolver_get_error(
                self._handle,
                ctypes.byref(error),
                buffer,
                needed.value,
                ctypes.byref(needed),
            )
            if second == STATUS_OK:
                raw = bytes(buffer[: needed.value])
                try:
                    detail = raw.decode("utf-8", errors="strict").rstrip("\0")
                except UnicodeDecodeError:
                    detail = "<invalid UTF-8 native error detail>"
        message = f"native font collector {operation} failed with status {status}"
        if detail:
            message += f": {detail}"
        raise NativeFontCollectorError(
            message,
            status=int(status),
            category=int(error.category),
            hresult=int(error.hresult),
        )

    def refresh(self) -> int:
        with self._lock:
            generation = ctypes.c_uint32()
            status = self._dll.scut_font_resolver_refresh(self._handle, ctypes.byref(generation))
            if status != STATUS_OK:
                self._raise_status(status, "refresh")
            return int(generation.value)

    def enumerate(self) -> tuple[NativeFontCandidate, ...]:
        with self._lock:
            request = _versioned(_EnumRequest)
            candidate_count = ctypes.c_uint32()
            name_count = ctypes.c_uint32()
            string_bytes = ctypes.c_uint32()
            generation = ctypes.c_uint32()
            status = self._dll.scut_font_resolver_enumerate(
                self._handle,
                ctypes.byref(request),
                None,
                0,
                None,
                0,
                None,
                0,
                ctypes.byref(candidate_count),
                ctypes.byref(name_count),
                ctypes.byref(string_bytes),
                ctypes.byref(generation),
            )
            if status not in {STATUS_OK, STATUS_BUFFER_TOO_SMALL}:
                self._raise_status(status, "enumerate sizing")
            candidates = (_CandidateRecord * candidate_count.value)()
            names = (_NameRecord * name_count.value)()
            strings = (ctypes.c_uint8 * string_bytes.value)()
            status = self._dll.scut_font_resolver_enumerate(
                self._handle,
                ctypes.byref(request),
                candidates,
                candidate_count.value,
                names,
                name_count.value,
                strings,
                string_bytes.value,
                ctypes.byref(candidate_count),
                ctypes.byref(name_count),
                ctypes.byref(string_bytes),
                ctypes.byref(generation),
            )
            if status != STATUS_OK:
                self._raise_status(status, "enumerate")
            blob = bytes(strings[: string_bytes.value])
            result: list[NativeFontCandidate] = []
            for record in candidates[: candidate_count.value]:
                if record.abi_version != ABI_VERSION or record.struct_size != ctypes.sizeof(_CandidateRecord):
                    raise NativeFontCollectorError("native candidate record ABI does not match Python")
                end = int(record.first_name) + int(record.name_count)
                if end > name_count.value:
                    raise NativeFontCollectorError("native candidate name range is outside the returned array")
                candidate_names: list[NativeFontName] = []
                for name in names[record.first_name:end]:
                    if name.abi_version != ABI_VERSION or name.struct_size != ctypes.sizeof(_NameRecord):
                        raise NativeFontCollectorError("native name record ABI does not match Python")
                    if name.candidate_id != record.candidate_id:
                        raise NativeFontCollectorError("native name record belongs to a different candidate")
                    candidate_names.append(
                        NativeFontName(
                            kind=int(name.kind),
                            locale=_decode_utf16(blob, name.locale_offset, name.locale_length, field="locale"),
                            value=_decode_utf16(blob, name.value_offset, name.value_length, field="name"),
                        )
                    )
                result.append(
                    NativeFontCandidate(
                        candidate_id=int(record.candidate_id),
                        generation=int(record.generation),
                        family_index=int(record.family_index),
                        font_index=int(record.font_index),
                        weight=int(record.weight),
                        style=int(record.style),
                        stretch=int(record.stretch),
                        simulations=int(record.simulations),
                        names=tuple(candidate_names),
                    )
                )
            return tuple(result)

    def inspect_face(self, candidate: NativeFontCandidate, codepoints: Sequence[int]) -> NativeFontFace:
        normalized = tuple(int(item) for item in codepoints)
        if any(item < 0 or item > 0x10FFFF for item in normalized):
            raise NativeFontCollectorError("font probe codepoints must be valid Unicode scalar values")
        array = (ctypes.c_uint32 * len(normalized))(*normalized)
        request = _versioned(_FaceRequest)
        request.candidate_id = candidate.candidate_id
        request.generation = candidate.generation
        request.codepoints = ctypes.cast(array, ctypes.POINTER(ctypes.c_uint32)) if normalized else None
        request.codepoint_count = len(normalized)
        with self._lock:
            face = _versioned(_FaceRecord)
            file_count = ctypes.c_uint32()
            glyph_count = ctypes.c_uint32()
            string_bytes = ctypes.c_uint32()
            status = self._dll.scut_font_resolver_inspect_face(
                self._handle,
                ctypes.byref(request),
                ctypes.byref(face),
                None,
                0,
                None,
                0,
                None,
                0,
                ctypes.byref(file_count),
                ctypes.byref(glyph_count),
                ctypes.byref(string_bytes),
            )
            if status not in {STATUS_OK, STATUS_BUFFER_TOO_SMALL}:
                self._raise_status(status, "inspect sizing")
            files = (_FileRecord * file_count.value)()
            glyphs = (_GlyphRecord * glyph_count.value)()
            strings = (ctypes.c_uint8 * string_bytes.value)()
            face = _versioned(_FaceRecord)
            status = self._dll.scut_font_resolver_inspect_face(
                self._handle,
                ctypes.byref(request),
                ctypes.byref(face),
                files,
                file_count.value,
                glyphs,
                glyph_count.value,
                strings,
                string_bytes.value,
                ctypes.byref(file_count),
                ctypes.byref(glyph_count),
                ctypes.byref(string_bytes),
            )
            if status != STATUS_OK:
                self._raise_status(status, "inspect")
            if face.abi_version != ABI_VERSION or face.struct_size != ctypes.sizeof(_FaceRecord):
                raise NativeFontCollectorError("native face record ABI does not match Python")
            blob = bytes(strings[: string_bytes.value])
            native_files: list[NativeFontFile] = []
            for record in files[: file_count.value]:
                if record.abi_version != ABI_VERSION or record.struct_size != ctypes.sizeof(_FileRecord):
                    raise NativeFontCollectorError("native file record ABI does not match Python")
                native_files.append(
                    NativeFontFile(
                        file_index=int(record.file_index),
                        local_loader_available=bool(record.local_loader_available),
                        key_size=int(record.key_size),
                        loader_hresult=int(record.loader_hresult),
                        path=_decode_utf16(blob, record.path_offset, record.path_length, field="file path"),
                    )
                )
            native_glyphs: list[NativeFontGlyph] = []
            for record in glyphs[: glyph_count.value]:
                if record.abi_version != ABI_VERSION or record.struct_size != ctypes.sizeof(_GlyphRecord):
                    raise NativeFontCollectorError("native glyph record ABI does not match Python")
                native_glyphs.append(
                    NativeFontGlyph(
                        codepoint=int(record.codepoint),
                        glyph_index=int(record.glyph_index),
                        flags=int(record.flags),
                        hresult=int(record.hresult),
                    )
                )
            return NativeFontFace(
                candidate_id=int(face.candidate_id),
                generation=int(face.generation),
                hresult=int(face.hresult),
                status_flags=int(face.status_flags),
                face_index=int(face.face_index),
                simulations=int(face.simulations),
                file_count=int(face.file_count),
                local_file_count=int(face.local_file_count),
                glyph_hresult=int(face.glyph_hresult),
                path=_decode_utf16(blob, face.path_offset, face.path_length, field="face path"),
                files=tuple(native_files),
                glyphs=tuple(native_glyphs),
            )


_COLLECTOR_LOCK = threading.RLock()
_COLLECTOR: NativeFontCollector | None = None


def get_native_font_collector() -> NativeFontCollector:
    global _COLLECTOR
    with _COLLECTOR_LOCK:
        if _COLLECTOR is None:
            _COLLECTOR = NativeFontCollector()
        return _COLLECTOR


def reset_native_font_collector() -> None:
    global _COLLECTOR
    with _COLLECTOR_LOCK:
        if _COLLECTOR is not None:
            _COLLECTOR.close()
        _COLLECTOR = None


__all__ = [
    "ABI_VERSION",
    "DLL_NAME",
    "FACE_CREATED",
    "GLYPH_QUERY_FAILED",
    "LOCAL_LOADER_AVAILABLE",
    "MULTIPLE_FILES",
    "NAME_FACE",
    "NAME_FAMILY",
    "NAME_FULL",
    "NAME_POSTSCRIPT",
    "NativeFontCandidate",
    "NativeFontCollector",
    "NativeFontCollectorError",
    "NativeFontFace",
    "NativeFontFile",
    "NativeFontGlyph",
    "NativeFontName",
    "PATH_RESOLVED",
    "get_native_font_collector",
    "reset_native_font_collector",
    "resolve_native_dll_path",
]

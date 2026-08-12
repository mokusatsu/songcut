from __future__ import annotations

from pathlib import Path
import struct

import pytest

import songcut.windows_font_native as native


@pytest.fixture(autouse=True)
def _reset_collector() -> None:
    native.reset_native_font_collector()
    yield
    native.reset_native_font_collector()


def test_native_dll_is_x64() -> None:
    dll = native.resolve_native_dll_path()
    data = dll.read_bytes()
    assert data[:2] == b"MZ"
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    assert data[pe_offset : pe_offset + 4] == b"PE\0\0"
    assert struct.unpack_from("<H", data, pe_offset + 4)[0] == 0x8664


def test_native_collector_enumerates_unfiltered_raw_metadata() -> None:
    candidates = native.get_native_font_collector().enumerate()

    assert len(candidates) > 10
    assert len({candidate.candidate_id for candidate in candidates}) == len(candidates)
    assert len({candidate.generation for candidate in candidates}) == 1
    assert all(candidate.weight > 0 for candidate in candidates)
    assert all(candidate.names for candidate in candidates)
    assert any(name.kind == native.NAME_FAMILY for candidate in candidates for name in candidate.names)
    assert any(name.kind == native.NAME_FACE for candidate in candidates for name in candidate.names)


def test_native_face_probe_returns_raw_file_and_glyph_information() -> None:
    collector = native.get_native_font_collector()
    candidates = collector.enumerate()
    candidate = next(
        item
        for item in candidates
        if any(name.kind == native.NAME_FAMILY and name.value.casefold() == "yu gothic ui" for name in item.names)
    )

    face = collector.inspect_face(candidate, [ord("日"), ord("本"), 0x1F600])

    assert face.candidate_id == candidate.candidate_id
    assert face.generation == candidate.generation
    assert face.file_count == len(face.files)
    assert [glyph.codepoint for glyph in face.glyphs] == [ord("日"), ord("本"), 0x1F600]
    assert all(glyph.hresult <= 0 or glyph.hresult == 0 for glyph in face.glyphs)


def test_missing_native_dll_is_an_explicit_error(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(native, "_dll_paths", lambda: (tmp_path / native.DLL_NAME,))

    with pytest.raises(native.NativeFontCollectorError, match="was not found"):
        native.resolve_native_dll_path()


def test_font_runtime_sources_do_not_launch_a_helper_process() -> None:
    source_root = Path(__file__).resolve().parents[1] / "songcut"
    text = "\n".join(
        (source_root / name).read_text(encoding="utf-8")
        for name in ("windows_font_native.py", "windows_font_resolver.py")
    ).casefold()

    for forbidden in (
        "powershell",
        "pwsh",
        "presentationcore",
        "encodedcommand",
        "songcut_powershell",
        "subprocess.run",
        "subprocess.popen",
        "win_safesubprocess",
    ):
        assert forbidden not in text

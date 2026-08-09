from __future__ import annotations

import hashlib
import os
from pathlib import Path
import struct

import pytest

import songcut.windows_font_resolver as resolver


def _name_table(
    family: str = "Test Family",
    subfamily: str = "Regular",
    full_name: str = "Test Family Regular",
    postscript: str = "TestFamily-Regular",
) -> bytes:
    values = {
        1: family,
        2: subfamily,
        4: full_name,
        6: postscript,
    }
    payloads = [value.encode("utf-16-be") for value in values.values()]
    storage_offset = 6 + 12 * len(payloads)
    records = bytearray()
    storage = bytearray()
    for name_id, payload in zip(values, payloads):
        records.extend(struct.pack(">HHHHHH", 3, 1, 0x0409, name_id, len(payload), len(storage)))
        storage.extend(payload)
    return struct.pack(">HHH", 0, len(payloads), storage_offset) + records + storage


def _sfnt_face(
    *,
    family: str = "Test Family",
    subfamily: str = "Regular",
    full_name: str = "Test Family Regular",
    postscript: str = "TestFamily-Regular",
    table_offset: int = 28,
) -> bytes:
    table = _name_table(family, subfamily, full_name, postscript)
    header = struct.pack(">IHHHH", 0x00010000, 1, 0, 0, 0)
    directory = b"name" + struct.pack(">III", 0, table_offset, len(table))
    padding = b"\0" * (table_offset - len(header) - len(directory))
    return header + directory + padding + table


def _ttc(path: Path, *, faces: int = 2) -> Path:
    face_blobs: list[bytes] = []
    header_size = 12 + faces * 4
    offset = header_size
    for index in range(faces):
        blob = bytearray(_sfnt_face(
            family="Yu Gothic UI",
            subfamily="Bold" if index else "Regular",
            full_name=f"Yu Gothic UI {'Bold' if index else 'Regular'}",
            postscript=f"YuGothicUI-{'Bold' if index else 'Regular'}",
            table_offset=28,
        ))
        # TTC table offsets are absolute file offsets, not relative to the
        # individual SFNT header.
        struct.pack_into(">I", blob, 20, offset + 28)
        face_blobs.append(bytes(blob))
        offset += len(blob)
    offsets = []
    offset = header_size
    for blob in face_blobs:
        offsets.append(offset)
        offset += len(blob)
    data = b"ttcf" + struct.pack(">II", 0x00010000, faces) + b"".join(struct.pack(">I", item) for item in offsets)
    data += b"".join(face_blobs)
    path.write_bytes(data)
    return path


def _ttf(path: Path) -> Path:
    path.write_bytes(_sfnt_face())
    return path


def _candidate(
    path: Path | None,
    *,
    family: str = "Yu Gothic UI",
    face_index: int | None = 1,
    weight: int = 400,
    style: str = "Normal",
    simulations: str = "None",
    face_name: str = "Regular",
    missing: list[int] | None = None,
    coverage_checked: bool = True,
    is_file: bool = True,
    face_index_known: bool = True,
) -> dict[str, object]:
    return {
        "family_source": family,
        "family_names": [family],
        "win32_family_names": [family],
        "face_names": [face_name],
        "win32_face_names": [face_name],
        "path": str(path) if path is not None else None,
        "is_file": is_file,
        "face_index": face_index,
        "face_index_known": face_index_known,
        "weight": weight,
        "style": style,
        "style_simulations": simulations,
        "coverage_checked": coverage_checked,
        "missing_codepoints": missing or [],
    }


@pytest.fixture(autouse=True)
def _reset_font_cache() -> None:
    resolver.clear_font_cache()
    yield
    resolver.clear_font_cache()


def test_resolves_local_ttc_face_and_caches_probe(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    font_path = _ttc(tmp_path / "YuGothM.ttc")
    record = _candidate(font_path)
    calls = 0

    def fake_probe(family: str, text: str) -> list[dict[str, object]]:
        nonlocal calls
        calls += 1
        assert family == "Yu Gothic UI"
        assert text == "日本語"
        return [record]

    monkeypatch.setattr(resolver, "_run_wpf_probe", fake_probe)
    record["weight"] = 700
    record["face_names"] = ["Bold"]
    record["win32_face_names"] = ["Bold"]
    first = resolver.resolve_windows_font("Yu Gothic UI", bold=True, text="日本語")
    second = resolver.resolve_windows_font("Yu Gothic UI", bold=True, text="日本語")

    assert first is second
    assert first.font_path == font_path.resolve()
    assert first.face_index == 1
    assert first.postscript_name == "YuGothicUI-Bold"
    assert first.file_sha256 == hashlib.sha256(font_path.read_bytes()).hexdigest()
    assert calls == 1


def test_single_face_cannot_claim_nonzero_ttc_index(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    font_path = _ttf(tmp_path / "test.ttf")
    monkeypatch.setattr(
        resolver,
        "_run_wpf_probe",
        lambda family, text: [_candidate(font_path, face_index=1)],
    )

    with pytest.raises(resolver.FontMetadataError, match="single-face"):
        resolver.resolve_windows_font("Yu Gothic UI")


def test_unknown_collection_index_is_an_explicit_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    font_path = _ttc(tmp_path / "test.ttc")
    monkeypatch.setattr(
        resolver,
        "_run_wpf_probe",
        lambda family, text: [_candidate(font_path, face_index=0, face_index_known=False)],
    )

    with pytest.raises(resolver.FontMetadataError, match="trustworthy TTC face index"):
        resolver.resolve_windows_font("Yu Gothic UI")


def test_missing_coverage_is_an_explicit_error(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    font_path = _ttf(tmp_path / "test.ttf")
    monkeypatch.setattr(
        resolver,
        "_run_wpf_probe",
        lambda family, text: [_candidate(font_path, face_index=0, missing=[0x1F600])],
    )

    with pytest.raises(resolver.FontCoverageError, match=r"U\+1F600"):
        resolver.resolve_windows_font("Yu Gothic UI", text="😀")


def test_shaping_controls_and_variation_selectors_are_not_missing_glyphs(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    font_path = _ttf(tmp_path / "test.ttf")
    record = _candidate(
        font_path,
        family="Test Family",
        face_index=0,
        missing=[0x200C, 0x200D, 0xFE0F, 0xE0100],
    )
    monkeypatch.setattr(resolver, "_run_wpf_probe", lambda family, text: [record])

    resolved = resolver.resolve_windows_font("Test Family", text="👩\u200d💻")
    assert resolved.postscript_name == "TestFamily-Regular"


def test_style_simulation_is_not_accepted_as_italic(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    font_path = _ttf(tmp_path / "test.ttf")
    monkeypatch.setattr(
        resolver,
        "_run_wpf_probe",
        lambda family, text: [
            _candidate(
                font_path,
                face_index=0,
                style="Oblique",
                simulations="ItalicSimulation",
            )
        ],
    )

    with pytest.raises(resolver.FontStyleMismatchError, match="simulation"):
        resolver.resolve_windows_font("Yu Gothic UI", italic=True)


def test_remote_or_in_memory_face_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        resolver,
        "_run_wpf_probe",
        lambda family, text: [_candidate(None, is_file=False)],
    )

    with pytest.raises(resolver.FontMetadataError, match="remote"):
        resolver.resolve_windows_font("Yu Gothic UI")


def test_registry_like_unmatched_record_is_not_silently_used(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    font_path = _ttf(tmp_path / "other.ttf")
    monkeypatch.setattr(
        resolver,
        "_run_wpf_probe",
        lambda family, text: [_candidate(font_path, family="Other Family", face_index=0)],
    )

    with pytest.raises(resolver.FontNotFoundError, match="not found exactly"):
        resolver.resolve_windows_font("Yu Gothic UI")


def test_libass_debug_selection_can_be_verified(tmp_path: Path) -> None:
    font_path = _ttf(tmp_path / "test.ttf")
    record = _candidate(font_path, face_index=0)
    # Construct through the same validated path used by the public resolver.
    record["family_source"] = "Test Family"
    record["family_names"] = ["Test Family"]
    record["win32_family_names"] = ["Test Family"]
    resolved = resolver._resolve_candidate(
        record,
        requested_family="Test Family",
        bold=False,
        italic=False,
    )
    log = (
        "[Parsed_ass_0 @ 0x1] fontselect: (Test Family, 400, 0) -> "
        "TestFamily-Regular, 0, Test Family Regular\n"
    )
    selection = resolver.verify_libass_fontselect(resolved, log)
    assert selection.postscript_name == resolved.postscript_name
    assert resolver.parse_libass_fontselect(log)[0].face_index == 0


def test_libass_mismatch_is_an_explicit_error(tmp_path: Path) -> None:
    mismatch_record = _candidate(_ttf(tmp_path / "test.ttf"), face_index=0, family="Test Family")
    resolved = resolver._resolve_candidate(
        mismatch_record,
        requested_family="Test Family",
        bold=False,
        italic=False,
    )
    with pytest.raises(resolver.FontResolutionError, match="did not select"):
        resolver.verify_libass_fontselect(
            resolved,
            "fontselect: (Yu Gothic UI, 400, 0) -> ArialMT, 0, ArialMT",
        )


@pytest.mark.skipif(os.name != "nt", reason="WPF integration requires Windows")
def test_current_windows_yu_gothic_ui_regular_bold_and_italic() -> None:
    try:
        regular = resolver.resolve_windows_font("Yu Gothic UI", text="日本語")
        bold = resolver.resolve_windows_font("Yu Gothic UI", bold=True, text="日本語")
    except resolver.FontResolverUnavailableError as exc:
        pytest.skip(str(exc))
    except resolver.FontNotFoundError as exc:
        pytest.skip(str(exc))

    assert regular.font_path.exists()
    assert bold.font_path.exists()
    assert regular.face_index >= 0
    assert bold.face_index >= 0
    assert regular.style_simulations.casefold() in {"none", ""}
    assert bold.style_simulations.casefold() in {"none", ""}

    # Yu Gothic UI has no physical italic face on the target Windows image;
    # the resolver must reject WPF's ItalicSimulation instead of synthesizing.
    try:
        italic = resolver.resolve_windows_font("Yu Gothic UI", italic=True, text="日本語")
    except resolver.FontStyleMismatchError:
        return
    assert italic.italic
    assert italic.style_simulations.casefold() in {"none", ""}

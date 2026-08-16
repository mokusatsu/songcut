from __future__ import annotations

import os
import struct
from pathlib import Path

import pytest

from lossless_audio_gain.aac import apply_aac_global_gain, hash_mp4_mdat
from lossless_audio_gain.exceptions import BackendError


def make_box(box_type: bytes, payload: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(payload), box_type) + payload


def make_fake_mp4(path: Path, gain_byte: int) -> None:
    path.write_bytes(
        make_box(b"ftyp", b"M4A \x00\x00\x00\x00M4A isom")
        + make_box(b"mdat", bytes([gain_byte]) + b"audio-payload")
    )


def make_fake_mp3rgain(path: Path) -> None:
    path.write_text(
        r'''#!/usr/bin/env python3
import json
import struct
import sys
from pathlib import Path

args = sys.argv[1:]
steps = int(args[args.index("-g") + 1])
target = Path(args[-1])
data = bytearray(target.read_bytes())
marker = data.find(b"mdat")
if marker < 4:
    print(json.dumps({"files": [{"file": str(target), "status": "error", "error": "no mdat"}]}))
    raise SystemExit(1)
payload = marker + 4
old = data[payload]
data[payload] = max(0, min(255, old + steps))
target.write_bytes(data)
print(json.dumps({
    "files": [{
        "file": str(target),
        "status": "success",
        "frames": 1,
        "gain_applied_steps": steps,
        "gain_applied_db": steps * 1.5
    }],
    "summary": {"total_files": 1, "successful": 1, "failed": 0}
}))
''',
        encoding="utf-8",
    )
    path.chmod(path.stat().st_mode | 0o111)


def test_hash_mp4_mdat_ignores_metadata_offsets(tmp_path: Path):
    first = tmp_path / "a.m4a"
    second = tmp_path / "b.m4a"
    payload = b"same-compressed-audio"
    first.write_bytes(make_box(b"ftyp", b"one") + make_box(b"mdat", payload))
    second.write_bytes(
        make_box(b"ftyp", b"different-longer-metadata") + make_box(b"mdat", payload)
    )
    assert hash_mp4_mdat(first) == hash_mp4_mdat(second)


def test_aac_backend_checks_reversible_mdat(tmp_path: Path):
    media = tmp_path / "input.m4a"
    backend = tmp_path / "mp3rgain"
    make_fake_mp4(media, 100)
    make_fake_mp3rgain(backend)

    before = hash_mp4_mdat(media)
    details = apply_aac_global_gain(
        media,
        steps=2,
        mp3rgain_bin=str(backend),
        check_reversible=True,
    )
    assert details["reversibility_checked"] is True
    assert details["steps"] == 2
    assert hash_mp4_mdat(media) != before
    assert media.read_bytes().find(bytes([102])) >= 0


def test_aac_backend_rejects_saturating_change(tmp_path: Path):
    media = tmp_path / "input.m4a"
    backend = tmp_path / "mp3rgain"
    make_fake_mp4(media, 1)
    make_fake_mp3rgain(backend)

    original = media.read_bytes()
    with pytest.raises(BackendError, match="round-trip"):
        apply_aac_global_gain(
            media,
            steps=-5,
            mp3rgain_bin=str(backend),
            check_reversible=True,
        )
    assert media.read_bytes() == original


def test_aac_backend_rejects_zero_modified_count(tmp_path: Path):
    media = tmp_path / "input.m4a"
    backend = tmp_path / "mp3rgain-zero"
    make_fake_mp4(media, 100)
    backend.write_text(
        """#!/usr/bin/env python3
import json
import sys
print(json.dumps({"files": [{"status": "success", "frames": 0, "gain_applied_steps": int(sys.argv[sys.argv.index('-g') + 1])}]}))
""",
        encoding="utf-8",
    )
    backend.chmod(backend.stat().st_mode | 0o111)
    original = media.read_bytes()
    with pytest.raises(BackendError, match="zero modified"):
        apply_aac_global_gain(
            media,
            steps=1,
            mp3rgain_bin=str(backend),
            check_reversible=False,
        )
    assert media.read_bytes() == original

from __future__ import annotations

import struct
from pathlib import Path

from lossless_audio_gain.opus import inspect_ogg_opus, ogg_crc, patch_ogg_opus_gain


def make_page(packet: bytes, *, sequence: int, serial: int, header_type: int) -> bytes:
    assert len(packet) < 255
    page = bytearray(28 + len(packet))
    page[0:4] = b"OggS"
    page[4] = 0
    page[5] = header_type
    struct.pack_into("<Q", page, 6, 0)
    struct.pack_into("<I", page, 14, serial)
    struct.pack_into("<I", page, 18, sequence)
    page[26] = 1
    page[27] = len(packet)
    page[28:] = packet
    page[22:26] = b"\0" * 4
    struct.pack_into("<I", page, 22, ogg_crc(page))
    return bytes(page)


def opus_tags(*comments: bytes) -> bytes:
    packet = bytearray(b"OpusTags")
    vendor = b"test"
    packet += struct.pack("<I", len(vendor)) + vendor
    packet += struct.pack("<I", len(comments))
    for comment in comments:
        packet += struct.pack("<I", len(comment)) + comment
    return bytes(packet)


def test_patch_opushead_and_neutralize_r128(tmp_path: Path):
    head = bytearray(b"OpusHead")
    head += bytes([1, 2])
    head += struct.pack("<H", 312)
    head += struct.pack("<I", 48000)
    head += struct.pack("<h", 0)
    head += bytes([0])
    tags = opus_tags(b"R128_TRACK_GAIN=-256", b"TITLE=Example")
    audio_packet = b"\xf8\xff\xfe"
    original = (
        make_page(bytes(head), sequence=0, serial=1234, header_type=2)
        + make_page(tags, sequence=1, serial=1234, header_type=0)
        + make_page(audio_packet, sequence=2, serial=1234, header_type=4)
    )
    source = tmp_path / "in.opus"
    output = tmp_path / "out.opus"
    source.write_bytes(original)

    report = patch_ogg_opus_gain(source, output, gain_q78_delta=256)
    assert report.streams_patched == 1
    assert report.new_output_gains_db == (1.0,)
    assert report.r128_tags_neutralized == 1
    result = output.read_bytes()
    assert b"X128_TRACK_GAIN=-256" in result
    assert audio_packet in result
    info = inspect_ogg_opus(output)
    assert info["output_gains_db"] == [1.0]
    assert info["logical_streams"] == 1
    assert info["r128_gain_tags"] == []


def test_zero_gain_is_byte_identical_and_keeps_r128(tmp_path: Path):
    head = bytearray(b"OpusHead")
    head += bytes([1, 1])
    head += struct.pack("<H", 312)
    head += struct.pack("<I", 48000)
    head += struct.pack("<h", 0)
    head += bytes([0])
    tags = opus_tags(b"R128_TRACK_GAIN=-256")
    original = (
        make_page(bytes(head), sequence=0, serial=7, header_type=2)
        + make_page(tags, sequence=1, serial=7, header_type=4)
    )
    source = tmp_path / "zero-in.opus"
    output = tmp_path / "zero-out.opus"
    source.write_bytes(original)

    report = patch_ogg_opus_gain(source, output, gain_q78_delta=0)
    assert output.read_bytes() == original
    assert report.r128_tags_found == 0
    assert report.r128_tags_neutralized == 0
    assert report.pages_rechecksummed == 0


def test_corrupt_ogg_crc_is_rejected(tmp_path: Path):
    head = bytearray(b"OpusHead")
    head += bytes([1, 1])
    head += struct.pack("<H", 312)
    head += struct.pack("<I", 48000)
    head += struct.pack("<h", 0)
    head += bytes([0])
    data = bytearray(make_page(bytes(head), sequence=0, serial=9, header_type=6))
    data[-1] ^= 1
    source = tmp_path / "bad.opus"
    output = tmp_path / "out.opus"
    source.write_bytes(data)

    from lossless_audio_gain.exceptions import InvalidMediaError

    try:
        patch_ogg_opus_gain(source, output, gain_q78_delta=1)
    except InvalidMediaError as exc:
        assert "CRC mismatch" in str(exc)
    else:
        raise AssertionError("corrupt Ogg CRC was accepted")


def test_missing_opustags_is_rejected(tmp_path: Path):
    head = bytearray(b"OpusHead")
    head += bytes([1, 1])
    head += struct.pack("<H", 312)
    head += struct.pack("<I", 48000)
    head += struct.pack("<h", 0)
    head += bytes([0])
    audio = b"\xf8\xff\xfe"
    source = tmp_path / "missing-tags.opus"
    output = tmp_path / "out.opus"
    source.write_bytes(
        make_page(bytes(head), sequence=0, serial=11, header_type=2)
        + make_page(audio, sequence=1, serial=11, header_type=4)
    )

    from lossless_audio_gain.exceptions import InvalidMediaError

    try:
        patch_ogg_opus_gain(source, output, gain_q78_delta=1)
    except InvalidMediaError as exc:
        assert "OpusTags" in str(exc)
    else:
        raise AssertionError("Ogg Opus without OpusTags was accepted")

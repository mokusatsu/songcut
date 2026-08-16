"""Bit-exact Ogg Opus header gain editor.

Only OpusHead and, when requested, R128 tag names are changed. Opus audio
packets are left byte-for-byte untouched. Affected Ogg page CRCs are rebuilt.
"""

from __future__ import annotations

import math
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from .exceptions import GainRangeError, InvalidMediaError, UnsupportedFormatError

R128Policy = Literal["neutralize", "keep", "error"]
_MAX_HEADER_PACKET_BYTES = 120 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class OggPage:
    index: int
    start: int
    end: int
    body_start: int
    serial: int
    sequence: int
    header_type: int
    lacing: tuple[int, ...]


@dataclass(frozen=True, slots=True)
class OggPacketChunk:
    packet_start: int
    file_start: int
    length: int
    page_index: int


@dataclass(frozen=True, slots=True)
class OggPacket:
    serial: int
    packet_index: int
    starts_on_bos_page: bool
    data: bytes
    chunks: tuple[OggPacketChunk, ...]


@dataclass(frozen=True, slots=True)
class OpusPatchReport:
    streams_patched: int
    old_output_gains_db: tuple[float, ...]
    new_output_gains_db: tuple[float, ...]
    r128_tags_found: int
    r128_tags_neutralized: int
    pages_rechecksummed: int


@dataclass(slots=True)
class _PacketState:
    packet_data: bytearray = field(default_factory=bytearray)
    chunks: list[OggPacketChunk] = field(default_factory=list)
    packet_index: int = 0
    packet_start_page: int | None = None
    in_packet: bool = False
    capturing: bool = False
    last_sequence: int | None = None
    seen_bos: bool = False
    seen_eos: bool = False


def quantize_q78_db(gain_db: float, *, safe_not_above: bool = False) -> tuple[int, float]:
    """Quantize dB to signed Q7.8 delta and return ``(raw, represented_db)``."""

    if not math.isfinite(gain_db):
        raise ValueError("gain_db must be finite")
    scaled = gain_db * 256.0
    if safe_not_above:
        raw = math.floor(scaled + 1e-12)
    elif scaled >= 0:
        raw = math.floor(scaled + 0.5)
    else:
        raw = math.ceil(scaled - 0.5)
    if raw < -32768 or raw > 32767:
        raise GainRangeError(
            f"Requested Opus gain delta {gain_db:.6f} dB exceeds Q7.8 range"
        )
    return int(raw), raw / 256.0


def _crc_table() -> tuple[int, ...]:
    polynomial = 0x04C11DB7
    values: list[int] = []
    for value in range(256):
        remainder = value << 24
        for _ in range(8):
            if remainder & 0x80000000:
                remainder = ((remainder << 1) ^ polynomial) & 0xFFFFFFFF
            else:
                remainder = (remainder << 1) & 0xFFFFFFFF
        values.append(remainder)
    return tuple(values)


_OGG_CRC_TABLE = _crc_table()


def ogg_crc(page_bytes: bytes | bytearray) -> int:
    """Calculate an Ogg page CRC with the checksum field already zeroed."""

    checksum = 0
    for byte in page_bytes:
        checksum = (
            ((checksum << 8) & 0xFFFFFFFF)
            ^ _OGG_CRC_TABLE[((checksum >> 24) & 0xFF) ^ byte]
        )
    return checksum


def _page_crc(data: bytes | bytearray, start: int, end: int) -> int:
    page = bytearray(data[start:end])
    page[22:26] = b"\x00\x00\x00\x00"
    return ogg_crc(page)


def _parse_pages(data: bytes | bytearray, *, verify_crc: bool = True) -> list[OggPage]:
    pages: list[OggPage] = []
    offset = 0
    index = 0
    total = len(data)
    while offset < total:
        if offset + 27 > total or data[offset : offset + 4] != b"OggS":
            raise InvalidMediaError(f"Invalid Ogg page capture pattern at byte {offset}")
        version = data[offset + 4]
        if version != 0:
            raise InvalidMediaError(f"Unsupported Ogg bitstream version {version}")
        segment_count = data[offset + 26]
        table_end = offset + 27 + segment_count
        if table_end > total:
            raise InvalidMediaError("Truncated Ogg segment table")
        lacing = tuple(data[offset + 27 : table_end])
        body_size = sum(lacing)
        end = table_end + body_size
        if end > total:
            raise InvalidMediaError("Truncated Ogg page body")
        if verify_crc:
            stored_crc = struct.unpack_from("<I", data, offset + 22)[0]
            calculated_crc = _page_crc(data, offset, end)
            if stored_crc != calculated_crc:
                raise InvalidMediaError(
                    f"Ogg CRC mismatch on page {index}: "
                    f"stored 0x{stored_crc:08x}, calculated 0x{calculated_crc:08x}"
                )
        pages.append(
            OggPage(
                index=index,
                start=offset,
                end=end,
                body_start=table_end,
                serial=struct.unpack_from("<I", data, offset + 14)[0],
                sequence=struct.unpack_from("<I", data, offset + 18)[0],
                header_type=data[offset + 5],
                lacing=lacing,
            )
        )
        offset = end
        index += 1
    if not pages:
        raise InvalidMediaError("The file contains no Ogg pages")
    return pages


def _assemble_packets(
    data: bytes | bytearray,
    pages: list[OggPage],
    *,
    capture_packets_per_stream: int = 2,
) -> list[OggPacket]:
    """Validate packet continuity while retaining only header packets.

    Ogg Opus gain editing needs the first two packets (OpusHead/OpusTags), not
    every audio packet. Keeping byte-to-file mappings for the entire stream
    would multiply memory use dramatically, so later packets are boundary-
    checked but not materialized.
    """

    if capture_packets_per_stream < 1:
        raise ValueError("capture_packets_per_stream must be positive")
    states: dict[int, _PacketState] = {}
    packets: list[OggPacket] = []

    for page in pages:
        continuation = bool(page.header_type & 0x01)
        bos = bool(page.header_type & 0x02)
        eos = bool(page.header_type & 0x04)
        state = states.get(page.serial)

        if state is None:
            if continuation:
                raise InvalidMediaError(
                    f"Logical stream {page.serial} starts with a continued packet"
                )
            if not bos:
                raise InvalidMediaError(
                    f"First page of logical stream {page.serial} is not marked BOS"
                )
            if page.sequence != 0:
                raise InvalidMediaError(
                    f"First page of logical stream {page.serial} has sequence "
                    f"{page.sequence}, expected 0"
                )
            state = _PacketState(seen_bos=True)
            states[page.serial] = state
        else:
            if state.seen_eos:
                raise InvalidMediaError(
                    f"Logical stream {page.serial} has data after its EOS page"
                )
            expected = ((state.last_sequence or 0) + 1) & 0xFFFFFFFF
            if page.sequence != expected:
                raise InvalidMediaError(
                    f"Ogg page sequence discontinuity for stream {page.serial}: "
                    f"expected {expected}, got {page.sequence}"
                )
            if bos:
                raise InvalidMediaError(
                    f"Logical stream {page.serial} has more than one BOS page"
                )
            if continuation != state.in_packet:
                raise InvalidMediaError(
                    f"Invalid Ogg continuation flag for stream {page.serial}, "
                    f"page sequence {page.sequence}"
                )

        cursor = page.body_start
        for segment_size in page.lacing:
            if not state.in_packet:
                state.in_packet = True
                state.packet_start_page = page.index
                state.capturing = state.packet_index < capture_packets_per_stream
            segment_end = cursor + segment_size
            if state.capturing:
                if len(state.packet_data) + segment_size > _MAX_HEADER_PACKET_BYTES:
                    raise InvalidMediaError(
                        "Ogg header packet exceeds the 120 MiB safety limit"
                    )
                packet_start = len(state.packet_data)
                state.packet_data.extend(data[cursor:segment_end])
                if segment_size:
                    state.chunks.append(
                        OggPacketChunk(
                            packet_start=packet_start,
                            file_start=cursor,
                            length=segment_size,
                            page_index=page.index,
                        )
                    )
            cursor = segment_end
            if segment_size < 255:
                if state.capturing:
                    if state.packet_start_page is None:
                        raise InvalidMediaError("Missing Ogg packet start page")
                    start_page = pages[state.packet_start_page]
                    packets.append(
                        OggPacket(
                            serial=page.serial,
                            packet_index=state.packet_index,
                            starts_on_bos_page=bool(start_page.header_type & 0x02),
                            data=bytes(state.packet_data),
                            chunks=tuple(state.chunks),
                        )
                    )
                state.packet_index += 1
                state.packet_data.clear()
                state.chunks.clear()
                state.packet_start_page = None
                state.in_packet = False
                state.capturing = False

        if eos and state.in_packet:
            raise InvalidMediaError(
                f"EOS page leaves an unterminated packet in stream {page.serial}"
            )
        state.last_sequence = page.sequence
        state.seen_eos = eos

    for serial, state in states.items():
        if state.in_packet:
            raise InvalidMediaError(f"Unterminated Ogg packet in logical stream {serial}")
        if not state.seen_eos:
            raise InvalidMediaError(f"Logical stream {serial} has no EOS page")
    return packets


def _write_packet_byte(
    mutable: bytearray,
    packet: OggPacket,
    packet_offset: int,
    value: int,
    touched_pages: set[int],
    pages: list[OggPage],
) -> None:
    if packet_offset < 0 or packet_offset >= len(packet.data):
        raise InvalidMediaError("Packet-to-file offset mapping is incomplete")
    for chunk in packet.chunks:
        chunk_end = chunk.packet_start + chunk.length
        if chunk.packet_start <= packet_offset < chunk_end:
            file_offset = chunk.file_start + (packet_offset - chunk.packet_start)
            page = pages[chunk.page_index]
            if not (page.start <= file_offset < page.end):
                raise InvalidMediaError("Mapped packet byte falls outside its Ogg page")
            mutable[file_offset] = value
            touched_pages.add(chunk.page_index)
            return
    raise InvalidMediaError("Could not map modified packet byte to the Ogg file")


def _comment_name_ranges(packet_data: bytes) -> list[tuple[int, int]]:
    if not packet_data.startswith(b"OpusTags"):
        return []
    cursor = 8
    if cursor + 4 > len(packet_data):
        raise InvalidMediaError("Truncated OpusTags vendor length")
    vendor_length = struct.unpack_from("<I", packet_data, cursor)[0]
    cursor += 4 + vendor_length
    if cursor + 4 > len(packet_data):
        raise InvalidMediaError("Truncated OpusTags comment count")
    comment_count = struct.unpack_from("<I", packet_data, cursor)[0]
    cursor += 4
    ranges: list[tuple[int, int]] = []
    for _ in range(comment_count):
        if cursor + 4 > len(packet_data):
            raise InvalidMediaError("Truncated OpusTags comment length")
        comment_length = struct.unpack_from("<I", packet_data, cursor)[0]
        cursor += 4
        end = cursor + comment_length
        if end > len(packet_data):
            raise InvalidMediaError("Truncated OpusTags comment")
        equals = packet_data.find(b"=", cursor, end)
        name_end = equals if equals >= 0 else end
        ranges.append((cursor, name_end))
        cursor = end
    return ranges


def _validate_opus_head(packet: OggPacket) -> None:
    if packet.packet_index != 0 or not packet.starts_on_bos_page:
        raise InvalidMediaError(
            f"OpusHead is not the first BOS packet of stream {packet.serial}"
        )
    if len(packet.data) < 19:
        raise InvalidMediaError("OpusHead packet is shorter than 19 bytes")

    version = packet.data[8]
    if version > 15:
        raise UnsupportedFormatError(
            f"Unsupported OpusHead version {version}; only compatible versions 0-15 "
            "can be edited safely"
        )
    channels = packet.data[9]
    if channels == 0:
        raise InvalidMediaError("OpusHead declares zero output channels")
    mapping_family = packet.data[18]
    if mapping_family == 0:
        if channels not in {1, 2}:
            raise InvalidMediaError(
                "Opus channel mapping family 0 is valid only for mono or stereo"
            )
        return

    required_size = 21 + channels
    if len(packet.data) < required_size:
        raise InvalidMediaError(
            "OpusHead channel mapping table is shorter than the declared channel count"
        )
    streams = packet.data[19]
    coupled = packet.data[20]
    if streams == 0 or coupled > streams:
        raise InvalidMediaError("Invalid OpusHead stream/coupled-stream counts")
    decoded_channels = streams + coupled
    for mapping in packet.data[21 : 21 + channels]:
        if mapping != 255 and mapping >= decoded_channels:
            raise InvalidMediaError(
                "OpusHead channel mapping index exceeds the decoded channel count"
            )


def _opus_header_packets(packets: list[OggPacket]) -> list[OggPacket]:
    headers: list[OggPacket] = []
    for packet in packets:
        if not packet.data.startswith(b"OpusHead"):
            continue
        _validate_opus_head(packet)
        headers.append(packet)
    if not headers:
        raise UnsupportedFormatError("No valid OpusHead packet was found in the Ogg file")
    return headers


def _validate_opus_tags(packets: list[OggPacket], serials: set[int]) -> None:
    for serial in serials:
        candidates = [
            packet
            for packet in packets
            if packet.serial == serial and packet.packet_index == 1
        ]
        if len(candidates) != 1 or not candidates[0].data.startswith(b"OpusTags"):
            raise InvalidMediaError(
                f"Logical Opus stream {serial} has no valid OpusTags second packet"
            )
        # Parse the full comment directory now so malformed lengths cannot be
        # accepted merely because no R128 tag happens to be requested.
        _comment_name_ranges(candidates[0].data)


def patch_ogg_opus_gain(
    input_path: str | Path,
    output_path: str | Path,
    *,
    gain_q78_delta: int,
    r128_policy: R128Policy = "neutralize",
) -> OpusPatchReport:
    """Add a Q7.8 gain delta to every OpusHead in an Ogg file."""

    if r128_policy not in {"neutralize", "keep", "error"}:
        raise ValueError(f"Unknown r128_policy: {r128_policy}")
    if gain_q78_delta < -32768 or gain_q78_delta > 32767:
        raise GainRangeError("gain_q78_delta is outside signed 16-bit range")

    source = Path(input_path)
    destination = Path(output_path)
    if not source.is_file():
        raise FileNotFoundError(source)
    mutable = bytearray(source.read_bytes())
    pages = _parse_pages(mutable, verify_crc=True)
    packets = _assemble_packets(mutable, pages)
    headers = _opus_header_packets(packets)
    stream_serials_from_pages = {page.serial for page in pages}
    opus_serials = {packet.serial for packet in headers}
    if len(opus_serials) != 1 or stream_serials_from_pages != opus_serials:
        raise UnsupportedFormatError(
            "Exactly one Ogg Opus logical stream and no multiplexed logical "
            "streams are supported"
        )
    _validate_opus_tags(packets, opus_serials)

    touched_pages: set[int] = set()
    stream_serials: set[int] = set()
    old_gains: list[float] = []
    new_gains: list[float] = []

    for packet in headers:
        old_raw = struct.unpack_from("<h", packet.data, 16)[0]
        new_raw = old_raw + gain_q78_delta
        if new_raw < -32768 or new_raw > 32767:
            raise GainRangeError(
                f"OpusHead output gain would overflow for stream {packet.serial}: "
                f"{old_raw}/256 dB + {gain_q78_delta}/256 dB"
            )
        if new_raw != old_raw:
            encoded = struct.pack("<h", new_raw)
            _write_packet_byte(mutable, packet, 16, encoded[0], touched_pages, pages)
            _write_packet_byte(mutable, packet, 17, encoded[1], touched_pages, pages)
        stream_serials.add(packet.serial)
        old_gains.append(old_raw / 256.0)
        new_gains.append(new_raw / 256.0)

    found = 0
    neutralized = 0
    if gain_q78_delta != 0:
        for packet in packets:
            if (
                packet.serial not in stream_serials
                or packet.packet_index != 1
                or not packet.data.startswith(b"OpusTags")
            ):
                continue
            for name_start, name_end in _comment_name_ranges(packet.data):
                name = packet.data[name_start:name_end].upper()
                if name not in {b"R128_TRACK_GAIN", b"R128_ALBUM_GAIN"}:
                    continue
                found += 1
                if r128_policy == "error":
                    raise InvalidMediaError(
                        "R128 gain tags are present; choose "
                        "r128_policy='neutralize' or 'keep'"
                    )
                if r128_policy == "neutralize":
                    # Keep packet length and Ogg lacing exactly unchanged while
                    # turning the standardized field into an inert private tag.
                    original = packet.data[name_start]
                    replacement = ord("x") if 97 <= original <= 122 else ord("X")
                    _write_packet_byte(
                        mutable, packet, name_start, replacement, touched_pages, pages
                    )
                    neutralized += 1

    for page_index in sorted(touched_pages):
        page = pages[page_index]
        mutable[page.start + 22 : page.start + 26] = b"\x00\x00\x00\x00"
        checksum = ogg_crc(mutable[page.start : page.end])
        struct.pack_into("<I", mutable, page.start + 22, checksum)

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(mutable)
    return OpusPatchReport(
        streams_patched=len(stream_serials),
        old_output_gains_db=tuple(old_gains),
        new_output_gains_db=tuple(new_gains),
        r128_tags_found=found,
        r128_tags_neutralized=neutralized,
        pages_rechecksummed=len(touched_pages),
    )


def inspect_ogg_opus(input_path: str | Path) -> dict[str, object]:
    """Read OpusHead gain and R128-tag presence without modifying the file."""

    path = Path(input_path)
    if not path.is_file():
        raise FileNotFoundError(path)
    data = path.read_bytes()
    pages = _parse_pages(data, verify_crc=True)
    packets = _assemble_packets(data, pages)
    headers = _opus_header_packets(packets)
    opus_serials = {packet.serial for packet in headers}
    logical_serials = {page.serial for page in pages}
    if len(opus_serials) != 1 or logical_serials != opus_serials:
        raise UnsupportedFormatError(
            "Exactly one Ogg Opus logical stream and no multiplexed logical "
            "streams are supported"
        )
    _validate_opus_tags(packets, opus_serials)

    gains = [struct.unpack_from("<h", packet.data, 16)[0] / 256.0 for packet in headers]
    channel_counts = [packet.data[9] for packet in headers]
    tags: list[str] = []
    for packet in packets:
        if (
            packet.serial in opus_serials
            and packet.packet_index == 1
            and packet.data.startswith(b"OpusTags")
        ):
            for start, end in _comment_name_ranges(packet.data):
                name = packet.data[start:end].decode("ascii", errors="replace")
                if name.upper() in {"R128_TRACK_GAIN", "R128_ALBUM_GAIN"}:
                    tags.append(name)
    return {
        "streams": len(gains),
        "logical_streams": len(logical_serials),
        "output_gains_db": gains,
        "channel_counts": channel_counts,
        "r128_gain_tags": tags,
        "ogg_pages": len(pages),
    }

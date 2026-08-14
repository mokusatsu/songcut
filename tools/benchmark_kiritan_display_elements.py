"""きりたん歌唱 DB の表示素 timing をローカルで検証する benchmark。

このスクリプトは ``third_party/kiritan_singing`` の MusicXML と mono_label だけを
読み取る。音声を再生したりネットワークへ接続したりせず、MusicXML の歌詞を
``japanese.table`` で展開して、手修正済みの音素境界を表示素の正解値に変換する。
生成物の既定出力は ``out/benchmarks``（Git ignore 対象）であり、DB の WAV・歌詞・
ラベル・派生 timing をリポジトリへコピーしない。

Copyright: ©SSS. きりたん歌唱 DB の引用は Ogawa & Morise (2021) とする。
"""

from __future__ import annotations

import argparse
import bisect
import json
import math
import sys
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


DEFAULT_DATASET_ROOT = Path("third_party/kiritan_singing")
DEFAULT_OUTPUT = Path("out/benchmarks/kiritan_display_elements.json")
DEFAULT_EXCLUDED_SONGS = frozenset({"08", "29"})
COPYRIGHT_NOTICE = "©SSS"
CITATION = "Ogawa & Morise (2021)"


class BenchmarkDataError(RuntimeError):
    """ベンチマーク入力が不足している、または形式不正である場合の例外。"""


@dataclass(frozen=True)
class MonoLabel:
    """mono_label の一行を表す時刻付き音素。"""

    start: float
    end: float
    label: str

    @property
    def duration(self) -> float:
        """音素区間の正の長さを返す。"""

        return max(0.0, self.end - self.start)


@dataclass(frozen=True)
class LyricMora:
    """表示素に含まれる原文と ``japanese.table`` の発音列。"""

    index: int
    text: str
    phonemes: tuple[str, ...]
    source_start: int
    source_end: int


@dataclass(frozen=True)
class GroundTruthDisplayElement:
    """正解の表示素または文字に対応しない blank 区間。"""

    index: int
    text: str
    start: float
    end: float
    source: str
    phonemes: tuple[str, ...] = ()

    @property
    def duration(self) -> float:
        """表示素の長さを秒で返す。"""

        return max(0.0, self.end - self.start)

    @property
    def is_blank(self) -> bool:
        """文字を持たない blank 表示素かどうかを返す。"""

        return self.text == ""


@dataclass(frozen=True)
class GroundTruthLine:
    """行分割ルールで得た歌詞行と、その表示素 partition。"""

    index: int
    text: str
    start: float
    end: float
    elements: tuple[GroundTruthDisplayElement, ...]

    @property
    def internal_boundaries(self) -> tuple[float, ...]:
        """行の外側境界を除いた表示素境界列を返す。"""

        return tuple(element.end for element in self.elements[:-1])


@dataclass(frozen=True)
class KiritanSongGroundTruth:
    """一曲分の歌詞・音素・行単位正解。"""

    song_id: str
    lyrics: tuple[str, ...]
    labels: tuple[MonoLabel, ...]
    lines: tuple[GroundTruthLine, ...]

    @property
    def lyrics_text(self) -> str:
        """MusicXML document order の歌詞を連結して返す。"""

        return "".join(self.lyrics)


@dataclass(frozen=True)
class BenchmarkDataset:
    """複数曲の正解と、入力不足で除外した曲の理由。"""

    songs: tuple[KiritanSongGroundTruth, ...]
    skipped: tuple[dict[str, str], ...]
    candidates: tuple[str, ...]
    excluded: tuple[str, ...]


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def read_musicxml_lyrics(path: str | Path) -> tuple[str, ...]:
    """MusicXML の ``lyric/ text`` を document order で読み取る。

    同じ note に複数 lyric number がある場合は number=1 を優先し、存在しない
    場合だけ最初の lyric を使う。``elision`` 内の text も子孫順に連結する。
    """

    source = Path(path)
    if not source.is_file():
        raise BenchmarkDataError(f"MusicXMLがありません: {source}")
    try:
        root = ET.parse(source).getroot()
    except (ET.ParseError, OSError) as exc:
        raise BenchmarkDataError(f"MusicXMLを読めません: {source}: {exc}") from exc

    lyrics: list[str] = []
    for note in (element for element in root.iter() if _local_name(element.tag) == "note"):
        lyric_nodes = [child for child in list(note) if _local_name(child.tag) == "lyric"]
        if not lyric_nodes:
            continue
        selected = next(
            (node for node in lyric_nodes if node.attrib.get("number", "1") == "1"),
            lyric_nodes[0],
        )
        pieces: list[str] = []
        for child in selected.iter():
            if _local_name(child.tag) in {"text", "elision"} and child.text:
                pieces.append(child.text)
        text = "".join(pieces).strip()
        if text:
            lyrics.append(text)
    if not lyrics:
        raise BenchmarkDataError(f"MusicXMLに歌詞がありません: {source}")
    return tuple(lyrics)


def read_japanese_table(path: str | Path) -> dict[str, tuple[str, ...]]:
    """``japanese.table`` を kana から音素列への辞書として読み取る。"""

    source = Path(path)
    if not source.is_file():
        raise BenchmarkDataError(f"japanese.tableがありません: {source}")
    try:
        text = source.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise BenchmarkDataError(f"japanese.tableを読めません: {source}: {exc}") from exc
    table: dict[str, tuple[str, ...]] = {}
    for line_number, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        fields = stripped.split()
        if len(fields) < 2:
            raise BenchmarkDataError(f"japanese.tableの形式不正: {source}:{line_number}")
        table[fields[0]] = tuple(fields[1:])
    if not table:
        raise BenchmarkDataError(f"japanese.tableが空です: {source}")
    return table


def read_mono_label(path: str | Path) -> tuple[MonoLabel, ...]:
    """mono_label を読み、pause/br を含む時刻順の音素列として返す。"""

    source = Path(path)
    if not source.is_file():
        raise BenchmarkDataError(f"mono_labelがありません: {source}")
    labels: list[MonoLabel] = []
    try:
        lines = source.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise BenchmarkDataError(f"mono_labelを読めません: {source}: {exc}") from exc
    for line_number, line in enumerate(lines, 1):
        fields = line.split()
        if not fields:
            continue
        if len(fields) < 3:
            raise BenchmarkDataError(f"mono_labelの形式不正: {source}:{line_number}")
        try:
            start, end = float(fields[0]), float(fields[1])
        except ValueError as exc:
            raise BenchmarkDataError(f"mono_labelの時刻不正: {source}:{line_number}") from exc
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            raise BenchmarkDataError(f"mono_labelの区間不正: {source}:{line_number}")
        labels.append(MonoLabel(start, end, fields[2]))
    if not labels:
        raise BenchmarkDataError(f"mono_labelが空です: {source}")
    if any(right.start < left.start for left, right in zip(labels, labels[1:])):
        raise BenchmarkDataError(f"mono_labelが時刻順ではありません: {source}")
    return tuple(labels)


_SMALL_KANA = frozenset("ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶゕゖ")
_SOKUON = frozenset("っッ")
_NON_PRONOUNCING_CATEGORIES = ("P", "S")


def _is_combining(character: str) -> bool:
    codepoint = ord(character)
    return (
        unicodedata.category(character).startswith("M")
        or codepoint == 0x200D
        or 0xFE00 <= codepoint <= 0xFE0F
        or 0xE0100 <= codepoint <= 0xE01EF
    )


def _is_non_pronouncing(text: str) -> bool:
    if not text:
        return True
    first = text[0]
    if first in _SOKUON or first == "ー" or first in _SMALL_KANA:
        return False
    return first.isspace() or unicodedata.category(first).startswith(_NON_PRONOUNCING_CATEGORIES)


def _group_lyric_graphemes(text: str) -> tuple[tuple[str, int, int], ...]:
    """原文を表示素候補へまとめ、句読点を隣接発音単位へ付加する。"""

    raw: list[tuple[str, int, int]] = []
    for offset, character in enumerate(text):
        if _is_combining(character) and raw:
            previous, start, _ = raw[-1]
            raw[-1] = (previous + character, start, offset + 1)
            continue
        if character in _SMALL_KANA and character not in _SOKUON and raw:
            previous, start, _ = raw[-1]
            if not _is_non_pronouncing(previous) and previous[-1] not in _SOKUON:
                raw[-1] = (previous + character, start, offset + 1)
                continue
        if character == "ー" and raw:
            previous, start, _ = raw[-1]
            if previous and previous[-1] not in _SOKUON:
                raw[-1] = (previous + character, start, offset + 1)
                continue
        raw.append((character, offset, offset + 1))

    grouped: list[tuple[str, int, int]] = []
    pending: list[tuple[str, int, int]] = []
    for grapheme, start, end in raw:
        if _is_non_pronouncing(grapheme):
            if grouped:
                previous, previous_start, _ = grouped[-1]
                grouped[-1] = (previous + grapheme, previous_start, end)
            else:
                pending.append((grapheme, start, end))
            continue
        if pending:
            grapheme = "".join(item[0] for item in pending) + grapheme
            start = pending[0][1]
            pending.clear()
        grouped.append((grapheme, start, end))
    if pending:
        if grouped:
            previous, previous_start, _ = grouped[-1]
            grouped[-1] = (previous + "".join(item[0] for item in pending), previous_start, pending[-1][2])
        else:
            grouped = pending
    return tuple(grouped)


def expand_japanese_lyrics(text: str, table: Mapping[str, Sequence[str]]) -> tuple[LyricMora, ...]:
    """歌詞を表示素へ分割し、``japanese.table`` の発音列を付加する。

    長音記号は直前の表示素へ結合するが、mono_label では直前母音の持続時間として
    表現されるため追加 token を生成しない。促音は ``っ -> cl`` の独立音素になる。
    """

    grouped = _group_lyric_graphemes(text)
    keys = sorted(table, key=len, reverse=True)
    result: list[LyricMora] = []
    for index, (unit_text, source_start, source_end) in enumerate(grouped):
        phonemes: list[str] = []
        offset = 0
        while offset < len(unit_text):
            if unit_text[offset] == "ー":
                offset += 1
                continue
            key = next((candidate for candidate in keys if unit_text.startswith(candidate, offset)), None)
            if key is None:
                # 区切りを壊さず、照合時には音素無しとして明確に扱う。
                offset += 1
                continue
            phonemes.extend(str(item) for item in table[key])
            offset += len(key)
        result.append(LyricMora(index, unit_text, tuple(phonemes), source_start, source_end))
    if not result:
        raise BenchmarkDataError("歌詞を表示素へ分割できません")
    return tuple(result)


def _spoken_labels(labels: Sequence[MonoLabel]) -> tuple[MonoLabel, ...]:
    return tuple(label for label in labels if label.label not in {"pau", "br"})


def _pause_by_spoken_cursor(labels: Sequence[MonoLabel]) -> dict[int, tuple[MonoLabel, ...]]:
    cursor = 0
    pauses: dict[int, list[MonoLabel]] = {}
    for label in labels:
        if label.label in {"pau", "br"}:
            pauses.setdefault(cursor, []).append(label)
        else:
            cursor += 1
    return {key: tuple(value) for key, value in pauses.items()}


def _line_elements(
    morae: Sequence[LyricMora],
    spans: Sequence[tuple[float, float]],
    *,
    start_index: int,
    end_index: int,
    line_index: int,
) -> tuple[GroundTruthDisplayElement, ...]:
    """行内の発音単位と pause gap を連続 partition にする。"""

    first_start = spans[start_index][0]
    last_end = spans[end_index - 1][1]
    output: list[GroundTruthDisplayElement] = []
    cursor = first_start
    element_index = 0
    for mora_index in range(start_index, end_index):
        start, end = spans[mora_index]
        if start > cursor + 1e-9:
            output.append(GroundTruthDisplayElement(element_index, "", cursor, start, "pause"))
            element_index += 1
        if end <= start:
            continue
        mora = morae[mora_index]
        output.append(
            GroundTruthDisplayElement(
                element_index,
                mora.text,
                start,
                end,
                "mono_label",
                mora.phonemes,
            )
        )
        element_index += 1
        cursor = end
    if cursor < last_end - 1e-9:
        output.append(GroundTruthDisplayElement(element_index, "", cursor, last_end, "pause"))
    return tuple(output)


def split_ground_truth_lines(
    lyrics: str | Sequence[str],
    labels: Sequence[MonoLabel],
    table: Mapping[str, Sequence[str]],
    *,
    song_id: str = "song",
    min_pause_seconds: float = 0.2,
    hard_pause_seconds: float = 1.0,
    soft_split_after_seconds: float = 5.0,
    max_line_seconds: float = 12.0,
) -> tuple[GroundTruthLine, ...]:
    """音素列を指定ルールで歌詞行へ分割し、短休止を blank にする。

    ``pau >= 1s`` は即時分割、その他の ``br/pau >= .2s`` は行開始から 5 秒経過後
    の最初の候補で分割する。12 秒へ達した場合は現在の表示素の直前境界を選ぶ。
    周辺行の境界を動かす処理や beat snap は行わない。
    """

    lyric_text = "".join(lyrics) if not isinstance(lyrics, str) else lyrics
    morae = expand_japanese_lyrics(lyric_text, table)
    spoken = _spoken_labels(labels)
    expected = sum(len(mora.phonemes) for mora in morae)
    if expected != len(spoken):
        raise BenchmarkDataError(
            f"{song_id}: MusicXML音素数({expected})とmono_label音素数({len(spoken)})が一致しません"
        )

    spans: list[tuple[float, float]] = []
    cursor = 0
    for mora in morae:
        count = len(mora.phonemes)
        if count <= 0:
            # 句読点・長音だけの単位は隣接単位への付加後にも残り得る。
            if spans:
                start, end = spans[-1]
                spans[-1] = (start, end)
                continue
            raise BenchmarkDataError(f"{song_id}: 発音を持たない先頭表示素があります")
        selected = spoken[cursor : cursor + count]
        spans.append((selected[0].start, selected[-1].end))
        cursor += count
    if len(spans) != len(morae):
        raise BenchmarkDataError(f"{song_id}: 表示素とmono_labelの対応を作れません")

    pauses = _pause_by_spoken_cursor(labels)
    boundaries: list[int] = [0]
    line_start = 0
    for boundary in range(1, len(morae)):
        previous_end = spans[boundary - 1][1]
        line_elapsed = previous_end - spans[line_start][0]
        events = pauses.get(sum(len(mora.phonemes) for mora in morae[:boundary]), ())
        has_hard = any(event.label == "pau" and event.duration >= hard_pause_seconds for event in events)
        has_soft = any(
            event.label in {"pau", "br"} and event.duration >= min_pause_seconds for event in events
        )
        include_current_elapsed = spans[boundary][1] - spans[line_start][0]
        max_reached = include_current_elapsed >= max_line_seconds and boundary > line_start
        should_split = has_hard or (has_soft and line_elapsed >= soft_split_after_seconds) or max_reached
        if should_split:
            boundaries.append(boundary)
            line_start = boundary
    boundaries.append(len(morae))

    output: list[GroundTruthLine] = []
    for line_index, (start_index, end_index) in enumerate(zip(boundaries, boundaries[1:])):
        if end_index <= start_index:
            continue
        start, _ = spans[start_index]
        _, end = spans[end_index - 1]
        elements = _line_elements(
            morae,
            spans,
            start_index=start_index,
            end_index=end_index,
            line_index=line_index,
        )
        output.append(
            GroundTruthLine(
                index=line_index,
                text="".join(mora.text for mora in morae[start_index:end_index]),
                start=start,
                end=end,
                elements=elements,
            )
        )
    if not output:
        raise BenchmarkDataError(f"{song_id}: 歌詞行を生成できません")
    return tuple(output)


def discover_kiritan_song_ids(
    root: str | Path = DEFAULT_DATASET_ROOT,
    *,
    excluded: Iterable[str] = DEFAULT_EXCLUDED_SONGS,
) -> tuple[str, ...]:
    """MusicXML と mono_label が揃う、除外後の曲 ID を返す。

    正常なきりたん DB では 50 曲から 08 と 29 を除いた 48 曲になる。WAV は
    benchmark の入力に不要なので存在確認せず、音声を配布物へ含めない。
    """

    dataset_root = Path(root)
    xml_root = dataset_root / "musicxml"
    label_root = dataset_root / "mono_label"
    if not xml_root.is_dir() or not label_root.is_dir():
        raise BenchmarkDataError(f"きりたんDBのmusicxml/mono_labelがありません: {dataset_root}")
    excluded_ids = {str(item).zfill(2) for item in excluded}
    xml_ids = {path.stem for path in xml_root.glob("*.xml")}
    label_ids = {path.stem for path in label_root.glob("*.lab")}
    complete = sorted(xml_ids & label_ids, key=lambda item: (int(item) if item.isdigit() else math.inf, item))
    return tuple(song_id for song_id in complete if song_id not in excluded_ids)


def load_kiritan_song(
    root: str | Path,
    song_id: str,
    *,
    excluded: Iterable[str] = DEFAULT_EXCLUDED_SONGS,
) -> KiritanSongGroundTruth:
    """指定曲を読み、MusicXML と mono_label から正解行を構築する。"""

    normalized_id = str(song_id).zfill(2)
    excluded_ids = {str(item).zfill(2) for item in excluded}
    if normalized_id in excluded_ids:
        raise BenchmarkDataError(f"{normalized_id}: 計画上除外された曲です")
    dataset_root = Path(root)
    table = read_japanese_table(dataset_root / "japanese.table")
    lyrics = read_musicxml_lyrics(dataset_root / "musicxml" / f"{normalized_id}.xml")
    labels = read_mono_label(dataset_root / "mono_label" / f"{normalized_id}.lab")
    lines = split_ground_truth_lines(lyrics, labels, table, song_id=normalized_id)
    return KiritanSongGroundTruth(normalized_id, lyrics, labels, lines)


def build_kiritan_dataset(
    root: str | Path = DEFAULT_DATASET_ROOT,
    *,
    song_ids: Sequence[str] | None = None,
    limit: int | None = None,
    excluded: Iterable[str] = DEFAULT_EXCLUDED_SONGS,
) -> BenchmarkDataset:
    """利用可能曲を読み、欠落・不一致曲を理由付きで skip したデータセットを返す。"""

    candidates = discover_kiritan_song_ids(root, excluded=excluded)
    requested = tuple(str(item).zfill(2) for item in song_ids) if song_ids else candidates
    if limit is not None:
        requested = requested[: max(0, limit)]
    songs: list[KiritanSongGroundTruth] = []
    skipped: list[dict[str, str]] = []
    for song_id in requested:
        try:
            songs.append(load_kiritan_song(root, song_id, excluded=excluded))
        except BenchmarkDataError as exc:
            skipped.append({"song_id": song_id, "reason": str(exc)})
    if not songs:
        details = "; ".join(f"{item['song_id']}: {item['reason']}" for item in skipped)
        raise BenchmarkDataError(f"有効なきりたん曲がありません{(': ' + details) if details else ''}")
    excluded_ids = tuple(sorted({str(item).zfill(2) for item in excluded}))
    return BenchmarkDataset(tuple(songs), tuple(skipped), candidates, excluded_ids)


def _percentile(values: Sequence[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * percentile / 100.0
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def _prediction_songs(payload: Any) -> dict[str, dict[str, Any]]:
    """複数の JSON 形（songs/lines/ID map）を song_id map へ正規化する。"""

    if isinstance(payload, dict) and isinstance(payload.get("songs"), list):
        items = payload["songs"]
    elif isinstance(payload, dict) and isinstance(payload.get("lines"), list):
        items = [payload]
    elif isinstance(payload, dict):
        items = []
        for key, value in payload.items():
            if isinstance(value, dict) and isinstance(value.get("lines"), list):
                items.append({"song_id": key, **value})
    elif isinstance(payload, list):
        items = payload
    else:
        items = []
    result: dict[str, dict[str, Any]] = {}
    for position, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        song_id = str(item.get("song_id") or item.get("id") or item.get("name") or (f"{position + 1:02d}"))
        result[song_id.zfill(2) if song_id.isdigit() else song_id] = item
    return result


def read_prediction_report(path: str | Path) -> dict[str, dict[str, Any]]:
    """Songcut alignment result JSON を読み、曲 ID ごとの辞書へ正規化する。"""

    source = Path(path)
    if not source.is_file():
        raise BenchmarkDataError(f"予測JSONがありません: {source}")
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise BenchmarkDataError(f"予測JSONを読めません: {source}: {exc}") from exc
    result = _prediction_songs(payload)
    if not result:
        raise BenchmarkDataError(f"予測JSONにlines/songsがありません: {source}")
    return result


def _line_prediction_elements(line: Mapping[str, Any]) -> tuple[dict[str, Any], ...]:
    raw = line.get("display_elements", line.get("elements", ()))
    if not isinstance(raw, list):
        return ()
    return tuple(item for item in raw if isinstance(item, dict))


def _prediction_lines(song: Mapping[str, Any]) -> dict[int, Mapping[str, Any]]:
    raw = song.get("lines", ())
    if not isinstance(raw, list):
        return {}
    result: dict[int, Mapping[str, Any]] = {}
    for position, line in enumerate(raw):
        if isinstance(line, dict):
            try:
                index = int(line.get("index", position))
            except (TypeError, ValueError):
                index = position
            result[index] = line
    return result


def _numeric(item: Mapping[str, Any], key: str) -> float | None:
    try:
        value = float(item[key])
    except (KeyError, TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _line_violations(line: Mapping[str, Any], elements: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    """予測要素の順序・包含・連続 partition 違反数を数える。"""

    violations = {"ordering": 0, "containment": 0, "partition": 0}
    line_start = _numeric(line, "start")
    line_end = _numeric(line, "end")
    previous_end: float | None = None
    parsed: list[tuple[float, float]] = []
    for element in elements:
        start, end = _numeric(element, "start"), _numeric(element, "end")
        if start is None or end is None or end <= start:
            violations["ordering"] += 1
            continue
        if previous_end is not None:
            if start < previous_end - 1e-9:
                violations["ordering"] += 1
            if abs(start - previous_end) > 1e-6:
                violations["partition"] += 1
        previous_end = end
        parsed.append((start, end))
    if parsed and line_start is not None and abs(parsed[0][0] - line_start) > 1e-6:
        violations["partition"] += 1
    if parsed and line_end is not None and abs(parsed[-1][1] - line_end) > 1e-6:
        violations["partition"] += 1
    if line_start is not None and line_end is not None:
        for start, end in parsed:
            if start < line_start - 1e-6 or end > line_end + 1e-6:
                violations["containment"] += 1
    return violations


def evaluate_prediction_report(
    ground_truth: Sequence[KiritanSongGroundTruth] | KiritanSongGroundTruth,
    predictions: Mapping[str, Mapping[str, Any]] | str | Path,
) -> dict[str, Any]:
    """予測 JSON と表示素 GT の内部境界誤差・partition違反を集計する。

    境界は同じ行の時刻順partition同士で、各GT境界に最も近い予測境界を対応付ける。
    blank検出の増減で以後の全境界が一つずつずれるordinal比較は行わず、件数差は
    ``missing_boundaries`` / ``extra_boundaries`` として独立に報告する。合格条件は
    内部境界中央値100ms以下、P90 250ms以下、三種類の構造違反ゼロである。
    """

    songs = (ground_truth,) if isinstance(ground_truth, KiritanSongGroundTruth) else tuple(ground_truth)
    if isinstance(predictions, (str, Path)):
        prediction_map = read_prediction_report(predictions)
    elif isinstance(predictions, Mapping) and (
        isinstance(predictions.get("songs"), list) or isinstance(predictions.get("lines"), list)
    ):
        # ``ground_truth_payload`` や API の結果をそのまま渡せるようにする。
        prediction_map = _prediction_songs(predictions)
    else:
        prediction_map = dict(predictions)
    errors: list[float] = []
    violation_totals = {"ordering": 0, "containment": 0, "partition": 0}
    song_reports: list[dict[str, Any]] = []
    missing_lines = 0
    missing_boundaries = 0
    extra_boundaries = 0
    matched_boundary_count = 0
    boundary_count = 0
    line_count = 0
    for song in songs:
        predicted_song = prediction_map.get(song.song_id) or prediction_map.get(song.song_id.zfill(2))
        predicted_lines = _prediction_lines(predicted_song or {})
        song_errors: list[float] = []
        song_violations = {key: 0 for key in violation_totals}
        for gt_line in song.lines:
            line_count += 1
            predicted_line = predicted_lines.get(gt_line.index)
            if predicted_line is None:
                missing_lines += 1
                continue
            predicted_elements = _line_prediction_elements(predicted_line)
            line_violation = _line_violations(predicted_line, predicted_elements)
            for key, value in line_violation.items():
                violation_totals[key] += value
                song_violations[key] += value
            gt_boundaries = list(gt_line.internal_boundaries)
            pred_boundaries: list[float] = []
            for element in predicted_elements[:-1]:
                end = _numeric(element, "end")
                if end is not None:
                    pred_boundaries.append(end)
            boundary_count += len(gt_boundaries)
            missing_boundaries += max(0, len(gt_boundaries) - len(pred_boundaries))
            extra_boundaries += max(0, len(pred_boundaries) - len(gt_boundaries))
            for gt_boundary in gt_boundaries:
                insertion = bisect.bisect_left(pred_boundaries, gt_boundary)
                candidates = []
                if insertion < len(pred_boundaries):
                    candidates.append(pred_boundaries[insertion])
                if insertion > 0:
                    candidates.append(pred_boundaries[insertion - 1])
                if not candidates:
                    continue
                error = min(abs(candidate - gt_boundary) for candidate in candidates)
                errors.append(error)
                song_errors.append(error)
                matched_boundary_count += 1
        song_reports.append(
            {
                "song_id": song.song_id,
                "lines": len(song.lines),
                "boundaries": len(song.internal_boundaries) if hasattr(song, "internal_boundaries") else sum(len(line.internal_boundaries) for line in song.lines),
                "median_seconds": _percentile(song_errors, 50),
                "p90_seconds": _percentile(song_errors, 90),
                "violations": song_violations,
            }
        )
    median = _percentile(errors, 50)
    p90 = _percentile(errors, 90)
    passed = (
        median is not None
        and p90 is not None
        and median <= 0.100
        and p90 <= 0.250
        and not any(violation_totals.values())
        and missing_lines == 0
        and matched_boundary_count == boundary_count
    )
    return {
        "copyright": COPYRIGHT_NOTICE,
        "citation": CITATION,
        "line_count": line_count,
        "boundary_count": boundary_count,
        "median_seconds": median,
        "p90_seconds": p90,
        "violations": violation_totals,
        "missing_lines": missing_lines,
        "matched_boundary_count": matched_boundary_count,
        "missing_boundaries": missing_boundaries,
        "extra_boundaries": extra_boundaries,
        "passed": passed,
        "songs": song_reports,
    }


def ground_truth_payload(dataset: BenchmarkDataset) -> dict[str, Any]:
    """検証可能な最小 GT JSON を作る（WAV・原資料本文は含めない）。"""

    return {
        "copyright": COPYRIGHT_NOTICE,
        "citation": CITATION,
        "dataset": "third_party/kiritan_singing (local-only)",
        "candidate_song_count": len(dataset.candidates),
        "excluded_song_ids": list(dataset.excluded),
        "skipped": list(dataset.skipped),
        "songs": [
            {
                "song_id": song.song_id,
                "lines": [
                    {
                        "index": line.index,
                        "text": line.text,
                        "start": line.start,
                        "end": line.end,
                        "display_elements": [asdict(element) for element in line.elements],
                    }
                    for line in song.lines
                ],
            }
            for song in dataset.songs
        ],
    }


def make_benchmark_summary(
    dataset: BenchmarkDataset,
    *,
    prediction: Mapping[str, Mapping[str, Any]] | str | Path | None = None,
    minimum_songs: int = 8,
    minimum_lines: int = 24,
    minimum_boundaries: int = 200,
) -> dict[str, Any]:
    """GT件数と、予測があれば合格判定を含む summary を作る。"""

    line_count = sum(len(song.lines) for song in dataset.songs)
    boundary_count = sum(sum(len(line.internal_boundaries) for line in song.lines) for song in dataset.songs)
    summary: dict[str, Any] = {
        "copyright": COPYRIGHT_NOTICE,
        "citation": CITATION,
        "songs": len(dataset.songs),
        "lines": line_count,
        "internal_boundaries": boundary_count,
        "candidate_song_count": len(dataset.candidates),
        "excluded_song_ids": list(dataset.excluded),
        "skipped": list(dataset.skipped),
        "minimums": {
            "songs": minimum_songs,
            "lines": minimum_lines,
            "internal_boundaries": minimum_boundaries,
        },
        "fixture_coverage_passed": len(dataset.songs) >= minimum_songs and line_count >= minimum_lines and boundary_count >= minimum_boundaries,
    }
    if prediction is not None:
        summary["metrics"] = evaluate_prediction_report(tuple(dataset.songs), prediction)
    return summary


def _load_mms_runtime(device: str):
    """既存 MMS runner と vocabulary を一度だけ読み込む（unit では差し替え可能）。"""

    from songcut.mms_alignment import (
        MMS_INPUTS_TO_LOGITS_RATIO,
        MMS_SAMPLE_RATE,
        MmsOnnxRunner,
        load_mms_vocabulary,
        mms_onnx_model_path,
        resolve_mms_onnx_model_dir,
    )

    resolved = resolve_mms_onnx_model_dir()
    if resolved is None:
        raise BenchmarkDataError("MMS forced-alignment modelが未導入です")
    model_dir, _source = resolved
    vocabulary = load_mms_vocabulary(model_dir)
    runner = MmsOnnxRunner(mms_onnx_model_path(model_dir), device=device)
    frame_seconds = MMS_INPUTS_TO_LOGITS_RATIO / MMS_SAMPLE_RATE
    blank_id = int(vocabulary.get("<blank>", 0))
    return runner, vocabulary, frame_seconds, blank_id


def _decode_mms_window(source: Path, *, start: float, end: float, ffmpeg: Path, temporary_root: Path):
    """指定時刻だけを既存 ffmpeg helper で16kHz monoへ変換する。"""

    from songcut.transcription import extract_segment_wav, read_wav_mono_16k

    target = temporary_root / f"window-{start:.3f}-{end:.3f}.wav"
    extract_segment_wav(ffmpeg, source, target, start=start, end=end)
    return read_wav_mono_16k(target)


def generate_mms_prediction_report(
    dataset: BenchmarkDataset,
    root: str | Path,
    *,
    device: str = "auto",
    song_limit: int = 8,
    lines_per_song: int = 3,
    runner_factory=None,
    decode_window=None,
) -> dict[str, Any]:
    """きりたん GT 行を固定して、既存 MMS の局所表示素予測 JSON を生成する。

    runner と vocabulary は一度だけロードし、各行について ``start-1.5..end+1.5``
    の WAV 窓を decode して推論する。次の GT 行を同じ CTC target に加え、行間は
    ``STAR`` で区切る。結果はこの関数の戻り値だけで、音声や一時 WAV は保存しない。
    ``runner_factory``/``decode_window`` は実音声を使わない合成 unit 用の注入点である。
    """

    normalized_device = str(device).strip().lower() or "auto"
    if normalized_device not in {"auto", "cpu", "gpu"}:
        raise BenchmarkDataError("deviceは auto, cpu, gpu のいずれかです")
    if runner_factory is None:
        runner_factory = _load_mms_runtime
    runner, vocabulary, frame_seconds, blank_id = runner_factory(normalized_device)

    from songcut.ffmpeg_tools import find_ffmpeg
    from songcut.lyrics_elements import (
        align_display_elements,
        attach_token_ranges,
        map_pronunciation_to_tokens,
        split_display_elements,
    )
    from songcut.mms_alignment import align_prepared_lines, detect_silence_intervals, prepare_lyrics_lines

    ffmpeg_paths = None if decode_window is not None else find_ffmpeg()
    dataset_root = Path(root)
    predictions: list[dict[str, Any]] = []
    selected_songs = tuple(dataset.songs[: max(0, song_limit)])
    if not selected_songs:
        raise BenchmarkDataError("prediction対象曲がありません")
    with tempfile.TemporaryDirectory(prefix="songcut-kiritan-benchmark-") as temporary_directory:
        temporary_root = Path(temporary_directory)
        for song in selected_songs:
            source = dataset_root / "wav" / f"{song.song_id}.wav"
            if decode_window is None and not source.is_file():
                raise BenchmarkDataError(f"{song.song_id}: WAVがありません: {source}")
            selected_lines = tuple(song.lines[: max(0, lines_per_song)])
            predicted_lines: list[dict[str, Any]] = []
            for line_position, line in enumerate(selected_lines):
                next_line = next(
                    (candidate for candidate in song.lines if candidate.index > line.index),
                    None,
                )
                window_start = max(0.0, line.start - 1.5)
                window_end = min(
                    song.labels[-1].end,
                    max(
                        line.end + 1.5,
                        next_line.start + 0.75 if next_line is not None else line.end + 1.5,
                    ),
                )
                if window_end <= window_start:
                    raise BenchmarkDataError(f"{song.song_id} line {line.index}: 不正なWAV窓")
                if decode_window is None:
                    audio = _decode_mms_window(
                        source,
                        start=window_start,
                        end=window_end,
                        ffmpeg=ffmpeg_paths.ffmpeg,
                        temporary_root=temporary_root,
                    )
                else:
                    audio = decode_window(source, window_start, window_end)
                emissions = runner.emissions(audio)
                target_lines = [line.text]
                if next_line is not None:
                    target_lines.append(next_line.text)
                prepared = prepare_lyrics_lines(
                    target_lines,
                    language="jpn",
                    vocabulary=vocabulary,
                )
                if len(prepared) > 1:
                    prepared[1] = replace(
                        prepared[1],
                        token_ids=prepared[1].token_ids[:3],
                        token_texts=prepared[1].token_texts[:3],
                    )
                # prepare_lyrics_lines は1始まりの local index を返すため、targetは1。
                ctc = align_prepared_lines(
                    emissions,
                    prepared,
                    blank_id=blank_id,
                    frame_seconds=frame_seconds,
                    time_offset=window_start,
                    star_between_lines=True,
                )
                token_spans = tuple(token for token in ctc.tokens if token.line_index == 1)
                next_anchor_candidate = None
                if next_line is not None:
                    next_span = next((span for span in ctc.lines if span.index == 2), None)
                    next_anchor_candidate = next_span.start if next_span is not None else None
                seeds = split_display_elements(line.text, line_id=f"{song.song_id}:{line.index}", language="jpn")
                mappings = map_pronunciation_to_tokens(seeds, vocabulary)
                seeds = attach_token_ranges(seeds, mappings)
                detail = align_display_elements(
                    seeds,
                    token_spans,
                    line_start=line.start,
                    line_end=line.end,
                    mappings=mappings,
                    line_id=f"{song.song_id}:{line.index}",
                    window_start=window_start,
                    window_end=window_end,
                    next_anchor=next_line.start if next_line is not None else None,
                    next_anchor_candidate=next_anchor_candidate,
                    observed_star_ratio=ctc.star_ratio,
                    blank_intervals=detect_silence_intervals(audio, time_offset=window_start),
                )
                predicted_lines.append(
                    {
                        "index": line.index,
                        "text": line.text,
                        "start": line.start,
                        "end": line.end,
                        "display_elements": [asdict(element) for element in detail.elements],
                        "alignment_diagnostics": asdict(detail.diagnostics),
                        "source": "mms-local-ctc",
                        "window_start": window_start,
                        "window_end": window_end,
                    }
                )
            predictions.append({"song_id": song.song_id, "lines": predicted_lines})
    return {
        "copyright": COPYRIGHT_NOTICE,
        "citation": CITATION,
        "algorithm": "Standard Align MMS local CTC",
        "device_requested": normalized_device,
        "device_used": getattr(runner, "device_used", None),
        "song_count": len(predictions),
        "lines_per_song": max(0, lines_per_song),
        "songs": predictions,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="きりたん歌唱DBの表示素 timing benchmark（ローカル専用）")
    parser.add_argument("--root", type=Path, default=DEFAULT_DATASET_ROOT, help="きりたんDBのルート")
    parser.add_argument("--prediction", type=Path, help="Songcut alignment result JSON")
    parser.add_argument(
        "--generate-prediction",
        action="store_true",
        help="既存MMSで先頭8曲・各先頭3行の局所予測を生成する",
    )
    parser.add_argument("--device", choices=("auto", "cpu", "gpu"), default="auto")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="out/benchmarks配下の出力JSON")
    parser.add_argument("--songs", nargs="*", help="対象曲ID（省略時は除外後の全曲）")
    parser.add_argument("--limit", type=int, help="対象曲数の上限")
    parser.add_argument("--summary-only", action="store_true", help="GT詳細を省略してsummaryだけ出力")
    parser.add_argument("--min-songs", type=int, default=8)
    parser.add_argument("--min-lines", type=int, default=24)
    parser.add_argument("--min-boundaries", type=int, default=200)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """CLIを実行し、GTまたは予測付きbenchmark reportを書き出す。"""

    args = _build_parser().parse_args(argv)
    try:
        dataset_limit = args.limit
        if args.generate_prediction and not args.songs and dataset_limit is None:
            dataset_limit = 8
        dataset = build_kiritan_dataset(args.root, song_ids=args.songs, limit=dataset_limit)
        generated_prediction = None
        if args.generate_prediction:
            generated_prediction = generate_mms_prediction_report(
                dataset,
                args.root,
                device=args.device,
                song_limit=8,
                lines_per_song=3,
            )
        prediction = read_prediction_report(args.prediction) if args.prediction else generated_prediction
        evaluation_dataset = dataset
        if generated_prediction is not None:
            # 予測生成の既定対象は各曲先頭3行なので、精度gateも同じ24行集合に限定する。
            evaluation_dataset = replace(
                dataset,
                songs=tuple(replace(song, lines=song.lines[:3]) for song in dataset.songs[:8]),
            )
        summary = make_benchmark_summary(
            evaluation_dataset,
            prediction=prediction,
            minimum_songs=args.min_songs,
            minimum_lines=args.min_lines,
            minimum_boundaries=args.min_boundaries,
        )
        payload: dict[str, Any] = summary
        if not args.summary_only:
            payload = (
                {**generated_prediction, "summary": summary}
                if generated_prediction is not None
                else {**ground_truth_payload(dataset), "summary": summary}
            )
            if prediction is not None:
                payload["metrics"] = summary["metrics"]
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except BenchmarkDataError as exc:
        print(f"benchmark入力エラー: {exc}", file=sys.stderr)
        return 2
    # Windows の既定 cp932 でも ©SSS や日本語を含む結果を表示できるよう、
    # 標準出力では ASCII escape を使う（ファイル側は UTF-8 の原文を保持する）。
    print(json.dumps(summary, ensure_ascii=True, indent=2))
    return 0 if summary["fixture_coverage_passed"] and (prediction is None or summary["metrics"]["passed"]) else 1


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())

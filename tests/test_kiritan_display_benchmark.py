from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from tools.benchmark_kiritan_display_elements import (
    BenchmarkDataError,
    GroundTruthDisplayElement,
    GroundTruthLine,
    KiritanSongGroundTruth,
    MonoLabel,
    build_kiritan_dataset,
    discover_kiritan_song_ids,
    evaluate_prediction_report,
    expand_japanese_lyrics,
    ground_truth_payload,
    main,
    read_japanese_table,
    read_mono_label,
    read_musicxml_lyrics,
    split_ground_truth_lines,
    generate_mms_prediction_report,
)


def _write_fixture_song(root: Path, song_id: str, lyric_text: str = "あいう") -> None:
    (root / "musicxml").mkdir(parents=True, exist_ok=True)
    (root / "mono_label").mkdir(parents=True, exist_ok=True)
    notes = "".join(
        f"<note><lyric number='1'><text>{character}</text></lyric></note>"
        for character in lyric_text
    )
    (root / "musicxml" / f"{song_id}.xml").write_text(
        f"<score-partwise><part><measure>{notes}</measure></part></score-partwise>",
        encoding="utf-8",
    )
    starts = [index * 1.0 for index in range(len(lyric_text))]
    labels = "\n".join(f"{start:.1f} {start + 1:.1f} {phoneme}" for start, phoneme in zip(starts, "aiu"))
    (root / "mono_label" / f"{song_id}.lab").write_text(labels + "\n", encoding="utf-8")


def test_musicxml_and_table_are_read_in_document_order(tmp_path: Path) -> None:
    root = tmp_path / "db"
    root.mkdir()
    xml = root / "lyrics.xml"
    xml.write_text(
        "<score-partwise><part><note>"
        "<lyric number='2'><text>二</text></lyric>"
        "<lyric number='1'><text>一</text></lyric>"
        "</note><note><lyric><text>、</text></lyric></note></part></score-partwise>",
        encoding="utf-8",
    )
    table = root / "japanese.table"
    table.write_text("あ a\nい i\nっ cl\n", encoding="utf-8")

    assert read_musicxml_lyrics(xml) == ("一", "、")
    assert read_japanese_table(table)["っ"] == ("cl",)


def test_expand_joins_small_kana_sokuon_and_long_mark_without_extra_token() -> None:
    table = {"きゃ": ("ky", "a"), "っ": ("cl",), "ぷ": ("p", "u")}

    morae = expand_japanese_lyrics("きゃっぷー、", table)

    assert [mora.text for mora in morae] == ["きゃ", "っ", "ぷー、"]
    assert [mora.phonemes for mora in morae] == [("ky", "a"), ("cl",), ("p", "u")]


def test_short_pause_becomes_blank_and_hard_pause_splits() -> None:
    table = {"あ": ("a",), "い": ("i",), "う": ("u",)}
    labels = (
        MonoLabel(0.0, 1.0, "a"),
        MonoLabel(1.0, 1.5, "pau"),
        MonoLabel(1.5, 2.5, "i"),
        MonoLabel(2.5, 3.5, "pau"),
        MonoLabel(3.5, 4.5, "u"),
    )

    lines = split_ground_truth_lines("あいう", labels, table, song_id="fixture")

    assert len(lines) == 2
    assert any(element.is_blank and element.duration == pytest.approx(0.5) for element in lines[0].elements)
    assert lines[0].text == "あい"
    assert lines[1].text == "う"


def test_soft_pause_waits_five_seconds_and_twelve_second_cap_uses_boundary() -> None:
    table = {character: ("a",) for character in "あいうえおかきくけこさしすせそ"}
    labels: list[MonoLabel] = []
    cursor = 0.0
    for character in "あいうえおかきくけこさしすせそ":
        labels.append(MonoLabel(cursor, cursor + 1.0, "a"))
        cursor += 1.0
        if character == "か":
            labels.append(MonoLabel(cursor, cursor + 0.3, "br"))
            cursor += 0.3
    lines = split_ground_truth_lines("あいうえおかきくけこさしすせそ", labels, table, song_id="fixture")

    # 0..6 秒後の br は soft split、12 秒の表示素境界でも次行へ分割される。
    assert len(lines) == 2
    assert lines[0].text.endswith("か")
    assert all((line.end - line.start) <= 12.0 + 1e-9 for line in lines)

    long_text = "あいうえおかきくけこさしすせそ"
    long_labels = [MonoLabel(float(index), float(index + 1), "a") for index in range(len(long_text))]
    capped = split_ground_truth_lines(long_text, long_labels, table, song_id="cap")
    assert len(capped) == 2
    assert len(capped[0].text) == 11
    assert capped[0].end - capped[0].start == pytest.approx(11.0)


def test_discovery_excludes_08_and_29_and_builds_ground_truth(tmp_path: Path) -> None:
    root = tmp_path / "db"
    root.mkdir()
    (root / "japanese.table").write_text("あ a\nい i\nう u\n", encoding="utf-8")
    _write_fixture_song(root, "01")
    _write_fixture_song(root, "08")
    _write_fixture_song(root, "29")

    assert discover_kiritan_song_ids(root) == ("01",)
    dataset = build_kiritan_dataset(root)
    assert [song.song_id for song in dataset.songs] == ["01"]
    assert dataset.excluded == ("08", "29")
    assert ground_truth_payload(dataset)["copyright"] == "©SSS"


def test_missing_label_is_reported_as_skip(tmp_path: Path) -> None:
    root = tmp_path / "db"
    root.mkdir()
    (root / "japanese.table").write_text("あ a\n", encoding="utf-8")
    (root / "musicxml").mkdir(parents=True)
    (root / "mono_label").mkdir(parents=True)
    (root / "musicxml" / "01.xml").write_text(
        "<score-partwise><part><note><lyric><text>あ</text></lyric></note></part></score-partwise>",
        encoding="utf-8",
    )
    # discovery は完全一致曲を返さないため、明確な入力エラーになる。
    with pytest.raises(BenchmarkDataError, match="有効なきりたん曲がありません"):
        build_kiritan_dataset(root, song_ids=["01"])


def test_metrics_report_exact_partition_and_violation() -> None:
    elements = (
        GroundTruthDisplayElement(0, "あ", 0.0, 1.0, "mono_label"),
        GroundTruthDisplayElement(1, "い", 1.0, 2.0, "mono_label"),
    )
    line = GroundTruthLine(0, "あい", 0.0, 2.0, elements)
    song = KiritanSongGroundTruth("01", ("あい",), (), (line,))
    exact = {"01": {"lines": [{"index": 0, "start": 0.0, "end": 2.0, "display_elements": [
        {"text": "あ", "start": 0.0, "end": 1.0},
        {"text": "い", "start": 1.0, "end": 2.0},
    ]}]}}
    result = evaluate_prediction_report(song, exact)
    assert result["passed"] is True
    assert result["median_seconds"] == pytest.approx(0.0)

    broken = {"01": {"lines": [{"index": 0, "start": 0.0, "end": 2.0, "display_elements": [
        {"text": "あ", "start": 0.0, "end": 1.1},
        {"text": "い", "start": 1.2, "end": 2.0},
    ]}]}}
    broken_result = evaluate_prediction_report(song, broken)
    assert broken_result["passed"] is False
    assert broken_result["violations"]["partition"] == 1


def test_metrics_match_boundaries_by_time_and_report_count_differences() -> None:
    elements = (
        GroundTruthDisplayElement(0, "あ", 0.0, 1.0, "mono_label"),
        GroundTruthDisplayElement(1, "い", 1.0, 2.0, "mono_label"),
        GroundTruthDisplayElement(2, "う", 2.0, 3.0, "mono_label"),
    )
    line = GroundTruthLine(0, "あいう", 0.0, 3.0, elements)
    song = KiritanSongGroundTruth("01", ("あいう",), (), (line,))
    with_extra_blank = {
        "01": {
            "lines": [
                {
                    "index": 0,
                    "start": 0.0,
                    "end": 3.0,
                    "display_elements": [
                        {"text": "", "start": 0.0, "end": 0.5},
                        {"text": "あ", "start": 0.5, "end": 1.0},
                        {"text": "い", "start": 1.0, "end": 2.0},
                        {"text": "う", "start": 2.0, "end": 3.0},
                    ],
                }
            ]
        }
    }

    result = evaluate_prediction_report(song, with_extra_blank)

    assert result["passed"] is True
    assert result["median_seconds"] == pytest.approx(0.0)
    assert result["p90_seconds"] == pytest.approx(0.0)
    assert result["matched_boundary_count"] == 2
    assert result["missing_boundaries"] == 0
    assert result["extra_boundaries"] == 1


def test_cli_writes_attribution_and_summary(tmp_path: Path) -> None:
    root = tmp_path / "db"
    root.mkdir()
    (root / "japanese.table").write_text("あ a\nい i\nう u\n", encoding="utf-8")
    _write_fixture_song(root, "01")
    output = tmp_path / "out" / "report.json"

    assert main([
        "--root", str(root),
        "--output", str(output),
        "--summary-only",
        "--min-songs", "1",
        "--min-lines", "1",
        "--min-boundaries", "1",
    ]) == 0
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["copyright"] == "©SSS"
    assert payload["citation"] == "Ogawa & Morise (2021)"
    assert payload["fixture_coverage_passed"] is True


def test_read_mono_label_rejects_invalid_interval(tmp_path: Path) -> None:
    source = tmp_path / "bad.lab"
    source.write_text("1.0 0.0 a\n", encoding="utf-8")
    with pytest.raises(BenchmarkDataError, match="区間不正"):
        read_mono_label(source)


def test_generate_prediction_reuses_runner_once_and_uses_local_window(tmp_path: Path) -> None:
    root = tmp_path / "db"
    root.mkdir()
    (root / "wav").mkdir()
    table = {"あ": ("a",), "い": ("i",), "う": ("u",)}
    labels = (
        MonoLabel(0.0, 1.0, "a"),
        MonoLabel(1.0, 2.0, "i"),
        MonoLabel(2.0, 3.0, "u"),
    )
    lines = (
        GroundTruthLine(
            0,
            "あ",
            0.5,
            1.5,
            (GroundTruthDisplayElement(0, "あ", 0.5, 1.5, "gt"),),
        ),
        GroundTruthLine(
            1,
            "い",
            1.5,
            2.5,
            (GroundTruthDisplayElement(0, "い", 1.5, 2.5, "gt"),),
        ),
    )
    song = KiritanSongGroundTruth("01", ("あ", "い"), labels, lines)
    dataset = type("Dataset", (), {"songs": (song,)})()
    calls: list[tuple[float, float]] = []
    runtime_calls: list[str] = []

    class FakeRunner:
        def emissions(self, audio: np.ndarray) -> np.ndarray:
            # fake local audio is accepted; each token has a deterministic high logit.
            values = np.full((180, 4), -8.0, dtype=np.float32)
            for index, token_id in enumerate((1, 2, 3)):
                values[60 + index * 20 : 75 + index * 20, token_id] = 8.0
            return values

    def fake_runtime(device: str):
        runtime_calls.append(device)
        return FakeRunner(), {"<blank>": 0, "a": 1, "i": 2, "u": 3}, 0.02, 0

    def fake_decode(source: Path, start: float, end: float):
        calls.append((start, end))
        return np.zeros(160, dtype=np.float32)

    report = generate_mms_prediction_report(
        dataset,  # type: ignore[arg-type]
        root,
        device="cpu",
        song_limit=1,
        lines_per_song=2,
        runner_factory=fake_runtime,
        decode_window=fake_decode,
    )

    assert runtime_calls == ["cpu"]
    assert calls == [(0.0, 3.0), (0.0, 3.0)]
    assert report["song_count"] == 1
    assert [line["index"] for line in report["songs"][0]["lines"]] == [0, 1]
    assert all(line["display_elements"] for line in report["songs"][0]["lines"])

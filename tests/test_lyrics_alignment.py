from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
import pytest

from songcut.lyrics_alignment import (
    LyricsDocument,
    align_lyrics_to_chunks,
    find_whisper_active_intervals,
    format_srt_timestamp,
    normalize_alignment_text,
    parse_lyrics,
    render_srt,
    transcribe_whisper_chunks,
)
from songcut.rhythm_alignment import (
    adjust_lines_to_rhythm,
    build_extended_rhythm_grid,
    build_rhythm_grid,
    confidence_statistics,
    generate_lyrics_srt_variants,
    render_srt_style,
)
from songcut.transcription import TranscriptChunk


def test_parse_lyrics_recognizes_a_leading_title_block() -> None:
    document = parse_lyrics("星の消えた夜に\n\n多分 君は\n夜が更ける\n")

    assert document.title == "星の消えた夜に"
    assert document.lines == ["多分 君は", "夜が更ける"]


def test_normalize_alignment_text_is_whitespace_and_katakana_insensitive() -> None:
    assert normalize_alignment_text(" ホシ・ノ 夜!? ") == "ほしの夜"


def test_whisper_audio_is_split_only_at_sustained_minus_40_db_silence() -> None:
    sample_rate = 16_000
    tone = np.full(sample_rate, 0.02, dtype=np.float32)  # about -34 dBFS
    short_dip = np.zeros(int(sample_rate * 0.1), dtype=np.float32)
    long_silence = np.zeros(int(sample_rate * 0.5), dtype=np.float32)
    audio = np.concatenate(
        (
            np.zeros(sample_rate, dtype=np.float32),
            tone,
            short_dip,
            tone,
            long_silence,
            tone,
            np.zeros(sample_rate, dtype=np.float32),
        )
    )

    intervals = find_whisper_active_intervals(audio)

    assert len(intervals) == 2
    assert intervals[0][0] / sample_rate == pytest.approx(1.0, abs=0.02)
    assert intervals[0][1] / sample_rate == pytest.approx(3.1, abs=0.02)
    assert intervals[1][0] / sample_rate == pytest.approx(3.6, abs=0.02)
    assert intervals[1][1] / sample_rate == pytest.approx(4.6, abs=0.02)


def test_split_whisper_results_restore_source_timestamps(tmp_path: Path) -> None:
    sample_rate = 16_000
    audio = np.concatenate(
        (
            np.zeros(sample_rate, dtype=np.float32),
            np.full(sample_rate, 0.02, dtype=np.float32),
            np.zeros(sample_rate, dtype=np.float32),
            np.full(sample_rate, 0.02, dtype=np.float32),
        )
    )
    generated_audio: list[np.ndarray] = []

    class FakePipeline:
        def __init__(self, _model: str, _device: str) -> None:
            pass

        def generate(self, interval_audio: np.ndarray, **_options: object):
            generated_audio.append(interval_audio)
            index = len(generated_audio)
            return SimpleNamespace(
                chunks=[SimpleNamespace(start_ts=0.1, end_ts=0.8, text=f"line-{index}")],
                texts=[f"text-{index}"],
            )

    fake_openvino_genai = SimpleNamespace(WhisperPipeline=FakePipeline)
    with (
        mock.patch.dict(sys.modules, {"openvino_genai": fake_openvino_genai}),
        mock.patch("songcut.lyrics_alignment.find_ffmpeg", return_value=SimpleNamespace(ffmpeg="ffmpeg", ffprobe="ffprobe")),
        mock.patch("songcut.lyrics_alignment.probe_duration", return_value=4.0),
        mock.patch("songcut.lyrics_alignment.select_whisper_runtime", return_value=SimpleNamespace(device_used="CPU")),
        mock.patch("songcut.lyrics_alignment.ensure_whisper_model", return_value=tmp_path / "model"),
        mock.patch("songcut.lyrics_alignment.extract_segment_wav"),
        mock.patch("songcut.lyrics_alignment.read_wav_mono_16k", return_value=audio),
    ):
        chunks, text, duration, device = transcribe_whisper_chunks(Path("vocals.wav"))

    assert len(generated_audio) == 2
    assert all(len(part) == sample_rate for part in generated_audio)
    assert [(chunk.start, chunk.end) for chunk in chunks] == [(1.1, 1.8), (3.1, 3.8)]
    assert text == "text-1 text-2"
    assert duration == 4.0
    assert device == "CPU"


def test_known_lyrics_are_aligned_monotonically_to_whisper_chunks() -> None:
    document = LyricsDocument(title=None, lines=["多分 君は少し強がりで", "いつも笑顔作ってばかり", "すぐに泣けばいい"])
    chunks = [
        TranscriptChunk(10.0, 14.0, "多分君は少し強がりで"),
        TranscriptChunk(14.0, 18.0, "いつも笑顔作ってばかり"),
        TranscriptChunk(18.0, 21.0, "すぐに泣けばいい"),
    ]

    result = align_lyrics_to_chunks(document, chunks, media_duration=30.0)

    assert len(result.lines) == 3
    assert result.lines[0].start == pytest.approx(10.0)
    assert result.lines[-1].end <= 21.25
    assert all(left.start < right.start for left, right in zip(result.lines, result.lines[1:]))
    assert all(line.end > line.start for line in result.lines)
    assert all(line.confidence >= 0.9 for line in result.lines)


def test_missing_line_is_interpolated_between_whisper_anchors() -> None:
    document = LyricsDocument(title=None, lines=["最初の歌詞", "認識されない歌詞", "最後の歌詞"])
    chunks = [TranscriptChunk(2.0, 4.0, "最初の歌詞"), TranscriptChunk(8.0, 10.0, "最後の歌詞")]

    result = align_lyrics_to_chunks(document, chunks, media_duration=12.0)

    middle = result.lines[1]
    assert middle.source == "interpolated"
    assert result.lines[0].end <= middle.start
    assert middle.end <= result.lines[2].start
    assert middle.end > middle.start


def test_srt_rendering_uses_original_lyrics_and_millisecond_timestamps() -> None:
    document = LyricsDocument(title=None, lines=["多分 君は", "夜が更ける"])
    chunks = [TranscriptChunk(1.25, 2.5, "多分君は"), TranscriptChunk(3.0, 4.75, "夜が更ける")]
    result = align_lyrics_to_chunks(document, chunks, media_duration=5.0)

    srt = render_srt(result.lines)

    assert "00:00:01,250 -->" in srt
    assert "多分 君は" in srt
    assert format_srt_timestamp(3661.2346) == "01:01:01,235"


def test_implausibly_long_whisper_chunk_is_capped_and_marked_low_confidence() -> None:
    document = LyricsDocument(title=None, lines=["短い歌詞", "次の歌詞"])
    chunks = [TranscriptChunk(10.0, 40.0, "短い歌詞"), TranscriptChunk(45.0, 49.0, "次の歌詞")]

    result = align_lyrics_to_chunks(document, chunks, media_duration=60.0)

    assert result.lines[0].end - result.lines[0].start <= 6.25
    assert result.lines[0].confidence < 0.5
    assert result.lines[1].confidence == 1.0


def test_rhythm_grid_contains_beats_half_beats_and_quarter_beats() -> None:
    grid = build_rhythm_grid([10.0, 11.0])

    assert [(point.time, point.grid) for point in grid] == [
        (10.0, "beat"),
        (10.25, "quarter-beat"),
        (10.5, "half-beat"),
        (10.75, "quarter-beat"),
        (11.0, "beat"),
    ]


def test_rhythm_grid_is_extrapolated_to_media_edges() -> None:
    grid = build_extended_rhythm_grid([1.0, 2.0, 3.0], media_duration=4.0)

    times = [point.time for point in grid]
    assert times[0] == 0.0
    assert times[-1] == 4.0
    assert 0.25 in times
    assert 3.75 in times


def test_confidence_statistics_marks_only_low_tukey_outliers() -> None:
    document = LyricsDocument(title=None, lines=["一", "二", "三", "四", "五"])
    lines = align_lyrics_to_chunks(
        document,
        [
            TranscriptChunk(1.0, 1.5, "一"),
            TranscriptChunk(2.0, 2.5, "二"),
            TranscriptChunk(3.0, 3.5, "三"),
            TranscriptChunk(4.0, 4.5, "四"),
            TranscriptChunk(5.0, 5.5, "五"),
        ],
        media_duration=6.0,
    ).lines
    adjusted = [
        line if index else type(line)(**{**line.__dict__, "confidence": 0.1})
        for index, line in enumerate(lines)
    ]

    stats = confidence_statistics(adjusted)

    assert stats.count == 5
    assert stats.median == 1.0
    assert stats.low_outlier_indexes == [1]


def test_srt_style_places_original_below_and_adjusted_above() -> None:
    original_style = render_srt_style(alignment=2)
    adjusted_style = render_srt_style(alignment=8)

    assert "PlayResX: 1920" in adjusted_style
    assert "PlayResY: 1080" in adjusted_style
    assert next(line for line in original_style.splitlines() if line.startswith("Style:")).split(",")[18] == "2"
    assert next(line for line in adjusted_style.splitlines() if line.startswith("Style:")).split(",")[18] == "8"


def test_subtitle_start_snaps_to_best_scored_rhythm_point() -> None:
    document = LyricsDocument(title=None, lines=["一行目", "二行目"])
    chunks = [TranscriptChunk(10.438, 11.0, "一行目"), TranscriptChunk(12.0, 13.0, "二行目")]
    lines = align_lyrics_to_chunks(document, chunks, media_duration=14.0).lines

    result = adjust_lines_to_rhythm(lines, [10.0, 10.5, 11.0, 11.5, 12.0])

    assert result.lines[0].start == 10.5
    assert result.adjustments[0].original == 10.438
    assert result.adjustments[0].adjusted == 10.5
    assert result.adjustments[0].shift_ms == 62
    assert result.adjustments[0].grid == "beat"


def test_original_start_wins_when_grid_candidate_is_outside_radius_or_too_weak() -> None:
    document = LyricsDocument(title=None, lines=["歌詞"])
    line = align_lyrics_to_chunks(document, [TranscriptChunk(5.18, 6.0, "歌詞")], media_duration=7.0).lines

    result = adjust_lines_to_rhythm(line, [5.0, 6.0])

    assert result.lines[0].start == 5.18
    assert result.adjustments[0].grid == "original"
    assert result.adjustments[0].shift_ms == 0


def test_rhythm_adjustment_preserves_order_positive_duration_and_non_overlap() -> None:
    document = LyricsDocument(title=None, lines=["一行目", "二行目"])
    chunks = [TranscriptChunk(1.11, 2.01, "一行目"), TranscriptChunk(2.02, 3.0, "二行目")]
    lines = align_lyrics_to_chunks(document, chunks, media_duration=4.0).lines

    result = adjust_lines_to_rhythm(lines, [1.0, 2.0, 3.0])

    assert all(line.end > line.start for line in result.lines)
    assert result.lines[0].start < result.lines[1].start
    assert result.lines[0].end < result.lines[1].start


def test_rhythm_candidate_cannot_reduce_required_display_lead() -> None:
    document = LyricsDocument(title=None, lines=["歌詞"])
    line = align_lyrics_to_chunks(document, [TranscriptChunk(9.92, 11.0, "歌詞")], media_duration=12.0).lines

    result = adjust_lines_to_rhythm(line, [10.0, 10.5], singing_starts=[10.1], minimum_display_lead=0.15)

    assert result.lines[0].start == 9.92
    assert result.adjustments[0].grid == "original"


@pytest.mark.skipif(
    os.environ.get("SONGCUT_RUN_LYRICS_E2E") != "1",
    reason="Set SONGCUT_RUN_LYRICS_E2E=1 to run the local Whisper/model integration test.",
)
def test_testdata_song_generates_original_and_rhythm_adjusted_srt(tmp_path: Path) -> None:
    repository = Path(__file__).resolve().parents[1]
    stem = "02_「星の消えた夜に」 - Aimer"
    source = repository / "testdata" / f"{stem}.webm"
    lyrics = repository / "testdata" / f"{stem}.lyrics.txt"
    model = repository / ".models" / "openvino" / "whisper-small"
    original_output = tmp_path / f"{stem}.aligned.srt"
    rhythm_output = tmp_path / f"{stem}.beat-adjusted.srt"
    rhythm_diagnostics = tmp_path / f"{stem}.beat-adjustments.json"

    if not source.exists() or not lyrics.exists() or not model.exists():
        pytest.skip("Local song, lyrics, or Whisper Small model is unavailable.")

    result, rhythm = generate_lyrics_srt_variants(
        source,
        lyrics,
        original_output,
        rhythm_output,
        rhythm_diagnostics_path=rhythm_diagnostics,
        model_dir=model,
        device="cpu",
        language="ja",
    )

    assert original_output.exists()
    assert rhythm_output.exists()
    assert Path(f"{original_output}.style").exists()
    assert Path(f"{rhythm_output}.style").exists()
    assert rhythm_diagnostics.exists()
    assert len(result.lines) >= 30
    assert len(rhythm.lines) == len(result.lines)
    assert result.lines[0].start >= 0
    assert all(line.end > line.start for line in result.lines)
    assert all(left.start < right.start for left, right in zip(result.lines, result.lines[1:]))
    assert all(line.end > line.start for line in rhythm.lines)
    assert all(left.start < right.start for left, right in zip(rhythm.lines, rhythm.lines[1:]))
    assert any(adjustment.grid != "original" for adjustment in rhythm.adjustments)
    original_srt = original_output.read_text(encoding="utf-8-sig")
    rhythm_srt = rhythm_output.read_text(encoding="utf-8-sig")
    diagnostics = json.loads(rhythm_diagnostics.read_text(encoding="utf-8"))
    assert original_srt != rhythm_srt
    assert "星の消えた夜に" in original_srt
    assert "星の消えた夜に" in rhythm_srt
    original_style = Path(f"{original_output}.style").read_text(encoding="utf-8-sig")
    rhythm_style = Path(f"{rhythm_output}.style").read_text(encoding="utf-8-sig")
    assert next(line for line in original_style.splitlines() if line.startswith("Style:")).split(",")[18] == "2"
    assert next(line for line in rhythm_style.splitlines() if line.startswith("Style:")).split(",")[18] == "8"
    assert diagnostics["tempo_bpm"] > 0
    assert diagnostics["beat_times"]
    assert len(diagnostics["adjustments"]) == len(result.lines)
    assert all(abs(adjustment["shift_ms"]) <= 120 for adjustment in diagnostics["adjustments"])
    assert all(
        {"original", "adjusted", "shift_ms", "grid"} <= adjustment.keys()
        for adjustment in diagnostics["adjustments"]
    )

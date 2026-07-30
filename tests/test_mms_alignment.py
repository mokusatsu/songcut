from __future__ import annotations

import os
import re
import tempfile
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
import pytest

from songcut.ffmpeg_tools import find_ffmpeg
from songcut.mms_alignment import (
    MMS_INPUTS_TO_LOGITS_RATIO,
    MMS_SAMPLE_RATE,
    CtcAlignmentResult,
    CtcLineSpan,
    MmsOnnxRunner,
    PreparedLyricsLine,
    align_prepared_lines,
    bundled_mms_onnx_model_dir,
    ensure_mms_onnx_model,
    load_mms_vocabulary,
    merge_mms_onset_into_standard_alignment,
    mms_onnx_model_ready,
    mms_onnx_model_status,
    normalize_whisper_to_mms_language,
    prepare_lyrics_lines,
    read_media_mono_16k,
    resolve_mms_onnx_model_dir,
)
from songcut.lyrics_alignment import AlignedLyricsLine, LyricsAlignmentResult
from songcut.source_separation import separate_vocals
from songcut.transcription import extract_segment_wav, read_wav_mono_16k


def test_whisper_language_is_mapped_to_uroman_iso_639_3() -> None:
    assert normalize_whisper_to_mms_language("ja") == "jpn"
    assert normalize_whisper_to_mms_language("<|en|>") == "eng"
    assert normalize_whisper_to_mms_language("kor") == "kor"
    with pytest.raises(ValueError, match="detected Whisper language"):
        normalize_whisper_to_mms_language("auto")


def test_prepare_lines_uses_requested_language_and_preserves_line_indexes() -> None:
    calls: list[tuple[str, str]] = []

    def romanize(text: str, language: str) -> str:
        calls.append((text, language))
        return {"ようこそ": "yookoso", "森の奥": "mori no oku"}[text]

    vocabulary = {character: index + 1 for index, character in enumerate("abcdefghijklmnopqrstuvwxyz'")}
    lines = prepare_lyrics_lines(
        ["ようこそ", "森の奥"],
        language="ja",
        vocabulary=vocabulary,
        romanize=romanize,
    )

    assert calls == [("ようこそ", "jpn"), ("森の奥", "jpn")]
    assert [line.index for line in lines] == [1, 2]
    assert [line.romanized for line in lines] == ["yookoso", "mori no oku"]
    assert all(line.token_coverage == 1.0 for line in lines)


def test_prepare_lines_reports_vocabulary_coverage_without_changing_original_text() -> None:
    lines = prepare_lyrics_lines(
        ["歌詞"],
        language="ja",
        vocabulary={"a": 1, "b": 2},
        romanize=lambda _text, _language: "abz",
    )

    assert lines[0].text == "歌詞"
    assert lines[0].token_ids == (1, 2)
    assert lines[0].token_coverage == pytest.approx(2 / 3)


def test_prepare_japanese_lines_uses_spoken_kanji_readings() -> None:
    vocabulary = {character: index + 1 for index, character in enumerate("abcdefghijklmnopqrstuvwxyz'")}

    lines = prepare_lyrics_lines(
        ["ようこそ深い森の奥", "珍しいお客さんね"],
        language="ja",
        vocabulary=vocabulary,
    )

    assert [line.romanized for line in lines] == [
        "youkosofukaimorinooku",
        "mezurashiiokyakusanne",
    ]


def test_model_status_resolves_bundled_q4_model() -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
        root = Path(temporary_directory)
        bundled_root = root / "bundled"
        model_dir = bundled_root / "onnx" / "mms-300m-1130-forced-aligner"
        for relative in (
            "onnx/model_q4.onnx",
            "config.json",
            "preprocessor_config.json",
            "tokenizer_config.json",
            "vocab.json",
        ):
            path = model_dir / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"model")
        with mock.patch.dict(
            os.environ,
            {
                "SONGCUT_MODEL_DIR": str(root / "downloaded"),
                "SONGCUT_BUNDLED_MODEL_DIR": str(bundled_root),
            },
            clear=False,
        ):
            assert bundled_mms_onnx_model_dir() == model_dir
            assert mms_onnx_model_ready(model_dir)
            assert resolve_mms_onnx_model_dir() == (model_dir, "bundled")
            status = mms_onnx_model_status()
        assert status["ready"] is True
        assert status["source"] == "bundled"
        assert status["installed_bytes"] == 5 * len(b"model")


def _standard_alignment(lines: list[AlignedLyricsLine]) -> LyricsAlignmentResult:
    return LyricsAlignmentResult(
        title=None,
        lines=lines,
        whisper_text="recognized",
        whisper_chunks=[],
        edit_cost=0.0,
        lyrics_characters=10,
        recognized_characters=10,
    )


def test_mms_only_refines_opening_through_first_reliable_whisper_line() -> None:
    standard = _standard_alignment(
        [
            AlignedLyricsLine(1, "opening", 28.0, 29.0, 0.0, "interpolated", 0, 0, 7),
            AlignedLyricsLine(2, "first anchor", 30.0, 34.0, 0.9, "whisper-chunk", 8, 8, 8),
            AlignedLyricsLine(3, "later", 35.0, 39.0, 0.9, "whisper-chunk", 5, 5, 5),
        ]
    )
    ctc = CtcAlignmentResult(
        lines=[
            CtcLineSpan(1, "opening", 22.8, 28.7, 0.8, 7, 1.0),
            CtcLineSpan(2, "first anchor", 29.1, 34.2, 0.8, 8, 1.0),
            CtcLineSpan(3, "later", 34.2, 38.8, 0.8, 5, 1.0),
        ],
        frame_seconds=0.02,
        path_score=-0.5,
        star_ratio=0.4,
    )

    refined, diagnostics = merge_mms_onset_into_standard_alignment(standard, ctc)

    assert refined.lines[0].start == pytest.approx(22.8)
    assert refined.lines[0].source == "mms-ctc"
    assert refined.lines[1].start == pytest.approx(29.1)
    assert refined.lines[1].end == standard.lines[1].end
    assert refined.lines[1].source == "whisper-chunk+mms-onset"
    assert refined.lines[2] == standard.lines[2]
    assert diagnostics.applied_line_indexes == [1, 2]
    assert diagnostics.first_reliable_whisper_line == 2


def test_mms_does_not_move_first_whisper_anchor_for_small_difference() -> None:
    anchor = AlignedLyricsLine(1, "line", 10.0, 12.0, 0.9, "whisper-chunk", 4, 4, 4)
    standard = _standard_alignment([anchor])
    ctc = CtcAlignmentResult(
        lines=[CtcLineSpan(1, "line", 9.9, 12.0, 0.8, 4, 1.0)],
        frame_seconds=0.02,
        path_score=-0.2,
        star_ratio=0.2,
    )

    refined, diagnostics = merge_mms_onset_into_standard_alignment(standard, ctc)

    assert refined.lines == [anchor]
    assert diagnostics.applied_line_indexes == []


def test_onnx_runner_normalizes_audio_and_returns_log_probabilities() -> None:
    captured: dict[str, np.ndarray] = {}

    class FakeSession:
        def get_inputs(self):
            return [SimpleNamespace(name="input_values")]

        def run(self, _outputs, inputs):
            captured.update(inputs)
            return [np.asarray([[[1.0, 2.0], [3.0, 1.0]]], dtype=np.float32)]

    emissions = MmsOnnxRunner(Path("unused.onnx"), session=FakeSession()).emissions(
        np.asarray([1.0, 2.0, 3.0], dtype=np.float32)
    )

    assert captured["input_values"].shape == (1, 3)
    assert float(np.mean(captured["input_values"])) == pytest.approx(0.0, abs=1e-6)
    np.testing.assert_allclose(np.exp(emissions).sum(axis=1), np.ones(2), atol=1e-6)


def test_mms_audio_reader_converts_demucs_stereo_44k_wav() -> None:
    sample_rate = 44_100
    frame_count = sample_rate // 4
    time_axis = np.arange(frame_count, dtype=np.float32) / sample_rate
    left = 0.2 * np.sin(2 * np.pi * 220 * time_axis)
    right = 0.2 * np.sin(2 * np.pi * 330 * time_axis)
    stereo = np.stack((left, right), axis=1)
    pcm = np.round(np.clip(stereo, -1.0, 1.0) * 32767).astype("<i2")

    with tempfile.TemporaryDirectory() as temporary_directory:
        source = Path(temporary_directory) / "demucs-vocals.wav"
        with wave.open(str(source), "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(sample_rate)
            output.writeframes(pcm.tobytes())
        try:
            converted = read_media_mono_16k(source)
        except FileNotFoundError as exc:
            pytest.skip(str(exc))

    assert converted.dtype == np.float32
    assert converted.ndim == 1
    assert converted.size == pytest.approx(4_000, abs=16)
    assert float(np.max(np.abs(converted))) > 0.01


def test_star_ctc_alignment_places_lines_around_unmatched_audio() -> None:
    # blank=0, a=1, b=2. Extra frames before, between and after the lyrics are
    # deliberately blank-like; the synthetic star states absorb those gaps.
    probabilities = np.asarray(
        [
            [0.90, 0.05, 0.05],
            [0.90, 0.05, 0.05],
            [0.05, 0.90, 0.05],
            [0.90, 0.05, 0.05],
            [0.90, 0.05, 0.05],
            [0.90, 0.05, 0.05],
            [0.05, 0.05, 0.90],
            [0.90, 0.05, 0.05],
            [0.90, 0.05, 0.05],
        ],
        dtype=np.float32,
    )
    lines = [
        PreparedLyricsLine(1, "A", "a", (1,), 1.0),
        PreparedLyricsLine(2, "B", "b", (2,), 1.0),
    ]

    result = align_prepared_lines(
        np.log(probabilities),
        lines,
        frame_seconds=0.02,
        time_offset=10.0,
    )

    assert [line.index for line in result.lines] == [1, 2]
    assert result.lines[0].start == pytest.approx(10.04)
    assert result.lines[1].start == pytest.approx(10.12)
    assert result.star_ratio > 0
    assert all(line.confidence > 0.8 for line in result.lines)


def _read_srt_entries(path: Path) -> list[tuple[float, float, str]]:
    blocks = re.split(r"\r?\n\r?\n", path.read_text(encoding="utf-8-sig").strip())
    entries: list[tuple[float, float, str]] = []
    for block in blocks:
        rows = block.splitlines()
        start_text, end_text = rows[1].split(" --> ")
        entries.append((_srt_seconds(start_text), _srt_seconds(end_text), "\n".join(rows[2:])))
    return entries


def _srt_seconds(value: str) -> float:
    hours, minutes, seconds = value.replace(",", ".").split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


@pytest.mark.skipif(
    os.environ.get("SONGCUT_RUN_MMS_E2E") != "1",
    reason="Set SONGCUT_RUN_MMS_E2E=1 to run the local MMS ONNX integration test.",
)
def test_q4_mms_aligns_kokia_opening_lines_close_to_reference() -> None:
    repository = Path(__file__).resolve().parents[1]
    source = repository / "testdata" / "01_フクロウ ～フクロウが知らせる客が来たと～ - KOKIA-subtitled.mp4"
    reference = repository / "testdata" / "01_フクロウ ～フクロウが知らせる客が来たと～ - KOKIA-sub-1.srt"
    if not source.is_file() or not reference.is_file():
        pytest.skip("KOKIA source or reference SRT is unavailable.")

    model_dir = repository / ".models" / "onnx" / "mms-300m-1130-forced-aligner"
    if os.environ.get("SONGCUT_MMS_ALLOW_DOWNLOAD") == "1":
        model_path = ensure_mms_onnx_model(model_dir, variant="q4")
    else:
        model_path = model_dir / "onnx" / "model_q4.onnx"
    if not model_path.is_file():
        pytest.skip("MMS Q4 model is unavailable; set SONGCUT_MMS_ALLOW_DOWNLOAD=1.")

    expected = _read_srt_entries(reference)[:2]
    lyrics = [entry[2] for entry in expected]
    window_start = 18.0
    window_end = 37.0
    with tempfile.TemporaryDirectory(prefix="songcut-mms-e2e-") as temp:
        temp_dir = Path(temp)
        separated = separate_vocals(source, temp_dir / "demucs")
        window_wav = temp_dir / "opening.wav"
        extract_segment_wav(
            find_ffmpeg().ffmpeg,
            separated.vocals,
            window_wav,
            start=window_start,
            end=window_end,
        )
        audio = read_wav_mono_16k(window_wav)

    vocabulary = load_mms_vocabulary(model_dir)
    prepared = prepare_lyrics_lines(lyrics, language="ja", vocabulary=vocabulary)
    emissions = MmsOnnxRunner(model_path).emissions(audio)
    result = align_prepared_lines(
        emissions,
        prepared,
        blank_id=int(vocabulary.get("<blank>", 0)),
        frame_seconds=MMS_INPUTS_TO_LOGITS_RATIO / MMS_SAMPLE_RATE,
        time_offset=window_start,
    )

    assert len(result.lines) == 2
    errors = [abs(actual.start - target[0]) for actual, target in zip(result.lines, expected, strict=True)]
    diagnostics = {
        "expected": [entry[0] for entry in expected],
        "actual": [line.start for line in result.lines],
        "errors": errors,
        "star_ratio": result.star_ratio,
    }
    print(f"MMS KOKIA opening diagnostics: {diagnostics}")
    assert max(errors) <= 1.0, diagnostics

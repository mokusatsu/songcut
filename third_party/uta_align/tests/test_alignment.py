from __future__ import annotations

import json

import pytest

from uta_align.alignment import edit_similarity
from uta_align.backends import FakeBackend
from uta_align.config import AlignConfig
from uta_align.lyrics import parse_lyrics_text
from uta_align.models import Observation
from uta_align.pipeline import align_lyrics


def obs(start: float, end: float, text: str, confidence: float = 0.96) -> Observation:
    return Observation(
        start,
        end,
        text,
        confidence,
        0.02,
        "fake",
        boundary_support="segment",
    )


def config() -> AlignConfig:
    return AlignConfig(
        require_segment_word_corroboration=False,
        window_seconds=12,
        overlap_seconds=3,
        retry_window_seconds=10,
        long_gap_seconds=7,
        hard_gap_seconds=2,
        boundary_search_seconds=0,
        min_similarity=0.42,
        anchor_similarity=0.57,
    )


def test_edit_similarity() -> None:
    assert edit_similarity("あおいそら", "あおいそら") == 1
    assert edit_similarity("あおいそら", "あおい") > edit_similarity("あおいそら", "xyz")


def test_missing_song_head_is_recovered_by_reset_retry(wav_factory) -> None:
    audio = wav_factory(duration=8)
    lyrics = parse_lyrics_text("最初の声\n次の言葉")
    backend = FakeBackend(
        [obs(0.8, 1.8, "最初の声"), obs(2.1, 3.1, "次の言葉")],
        visible_in={0: {"head_retry"}, 1: {"global", "overlap", "head_retry"}},
    )
    result = align_lyrics(audio, lyrics, backend, config=config())
    assert [line.text for line in result.lines] == ["最初の声", "次の言葉"]
    assert result.lines[0].start == pytest.approx(0.8)
    assert any(
        request.kind == "head_retry" and request.context_reset
        for request in backend.requests
    )
    assert any("head_retry" in source for source in result.lines[0].provenance)


def test_missing_second_block_head_after_long_interlude_is_recovered(wav_factory) -> None:
    audio = wav_factory(duration=25)
    lyrics = parse_lyrics_text("一番の歌\n\n二番の頭\n二番の続き")
    backend = FakeBackend(
        [
            obs(1.0, 2.0, "一番の歌"),
            obs(15.2, 16.1, "二番の頭"),
            obs(17.0, 18.0, "二番の続き"),
        ],
        visible_in={
            0: {"global", "overlap"},
            1: {"gap_retry"},
            2: {"global", "overlap", "gap_retry"},
        },
    )
    result = align_lyrics(audio, lyrics, backend, config=config())
    assert result.lines[1].start == pytest.approx(15.2)
    assert "gap_retry" in "|".join(result.lines[1].provenance)
    assert result.lines[0].end < result.lines[1].start


def test_credit_hallucinations_never_become_output(wav_factory) -> None:
    audio = wav_factory(duration=10)
    lyrics = parse_lyrics_text("本当の歌\n続く歌")
    backend = FakeBackend(
        [
            obs(0.1, 0.8, "作詞: 山田", 0.99),
            obs(1.0, 2.0, "本当の歌"),
            obs(3.0, 4.0, "続く歌"),
            obs(8.0, 9.0, "ご視聴ありがとうございました", 0.99),
        ]
    )
    result = align_lyrics(audio, lyrics, backend, config=config())
    assert [line.text for line in result.lines] == ["本当の歌", "続く歌"]
    rejected = result.diagnostics["rejected_observations"]
    assert {item["reason"] for item in rejected} == {"credit_hallucination"}
    assert all("text" not in item for item in rejected)
    public_json = json.dumps(result.to_dict(), ensure_ascii=False)
    assert "作詞: 山田" not in public_json
    assert "ご視聴ありがとうございました" not in public_json


def test_identical_repeated_lyrics_follow_time_order(wav_factory) -> None:
    audio = wav_factory(duration=12)
    lyrics = parse_lyrics_text("ラララ\nラララ\nラララ")
    backend = FakeBackend(
        [obs(1, 2, "ラララ"), obs(4, 5, "ラララ"), obs(8, 9, "ラララ")]
    )
    result = align_lyrics(audio, lyrics, backend, config=config())
    assert [line.start for line in result.lines] == pytest.approx([1, 4, 8])
    assert all(line.diagnostics["anchored"] for line in result.lines)


def test_short_lines_require_strong_exact_evidence(wav_factory) -> None:
    audio = wav_factory(duration=8)
    lyrics = parse_lyrics_text("あ\nい\nあ")
    backend = FakeBackend([obs(1, 1.5, "あ"), obs(2, 2.5, "い"), obs(3, 3.5, "あ")])
    result = align_lyrics(
        audio,
        lyrics,
        backend,
        config=config().merged({"max_progress_deviation": 0.50}),
    )
    assert [line.start for line in result.lines] == pytest.approx([1, 2, 3])


def test_anchor_poor_line_is_interpolated_only_inside_safe_span(wav_factory) -> None:
    audio = wav_factory(duration=10)
    lyrics = parse_lyrics_text("始まり\n認識されない中間行\n終わり")
    backend = FakeBackend([obs(1, 2, "始まり"), obs(3.5, 4.5, "終わり")])
    result = align_lyrics(
        audio,
        lyrics,
        backend,
        config=config().merged({"max_progress_deviation": 0.50}),
    )
    middle = result.lines[1]
    assert middle.start >= 2
    assert middle.end <= 3.5
    assert middle.provenance == ["safe_interpolation"]
    assert middle.confidence < result.lines[0].confidence


def test_silent_audio_without_anchors_returns_safe_provisional_schedule(
    wav_factory,
) -> None:
    audio = wav_factory(duration=6, active=[])
    result = align_lyrics(
        audio,
        parse_lyrics_text("歌詞"),
        FakeBackend([]),
        config=config(),
    )
    assert result.diagnostics["fallback"]["stage"] == 4
    assert result.lines[0].start < result.lines[0].end
    assert result.lines[0].confidence <= 0.04
    assert result.lines[0].provenance == [
        "fallback_stage_4_safe_component_schedule"
    ]


def test_all_anchor_missing_multiline_schedule_is_complete_and_monotonic(
    wav_factory,
) -> None:
    audio = wav_factory(duration=6, active=[])
    lyrics = parse_lyrics_text("第一行\n第二行\n第三行\n第四行")
    result = align_lyrics(audio, lyrics, FakeBackend([]), config=config())
    assert [line.text for line in result.lines] == [
        "第一行", "第二行", "第三行", "第四行"
    ]
    assert result.diagnostics["fallback"]["stage"] == 4
    assert all(line.start < line.end for line in result.lines)
    assert all(
        left.end <= right.start
        for left, right in zip(result.lines, result.lines[1:], strict=False)
    )
    assert all(line.confidence == 0.04 for line in result.lines)


def test_vocal_stem_silence_is_not_crossed_by_interpolation(wav_factory) -> None:
    mixture = wav_factory(duration=14, name="mixture.wav")
    stem = wav_factory(duration=14, active=[(0.5, 3), (9, 12)], name="stem.wav")
    lyrics = parse_lyrics_text("前半\n\n後半")
    backend = FakeBackend([obs(1, 2, "前半"), obs(9.5, 10.5, "後半")])
    result = align_lyrics(
        mixture,
        lyrics,
        backend,
        config=config(),
        vocal_stem_path=stem,
    )
    assert result.lines[0].end <= 3.2
    assert result.lines[1].start >= 8.8
    assert result.diagnostics["confirmed_vocal_stem_silences"]
    assert result.diagnostics["acoustic_role"] == "trusted_isolated_vocal_envelope"

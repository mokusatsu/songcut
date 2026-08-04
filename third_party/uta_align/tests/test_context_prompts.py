from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from uta_align.alignment import build_candidate_consensus
from uta_align.backends import FakeBackend, FasterWhisperBackend
from uta_align.config import AlignConfig
from uta_align.fallback import _stage_four
from uta_align.lyrics import parse_lyrics_text
from uta_align.models import (
    Candidate,
    Observation,
    PromptStrategy,
    TranscriptionRequest,
)
from uta_align.pipeline import (
    _context_token_count,
    _run_requests,
    _window_requests,
    align_lyrics,
)


def round11_config(**changes: object) -> AlignConfig:
    base = AlignConfig(
        boundary_search_seconds=0,
        window_seconds=20,
        overlap_seconds=5,
        retry_window_seconds=10,
        long_gap_seconds=6,
        hard_gap_seconds=2,
        context_prompt_max_tokens=16,
        context_prompt_line_radius=2,
        contextual_request_budget=6,
        segment_freeze_min_similarity=0.78,
        segment_freeze_min_independence_groups=2,
        segment_freeze_min_strategy_groups=2,
        segment_word_agreement_seconds=0.85,
        require_segment_word_corroboration=True,
    )
    return replace(base, **changes)


def evidence_candidate(
    *,
    request_id: str,
    group: str,
    strategy: PromptStrategy,
    source_family: str | None = None,
    boundary: str = "segment",
    similarity: float = 0.90,
    start: float = 10.0,
    end: float = 11.0,
) -> Candidate:
    return Candidate(
        line_index=0,
        obs_start_index=0,
        obs_end_index=0,
        start=start,
        end=end,
        similarity=similarity,
        confidence=0.95,
        score=6.0,
        provenance=("round11",),
        boundary_support=boundary,  # type: ignore[arg-type]
        request_ids=(request_id,),
        support_observation_indexes=(0,),
        no_speech_prob=0.01,
        independence_groups=(group,),
        prompt_strategies=(strategy,),
        source_families=(source_family or f"family:{group}",),
        boundary_support_types=(boundary,),  # type: ignore[arg-type]
    )


def test_contextual_request_parameters_are_local_bounded_and_text_free() -> None:
    lyrics = parse_lyrics_text(
        "\n".join(
            [
                "冒頭甲乙",
                "序盤丙丁",
                "前半戊己",
                "中央庚辛",
                "後半壬癸",
                "終盤子丑",
                "末尾寅卯",
            ]
        )
    )
    config = round11_config(
        window_seconds=30,
        overlap_seconds=5,
        context_prompt_max_tokens=8,
        contextual_request_budget=5,
    )

    requests = _window_requests(120.0, config, lyrics)

    assert requests[0].kind == "global"
    assert requests[0].prompt_strategy == "unprompted"
    assert requests[0].context_reset is False
    assert requests[1].prompt_strategy == "global_initial_prompt"
    assert requests[1].initial_prompt
    assert "冒頭甲乙" in requests[1].initial_prompt
    assert requests[1].hotwords is None
    overlap = [request for request in requests if request.kind == "overlap"]
    assert {
        request.prompt_strategy for request in overlap
    } >= {"unprompted", "local_initial_prompt", "local_hotwords"}
    assert sum(
        request.prompt_strategy != "unprompted"
        for request in requests
    ) <= config.contextual_request_budget
    for request in requests:
        assert not (request.initial_prompt and request.hotwords)
        context = request.initial_prompt or request.hotwords
        if context:
            assert _context_token_count(context) <= (
                config.context_prompt_max_tokens
            )
    late_contexts = [
        request.initial_prompt or request.hotwords
        for request in overlap
        if request.start >= 50
        and (request.initial_prompt or request.hotwords)
    ]
    assert late_contexts
    assert any("冒頭甲乙" not in context for context in late_contexts)

    _, diagnostics = _run_requests(
        FakeBackend([]),
        Path("unused.wav"),
        requests,
        config,
    )
    serialized = json.dumps(diagnostics, ensure_ascii=False)
    assert "冒頭甲乙" not in serialized
    assert all(
        "prompt_strategy" in item
        and "independence_group" in item
        and "source_family" in item
        for item in diagnostics
    )


class _ModelStub:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def transcribe(
        self,
        _audio_path: str,
        **kwargs: Any,
    ) -> tuple[list[object], object]:
        self.calls.append(kwargs)
        return [], object()


def test_faster_whisper_receives_exact_prompt_and_hotword_parameters() -> None:
    config = round11_config()
    backend = FasterWhisperBackend()
    model = _ModelStub()
    backend._model = model
    backend._model_key = (
        config.model,
        config.device,
        config.compute_type,
    )

    backend.transcribe(
        "unused.wav",
        TranscriptionRequest(
            2.0,
            8.0,
            "overlap",
            context_reset=True,
            prompt_strategy="local_initial_prompt",
            source_family="overlap_window",
            independence_group="group-initial",
            initial_prompt="近傍歌詞",
        ),
        config,
    )
    backend.transcribe(
        "unused.wav",
        TranscriptionRequest(
            8.0,
            14.0,
            "gap_retry",
            context_reset=True,
            prompt_strategy="local_hotwords",
            source_family="gap_retry",
            independence_group="group-hotwords",
            hotwords="別の近傍",
        ),
        config,
    )

    initial, hotwords = model.calls
    assert initial["initial_prompt"] == "近傍歌詞"
    assert "hotwords" not in initial
    assert hotwords["hotwords"] == "別の近傍"
    assert "initial_prompt" not in hotwords
    for kwargs in model.calls:
        assert kwargs["word_timestamps"] is True
        assert kwargs["condition_on_previous_text"] is False
        assert kwargs["vad_filter"] is False


def test_faster_whisper_rejects_hotwords_with_prefix() -> None:
    config = round11_config()
    backend = FasterWhisperBackend()
    model = _ModelStub()
    backend._model = model
    backend._model_key = (
        config.model,
        config.device,
        config.compute_type,
    )

    with pytest.raises(ValueError, match="cannot be used together"):
        backend.transcribe(
            "unused.wav",
            TranscriptionRequest(
                0.0,
                4.0,
                "overlap",
                context_reset=True,
                prompt_strategy="local_initial_prompt",
                source_family="overlap_window",
                independence_group="invalid-combination",
                initial_prompt="prefix",
                hotwords="hotwords",
            ),
            config,
        )
    assert model.calls == []


def _request_observation(
    observation: Observation,
    request: TranscriptionRequest,
) -> Observation:
    return replace(
        observation,
        provenance=f"{observation.provenance}:{request.prompt_strategy}",
        request_kind=request.kind,
        request_id=(
            f"{request.kind}:{request.start:.3f}-{request.end:.3f}:"
            f"{request.prompt_strategy}"
        ),
        prompt_strategy=request.prompt_strategy,
        source_family=request.source_family,
        independence_group=request.independence_group,
        prompt_strategies=(request.prompt_strategy,),
        source_families=(request.source_family,),
        independence_groups=(request.independence_group,),
    )


class _PromptCoverageBackend:
    def __init__(self, *, fail_contextual: bool = False) -> None:
        self.fail_contextual = fail_contextual
        self.requests: list[TranscriptionRequest] = []
        self.first = Observation(
            2.0,
            3.0,
            "冒頭行",
            0.97,
            0.01,
            "round11-first",
            boundary_support="line",
        )
        self.second = Observation(
            48.0,
            49.0,
            "末尾行",
            0.97,
            0.01,
            "round11-second",
            boundary_support="line",
        )

    def transcribe(
        self,
        _audio_path: str | Path,
        request: TranscriptionRequest,
        _config: AlignConfig,
    ) -> list[Observation]:
        self.requests.append(request)
        if request.prompt_strategy != "unprompted":
            if self.fail_contextual:
                raise RuntimeError("prompted variant failed")
            observations = [self.first, self.second]
        else:
            observations = [self.first]
        return [
            _request_observation(observation, request)
            for observation in observations
            if observation.end > request.start
            and observation.start < request.end
        ]


def test_contextual_variant_increases_candidate_coverage(wav_factory) -> None:
    audio = wav_factory(duration=60)
    lyrics = parse_lyrics_text("冒頭行\n末尾行")
    disabled = align_lyrics(
        audio,
        lyrics,
        _PromptCoverageBackend(),
        config=round11_config(enable_contextual_prompts=False),
    )
    enabled = align_lyrics(
        audio,
        lyrics,
        _PromptCoverageBackend(),
        config=round11_config(enable_contextual_prompts=True),
    )

    disabled_lines = disabled.diagnostics["candidate_consensus"]["lines"]
    enabled_lines = enabled.diagnostics["candidate_consensus"]["lines"]
    assert disabled_lines["1"] == []
    assert enabled_lines["1"]
    assert len(enabled.lines) == len(lyrics)


def test_prompt_failure_keeps_unprompted_completion_and_redacts_context(
    wav_factory,
) -> None:
    audio = wav_factory(duration=60)
    lyrics = parse_lyrics_text("冒頭行\n末尾行")
    backend = _PromptCoverageBackend(fail_contextual=True)

    result = align_lyrics(
        audio,
        lyrics,
        backend,
        config=round11_config(),
    )

    assert len(result.lines) == len(lyrics)
    failed = [
        item
        for item in result.diagnostics["backend_requests"]
        if item["contextual_request_failed"]
    ]
    assert failed
    assert all(item["failure_type"] == "RuntimeError" for item in failed)
    diagnostics_json = json.dumps(result.diagnostics, ensure_ascii=False)
    assert "冒頭行" not in diagnostics_json
    assert "末尾行" not in diagnostics_json
    assert "prompted variant failed" not in diagnostics_json


def test_consensus_counts_decorrelated_groups_not_raw_requests() -> None:
    lyrics = parse_lyrics_text("対象行")
    config = round11_config(require_segment_word_corroboration=False)
    same_group = [
        evidence_candidate(
            request_id="request-a",
            group="same-group",
            strategy="unprompted",
        ),
        evidence_candidate(
            request_id="request-b",
            group="same-group",
            strategy="unprompted",
        ),
    ]
    independent = [
        same_group[0],
        evidence_candidate(
            request_id="request-c",
            group="other-group",
            strategy="local_initial_prompt",
        ),
    ]

    same_result, same_diagnostics = build_candidate_consensus(
        lyrics,
        {0: same_group},
        config,
        normal_mix=True,
    )
    independent_result, independent_diagnostics = build_candidate_consensus(
        lyrics,
        {0: independent},
        config,
        normal_mix=True,
    )

    assert same_result[0][0].support_count == 1
    assert same_result[0][0].freeze_eligible is False
    assert (
        same_diagnostics["lines"]["0"][0][
            "decorrelated_independence_group_count"
        ]
        == 1
    )
    assert independent_result[0][0].support_count == 2
    assert independent_result[0][0].freeze_eligible is True
    assert (
        independent_diagnostics["lines"]["0"][0][
            "decorrelated_independence_group_count"
        ]
        == 2
    )


@pytest.mark.parametrize(
    ("similarity", "strategies", "include_word", "expected_reason"),
    [
        (
            0.74,
            ("unprompted", "local_initial_prompt"),
            True,
            "segment_similarity_below_freeze_threshold",
        ),
        (
            0.90,
            ("unprompted", "unprompted"),
            True,
            "segment_insufficient_strategy_diversity",
        ),
        (
            0.90,
            ("unprompted", "local_initial_prompt"),
            False,
            "segment_without_word_corroboration",
        ),
    ],
)
def test_segment_candidate_requires_all_three_freeze_conditions(
    similarity: float,
    strategies: tuple[PromptStrategy, PromptStrategy],
    include_word: bool,
    expected_reason: str,
) -> None:
    lyrics = parse_lyrics_text("対象行")
    candidates = [
        evidence_candidate(
            request_id="segment-a",
            group="segment-group-a",
            strategy=strategies[0],
            similarity=similarity,
        ),
        evidence_candidate(
            request_id="segment-b",
            group="segment-group-b",
            strategy=strategies[1],
            similarity=similarity,
        ),
    ]
    if include_word:
        candidates.append(
            evidence_candidate(
                request_id="word-c",
                group="word-group-c",
                strategy=(
                    "unprompted"
                    if expected_reason == "segment_insufficient_strategy_diversity"
                    else "local_hotwords"
                ),
                boundary="word",
                similarity=similarity,
                start=10.1,
                end=10.9,
            )
        )

    result, diagnostics = build_candidate_consensus(
        lyrics,
        {0: candidates},
        round11_config(),
        normal_mix=True,
    )

    assert result[0][0].freeze_eligible is False
    assert result[0][0].quality_reason == expected_reason
    assert diagnostics["lines"]["0"][0]["quality_reason"] == expected_reason


def test_segment_candidate_freezes_with_decorrelated_word_agreement() -> None:
    lyrics = parse_lyrics_text("対象行")
    candidates = [
        evidence_candidate(
            request_id="segment-a",
            group="segment-group-a",
            strategy="unprompted",
        ),
        evidence_candidate(
            request_id="segment-b",
            group="segment-group-b",
            strategy="local_initial_prompt",
        ),
        evidence_candidate(
            request_id="word-c",
            group="word-group-c",
            strategy="local_hotwords",
            boundary="word",
            start=10.1,
            end=10.9,
        ),
    ]

    result, diagnostics = build_candidate_consensus(
        lyrics,
        {0: candidates},
        round11_config(),
        normal_mix=True,
    )

    assert result[0][0].freeze_eligible is True
    public = diagnostics["lines"]["0"][0]
    assert public["segment_word_agreement"] is True
    assert public["decorrelated_independence_group_count"] == 3
    assert public["strategy_group_count"] == 3


def test_default_soft_gap_penalty_is_finite_not_lexicographic() -> None:
    lyrics = parse_lyrics_text("一\n二\n三\n固定")
    anchor = evidence_candidate(
        request_id="anchor",
        group="anchor-group",
        strategy="unprompted",
        boundary="line",
        similarity=1.0,
        start=80.0,
        end=81.0,
    )
    anchor = replace(anchor, line_index=3)

    outcome = _stage_four(
        lyrics,
        {3: anchor},
        {},
        duration=100.0,
        forbidden=[],
        activity_components=[],
        config=round11_config(),
        reason="round11_finite_soft_penalty",
        soft_intervals=[(1.01, 79.99)],
    )

    assert all(
        line.end - line.start == pytest.approx(1.0)
        for line in outcome.lines[:3]
    )
    assert any(
        line.diagnostics["soft_gap_overlap_seconds"] > 0
        for line in outcome.lines[:3]
    )
    assert all(
        line.diagnostics["soft_avoidance_mode"]
        == "finite_soft_gap_penalty"
        for line in outcome.lines[:3]
    )
    assert outcome.diagnostics["compressed_for_soft_avoidance_count"] == 0
    assert outcome.diagnostics["unavoidable_soft_overlap"] is False
    assert outcome.diagnostics["soft_free_capacity_seconds"] > 0

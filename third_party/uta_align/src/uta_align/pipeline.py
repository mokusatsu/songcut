from __future__ import annotations

from collections.abc import Iterable
from dataclasses import replace
from pathlib import Path
from typing import Literal

from .alignment import (
    AlignmentError,
    build_candidate_consensus,
    build_candidates,
    clean_observations,
    materialize_lines,
    recognition_gaps,
    select_anchors,
    validate_alignment,
)
from .audio import AudioFeatures, load_audio_features, refine_boundary
from .backends import Backend
from .config import AlignConfig
from .fallback import build_fallback_alignment
from .lattice import select_global_lattice
from .models import (
    AlignedLine,
    AlignmentResult,
    Candidate,
    LyricLine,
    Observation,
    PromptStrategy,
    TranscriptionRequest,
)


def _context_token_count(value: str) -> int:
    # Japanese Whisper tokenization is model-dependent. Counting non-space
    # code points is a deterministic conservative budget proxy.
    return sum(not character.isspace() for character in value)


def _truncate_context(value: str, maximum_tokens: int) -> str:
    output: list[str] = []
    used = 0
    for character in value:
        cost = 0 if character.isspace() else 1
        if used + cost > maximum_tokens:
            break
        output.append(character)
        used += cost
    return "".join(output).strip()


def _local_lyric_context(
    lyrics: list[LyricLine],
    *,
    center: float,
    duration: float,
    config: AlignConfig,
) -> str | None:
    if not lyrics or duration <= 0:
        return None
    weights = [max(1, len(line.normalized)) for line in lyrics]
    total = sum(weights)
    target = min(total - 1e-9, max(0.0, center / duration * total))
    cumulative = 0
    target_position = 0
    for position, weight in enumerate(weights):
        cumulative += weight
        if target < cumulative:
            target_position = position
            break
    radius = config.context_prompt_line_radius
    left = max(0, target_position - radius)
    right = min(len(lyrics), target_position + radius + 1)
    positions = list(range(left, right))
    while len(positions) > 1:
        value = "\n".join(lyrics[position].text for position in positions)
        if _context_token_count(value) <= config.context_prompt_max_tokens:
            return value or None
        left_distance = target_position - positions[0]
        right_distance = positions[-1] - target_position
        if right_distance >= left_distance:
            positions.pop()
        else:
            positions.pop(0)
    if not positions:
        return None
    value = lyrics[positions[0]].text
    bounded = _truncate_context(value, config.context_prompt_max_tokens)
    return bounded or None


def _request_with_strategy(
    *,
    start: float,
    end: float,
    kind: Literal["global", "overlap", "head_retry", "gap_retry"],
    strategy: PromptStrategy,
    source_family: str,
    lyrics: list[LyricLine],
    duration: float,
    config: AlignConfig,
) -> TranscriptionRequest:
    context = (
        None
        if strategy == "unprompted"
        else _local_lyric_context(
            lyrics,
            center=(
                0.0
                if strategy == "global_initial_prompt"
                else (start + end) / 2
            ),
            duration=duration,
            config=config,
        )
    )
    if not context:
        strategy = "unprompted"
    independence_group = (
        f"{source_family}:{strategy}:{start:.3f}-{end:.3f}"
    )
    return TranscriptionRequest(
        start=start,
        end=end,
        kind=kind,
        context_reset=(kind != "global" or strategy != "unprompted"),
        prompt_strategy=strategy,
        source_family=source_family,
        independence_group=independence_group,
        initial_prompt=(
            context
            if strategy in {
                "global_initial_prompt",
                "local_initial_prompt",
            }
            else None
        ),
        hotwords=context if strategy == "local_hotwords" else None,
    )


def _window_requests(
    duration: float,
    config: AlignConfig,
    lyrics: list[LyricLine] | None = None,
) -> list[TranscriptionRequest]:
    lyric_lines = [] if lyrics is None else lyrics
    requests = [
        _request_with_strategy(
            start=0.0,
            end=duration,
            kind="global",
            strategy="unprompted",
            source_family="global_full",
            lyrics=lyric_lines,
            duration=duration,
            config=config,
        )
    ]
    contextual_used = 0
    if (
        lyric_lines
        and config.enable_contextual_prompts
        and config.contextual_request_budget > 0
    ):
        requests.append(
            _request_with_strategy(
                start=0.0,
                end=duration,
                kind="global",
                strategy="global_initial_prompt",
                source_family="global_prompt",
                lyrics=lyric_lines,
                duration=duration,
                config=config,
            )
        )
        contextual_used += 1
    if duration <= config.window_seconds:
        return requests
    variants: tuple[PromptStrategy, ...] = (
        "unprompted",
        "local_initial_prompt",
        "local_hotwords",
    )
    step = config.window_seconds - config.overlap_seconds
    start = 0.0
    ordinal = 0
    while start < duration:
        end = min(duration, start + config.window_seconds)
        strategy = variants[ordinal % len(variants)]
        if (
            not config.enable_contextual_prompts
            or contextual_used >= config.contextual_request_budget
        ):
            strategy = "unprompted"
        request = _request_with_strategy(
            start=start,
            end=end,
            kind="overlap",
            strategy=strategy,
            source_family="overlap_window",
            lyrics=lyric_lines,
            duration=duration,
            config=config,
        )
        requests.append(request)
        if request.prompt_strategy != "unprompted":
            contextual_used += 1
        ordinal += 1
        if end >= duration:
            break
        start += step
    return requests


def _retry_requests(
    duration: float,
    observations: list[Observation],
    lyrics: list[LyricLine],
    confirmed_silences: list[tuple[float, float]],
    config: AlignConfig,
    *,
    contextual_used: int = 0,
) -> list[TranscriptionRequest]:
    starts: list[tuple[float, Literal["head_retry", "gap_retry"]]] = []
    initial_candidates = build_candidates(
        lyrics,
        observations,
        config,
        confirmed_silences,
    )
    initial_candidates, _ = build_candidate_consensus(
        lyrics,
        initial_candidates,
        config,
        normal_mix=not config.input_audio_is_vocal_only,
    )
    covered_lines = {
        line.index
        for line in lyrics
        if any(
            candidate.similarity >= max(config.anchor_similarity, 0.82)
            and candidate.confidence >= 0.45
            and candidate.freeze_eligible
            for candidate in initial_candidates[line.index]
        )
    }
    missing_lines = {line.index for line in lyrics} - covered_lines
    if lyrics[0].index in missing_lines:
        starts.append((0.0, "head_retry"))
    if missing_lines:
        initial_gaps = recognition_gaps(
            _lyrics_supported_observations(
                observations,
                initial_candidates,
                config,
            ),
            config.long_gap_seconds,
        )
        for left, right in initial_gaps:
            starts.extend(
                [
                    (
                        max(
                            left,
                            right - config.retry_window_seconds * 0.55,
                        ),
                        "gap_retry",
                    ),
                    (max(left, right - 4.0), "gap_retry"),
                ]
            )
        reliable = [
            item
            for item in observations
            if item.confidence * (1.0 - item.no_speech_prob) >= 0.36
        ]
        for silence_start, silence_end in confirmed_silences:
            is_internal = (
                silence_start > config.forbidden_tolerance_seconds
                and silence_end
                < duration - config.forbidden_tolerance_seconds
            )
            has_observation_before = any(
                item.end
                <= silence_start + config.forbidden_tolerance_seconds
                for item in reliable
            )
            has_observation_after = any(
                item.start
                >= silence_end - config.forbidden_tolerance_seconds
                for item in reliable
            )
            if (
                is_internal
                and has_observation_before
                and has_observation_after
            ):
                starts.append(
                    (max(0.0, silence_end - 1.0), "gap_retry")
                )
    requests: list[TranscriptionRequest] = []
    seen: set[tuple[int, int]] = set()
    variants: tuple[PromptStrategy, ...] = (
        "unprompted",
        "local_initial_prompt",
        "local_hotwords",
    )
    for base, kind_value in starts:
        for offset in config.retry_offsets:
            start = max(0.0, min(duration, base + offset))
            end = min(duration, start + config.retry_window_seconds)
            key = (round(start * 100), round(end * 100))
            if key in seen or start >= duration:
                continue
            seen.add(key)
            strategy = variants[len(requests) % len(variants)]
            if (
                not config.enable_contextual_prompts
                or contextual_used >= config.contextual_request_budget
            ):
                strategy = "unprompted"
            request = _request_with_strategy(
                start=start,
                end=end,
                kind=kind_value,
                strategy=strategy,
                source_family=kind_value,
                lyrics=lyrics,
                duration=duration,
                config=config,
            )
            requests.append(request)
            if request.prompt_strategy != "unprompted":
                contextual_used += 1
    return requests


def _run_requests(
    backend: Backend,
    audio_path: str | Path,
    requests: Iterable[TranscriptionRequest],
    config: AlignConfig,
) -> tuple[list[Observation], list[dict[str, object]]]:
    observations: list[Observation] = []
    diagnostics: list[dict[str, object]] = []
    cache: dict[
        tuple[
            float,
            float,
            bool,
            PromptStrategy,
            str,
            str,
            str | None,
            str | None,
        ],
        list[Observation],
    ] = {}
    for request in requests:
        cache_key = (
            round(request.start, 3),
            round(request.end, 3),
            request.context_reset,
            request.prompt_strategy,
            request.source_family,
            request.independence_group,
            request.initial_prompt or request.prompt,
            request.hotwords,
        )
        cached = cache_key in cache
        failure_type: str | None = None
        if cached:
            returned = cache[cache_key]
        else:
            try:
                returned = backend.transcribe(audio_path, request, config)
            except Exception as error:
                if request.prompt_strategy == "unprompted":
                    raise
                returned = []
                failure_type = type(error).__name__
            else:
                cache[cache_key] = returned
        observations.extend(returned)
        initial_prompt = request.initial_prompt or request.prompt
        diagnostics.append(
            {
                "kind": request.kind,
                "start": request.start,
                "end": request.end,
                "context_reset": request.context_reset,
                "prompt_strategy": request.prompt_strategy,
                "source_family": request.source_family,
                "independence_group": request.independence_group,
                "initial_prompt_token_count": (
                    0
                    if not initial_prompt
                    else _context_token_count(initial_prompt)
                ),
                "hotwords_token_count": (
                    0
                    if not request.hotwords
                    else _context_token_count(request.hotwords)
                ),
                "prompt_hotwords_mutually_exclusive": not (
                    initial_prompt and request.hotwords
                ),
                "context_loop_guard": True,
                "observations": len(returned),
                "cached": cached,
                "contextual_request_failed": failure_type is not None,
                "failure_type": failure_type,
            }
        )
    return observations, diagnostics


def _lyrics_supported_observations(
    observations: list[Observation],
    candidates: dict[int, list[Candidate]],
    config: AlignConfig,
) -> list[Observation]:
    supported_indexes: set[int] = set()
    for items in candidates.values():
        for candidate in items:
            if (
                candidate.similarity < config.anchor_similarity
                or not candidate.freeze_eligible
            ):
                continue
            supported_indexes.update(
                candidate.support_observation_indexes
                or tuple(
                    range(
                        candidate.obs_start_index,
                        candidate.obs_end_index + 1,
                    )
                )
            )
    return [
        observation
        for index, observation in enumerate(observations)
        if index in supported_indexes
    ]


def _semantic_no_singing_barriers(
    lyrics: list[LyricLine],
    anchors: dict[int, Candidate],
    config: AlignConfig,
) -> tuple[list[tuple[float, float]], list[dict[str, object]]]:
    intervals: list[tuple[float, float]] = []
    diagnostics: list[dict[str, object]] = []
    for left_line, right_line in zip(lyrics, lyrics[1:], strict=False):
        if right_line.index != left_line.index + 1:
            continue
        left = anchors.get(left_line.index)
        right = anchors.get(right_line.index)
        if left is None or right is None:
            continue
        if not left.freeze_eligible or not right.freeze_eligible:
            continue
        if (
            left.quality_score < config.consensus_min_quality
            or right.quality_score < config.consensus_min_quality
        ):
            continue
        gap = right.start - left.end
        if gap < config.hard_gap_seconds:
            continue
        intervals.append((left.end, right.start))
        diagnostics.append(
            {
                "left_lyric_line_index": left_line.index,
                "right_lyric_line_index": right_line.index,
                "start": left.end,
                "end": right.start,
                "duration": gap,
                "left_quality_score": left.quality_score,
                "right_quality_score": right.quality_score,
                "reason": "adjacent_high_quality_lyrics_leave_no_missing_line",
            }
        )
    return intervals, diagnostics

def _candidate_identity(candidate: Candidate) -> tuple[object, ...]:
    return (
        candidate.obs_start_index,
        candidate.obs_end_index,
        round(candidate.start, 6),
        round(candidate.end, 6),
        candidate.freeze_eligible,
        candidate.quality_reason,
    )


def _expand_unresolved_repetition_groups(
    strict_diagnostics: dict[str, object],
    ambiguous_line_indexes: set[int],
) -> tuple[set[int], list[dict[str, object]]]:
    expanded = set(ambiguous_line_indexes)
    public_groups: list[dict[str, object]] = []
    raw_groups = strict_diagnostics.get("repetition_resolution", [])
    if not isinstance(raw_groups, list):
        return expanded, public_groups
    for group_index, raw_group in enumerate(raw_groups):
        if not isinstance(raw_group, dict) or raw_group.get("resolved") is not False:
            continue
        raw_indexes = raw_group.get("lyric_line_indexes", [])
        if not isinstance(raw_indexes, list):
            continue
        group_indexes = sorted(
            {
                line_index
                for line_index in raw_indexes
                if isinstance(line_index, int)
                and not isinstance(line_index, bool)
            }
        )
        if not group_indexes:
            continue
        expanded.update(group_indexes)
        public_groups.append(
            {
                "group_id": f"repetition_resolution_{group_index}",
                "lyric_line_indexes": group_indexes,
                "reason": (
                    "unresolved_repetition_group_requires_group_demotion"
                ),
            }
        )
    return expanded, public_groups


def _candidate_has_unprompted_or_trusted_source(
    candidate: Candidate,
) -> bool:
    if "unprompted" in candidate.prompt_strategies:
        return True
    for source_family in candidate.source_families:
        normalized = source_family.casefold().replace("-", "_")
        if (
            normalized.startswith("trusted")
            or "vocal_stem" in normalized
            or "isolated_vocal" in normalized
        ):
            return True
    return False

_ROBUST_PROGRESS_RESIDUAL_SECONDS = 2.0


def _candidate_has_trusted_acoustic_source(
    candidate: Candidate,
) -> bool:
    return any(
        source_family.casefold().replace("-", "_").startswith("trusted")
        or "vocal_stem" in source_family.casefold().replace("-", "_")
        or "isolated_vocal" in source_family.casefold().replace("-", "_")
        for source_family in candidate.source_families
    )


def _usable_audio_progress(
    value: float,
    duration: float,
    hard_barriers: list[tuple[float, float]],
) -> tuple[float, float]:
    merged: list[tuple[float, float]] = []
    for raw_start, raw_end in sorted(hard_barriers):
        start = max(0.0, raw_start)
        end = min(duration, raw_end)
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (
                merged[-1][0],
                max(merged[-1][1], end),
            )
        else:
            merged.append((start, end))
    usable_span = max(
        1e-9,
        duration - sum(end - start for start, end in merged),
    )
    bounded = min(duration, max(0.0, value))
    blocked_before = sum(
        max(0.0, min(bounded, end) - start)
        for start, end in merged
        if bounded > start
    )
    return max(0.0, bounded - blocked_before), usable_span


def _progress_deviation_bucket(value: float) -> str:
    if value < 0.10:
        return "0.00-0.10"
    if value < 0.25:
        return "0.10-0.25"
    if value < 0.50:
        return "0.25-0.50"
    return "0.50-plus"


def _apply_progress_freeze_gate(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
    duration: float,
    hard_barriers: list[tuple[float, float]],
    config: AlignConfig,
    lattice_diagnostics: dict[str, object],
    *,
    normal_mix: bool,
) -> tuple[dict[int, list[Candidate]], dict[str, object]]:
    histogram = {
        "0.00-0.10": 0,
        "0.10-0.25": 0,
        "0.25-0.50": 0,
        "0.50-plus": 0,
    }
    base: dict[str, object] = {
        "enabled": normal_mix,
        "mode": (
            "trusted_vocal_exempt"
            if not normal_mix
            else "robust_prior_residual"
            if lattice_diagnostics.get("prior_valid_authoritative") is True
            else "generic_normalized_envelope"
        ),
        "considered_count": 0,
        "passed_count": 0,
        "demoted_count": 0,
        "trusted_source_exempt_count": 0,
        "robust_prior_gate_count": 0,
        "generic_envelope_gate_count": 0,
        "configured_max_progress_deviation": (
            config.max_progress_deviation
        ),
        "generic_envelope_relaxed": (
            config.max_progress_deviation > 0.20
        ),
        "progress_deviation_histogram": histogram,
    }
    if not normal_mix:
        return candidates, base

    weights = {
        line.index: max(1, len(line.normalized))
        for line in lyrics
    }
    total_weight = max(1, sum(weights.values()))
    progress_centers: dict[int, float] = {}
    cumulative = 0.0
    for line in lyrics:
        weight = weights[line.index]
        progress_centers[line.index] = (
            cumulative + weight / 2.0
        ) / total_weight
        cumulative += weight

    robust_prior = (
        lattice_diagnostics.get("prior_valid_authoritative") is True
        and lattice_diagnostics.get("prior_mode")
        == "robust_multi_hypothesis"
    )
    raw_rate = lattice_diagnostics.get("prior_rate")
    raw_intercept = lattice_diagnostics.get("prior_intercept")
    rate = (
        float(raw_rate)
        if isinstance(raw_rate, (int, float))
        and not isinstance(raw_rate, bool)
        else 0.0
    )
    intercept = (
        float(raw_intercept)
        if isinstance(raw_intercept, (int, float))
        and not isinstance(raw_intercept, bool)
        else 0.0
    )
    progress_starts: dict[int, float] = {}
    cumulative = 0.0
    for line in lyrics:
        progress_starts[line.index] = cumulative
        cumulative += weights[line.index]

    updated: dict[int, list[Candidate]] = {}
    considered_count = 0
    passed_count = 0
    demoted_count = 0
    trusted_count = 0
    robust_count = 0
    generic_count = 0
    for line in lyrics:
        line_items: list[Candidate] = []
        for candidate in candidates.get(line.index, []):
            if not candidate.freeze_eligible:
                line_items.append(candidate)
                continue
            considered_count += 1
            if _candidate_has_trusted_acoustic_source(candidate):
                trusted_count += 1
                passed_count += 1
                line_items.append(candidate)
                continue
            center = (candidate.start + candidate.end) / 2.0
            usable_position, usable_span = _usable_audio_progress(
                center,
                duration,
                hard_barriers,
            )
            if robust_prior:
                robust_count += 1
                residual = abs(
                    candidate.start
                    - (
                        intercept
                        + rate * progress_starts[line.index]
                    )
                )
                passed = residual <= _ROBUST_PROGRESS_RESIDUAL_SECONDS
                normalized_deviation = residual / usable_span
            else:
                generic_count += 1
                audio_progress = usable_position / usable_span
                normalized_deviation = abs(
                    audio_progress - progress_centers[line.index]
                )
                passed = (
                    normalized_deviation
                    <= config.max_progress_deviation
                )
            histogram[
                _progress_deviation_bucket(normalized_deviation)
            ] += 1
            if passed:
                passed_count += 1
                line_items.append(candidate)
            else:
                demoted_count += 1
                line_items.append(
                    replace(
                        candidate,
                        freeze_eligible=False,
                        quality_reason="absolute_progress_outlier",
                        provenance=tuple(
                            dict.fromkeys(
                                (
                                    *candidate.provenance,
                                    "absolute-progress-outlier",
                                )
                            )
                        ),
                    )
                )
        updated[line.index] = line_items
    base.update(
        {
            "considered_count": considered_count,
            "passed_count": passed_count,
            "demoted_count": demoted_count,
            "trusted_source_exempt_count": trusted_count,
            "robust_prior_gate_count": robust_count,
            "generic_envelope_gate_count": generic_count,
        }
    )
    return updated, base


def _apply_lattice_freeze_consistency(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
    selected: dict[int, Candidate],
    config: AlignConfig,
) -> tuple[dict[int, list[Candidate]], int]:
    result: dict[int, list[Candidate]] = {}
    demoted_count = 0
    normalized_counts: dict[str, int] = {}
    for line in lyrics:
        normalized_counts[line.normalized] = (
            normalized_counts.get(line.normalized, 0) + 1
        )
    repeated_indexes = {
        line.index
        for line in lyrics
        if normalized_counts[line.normalized] > 1
    }
    for line_index, items in candidates.items():
        path_candidate = selected.get(line_index)
        updated: list[Candidate] = []
        for candidate in items:
            conflicts = (
                path_candidate is not None
                and line_index not in repeated_indexes
                and candidate.freeze_eligible
                and not _candidate_has_unprompted_or_trusted_source(
                    candidate
                )
                and _candidate_has_unprompted_or_trusted_source(
                    path_candidate
                )
                and abs(candidate.start - path_candidate.start)
                > config.consensus_cluster_seconds
            )
            if conflicts:
                candidate = replace(
                    candidate,
                    freeze_eligible=False,
                    quality_reason="global_lattice_path_conflict",
                )
                demoted_count += 1
            updated.append(candidate)
        result[line_index] = updated
    return result, demoted_count

def _separate_fallback_candidates(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
    config: AlignConfig,
    *,
    ambiguous_line_indexes: set[int],
    ambiguous_line_reasons: dict[int, str] | None = None,
    preferred_local_hints: dict[int, Candidate] | None = None,
) -> tuple[dict[int, Candidate], dict[int, Candidate], dict[str, object]]:
    strong_before_demotion, strong_dp = select_anchors(
        lyrics,
        candidates,
        config,
        strict_ambiguity=False,
        require_freeze_eligible=True,
    )
    locally_demoted = sorted(
        line_index
        for line_index in ambiguous_line_indexes
        if line_index in strong_before_demotion
    )
    effective_demotion_reasons = {
        line_index: (
            ambiguous_line_reasons or {}
        ).get(line_index, "strong_local_ambiguity")
        for line_index in locally_demoted
    }
    strong = {
        line_index: candidate
        for line_index, candidate in strong_before_demotion.items()
        if line_index not in ambiguous_line_indexes
    }

    overwrite_prevented = sorted(
        line_index
        for line_index, strong_candidate in strong.items()
        if any(
            not candidate.freeze_eligible
            and candidate.score > strong_candidate.score
            and _candidate_identity(candidate)
            != _candidate_identity(strong_candidate)
            for candidate in candidates[line_index]
        )
    )
    weak_search_candidates = {
        line.index: (
            [strong[line.index]]
            if line.index in strong
            else candidates[line.index]
        )
        for line in lyrics
    }
    relaxed, weak_dp = select_anchors(
        lyrics,
        weak_search_candidates,
        config,
        strict_ambiguity=False,
        require_freeze_eligible=False,
    )
    weak_hints = {
        line_index: candidate
        for line_index, candidate in relaxed.items()
        if line_index not in strong
    }
    for line_index in locally_demoted:
        candidate = weak_hints.get(line_index)
        if candidate is not None:
            weak_hints[line_index] = replace(
                candidate,
                freeze_eligible=False,
                quality_reason=effective_demotion_reasons[line_index],
            )
    lattice_hint_count = 0
    for line_index, candidate in (preferred_local_hints or {}).items():
        if line_index in strong:
            continue
        if candidate.lattice_remote_disagreement:
            lattice_reason = (
                "global_lattice_authoritative_local_remote_disagreement"
            )
        elif candidate.lattice_path_confidence < 0.60:
            lattice_reason = (
                "global_lattice_authoritative_local_low_agreement"
            )
        else:
            lattice_reason = "global_lattice_authoritative_local"
        weak_hints[line_index] = replace(
            candidate,
            freeze_eligible=False,
            quality_reason=lattice_reason,
        )
        lattice_hint_count += 1
    diagnostics: dict[str, object] = {
        "strong_path_selected_count_before_local_demotion": len(
            strong_before_demotion
        ),
        "strong_selected_count": len(strong),
        "strong_selected_line_indexes": sorted(strong),
        "strong_local_ambiguity_demoted_count": len(locally_demoted),
        "strong_local_ambiguity_demoted_line_indexes": locally_demoted,
        "strong_ambiguity_demotion_reasons": [
            {
                "lyric_line_index": line_index,
                "reason": effective_demotion_reasons[line_index],
            }
            for line_index in locally_demoted
        ],
        "weak_hint_count": len(weak_hints),
        "global_lattice_local_hint_count": lattice_hint_count,
        "weak_hint_line_indexes": sorted(weak_hints),
        "strong_overwrite_prevented_count": len(overwrite_prevented),
        "strong_overwrite_prevented_line_indexes": overwrite_prevented,
        "strong_overwrite_prevention_reason": (
            "strong_anchor_preserved_over_relaxed_candidate"
        ),
        "strong_selection": strong_dp,
        "weak_selection": weak_dp,
    }
    return strong, weak_hints, diagnostics


def _subtract_intervals(
    intervals: list[tuple[float, float]],
    allowed: list[tuple[float, float]],
    tolerance: float,
) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    for start, end in intervals:
        pieces = [(start, end)]
        for allowed_start, allowed_end in allowed:
            next_pieces: list[tuple[float, float]] = []
            for left, right in pieces:
                if allowed_end <= left or allowed_start >= right:
                    next_pieces.append((left, right))
                    continue
                if allowed_start - left > tolerance:
                    next_pieces.append((left, allowed_start))
                if right - allowed_end > tolerance:
                    next_pieces.append((allowed_end, right))
            pieces = next_pieces
        result.extend(pieces)
    return result


def _guard_confirmed_acoustic_silences(
    duration: float,
    confirmed_silences: list[tuple[float, float]],
    missing_line_count: int,
    config: AlignConfig,
) -> tuple[
    list[tuple[float, float]],
    list[tuple[float, float]],
    list[dict[str, object]],
]:
    hard = sorted(confirmed_silences)
    softened: list[tuple[float, float]] = []
    diagnostics: list[dict[str, object]] = []
    required_capacity = missing_line_count * config.min_line_seconds
    while hard and missing_line_count:
        safe = _subtract_intervals(
            [(0.0, duration)],
            hard,
            0.0,
        )
        capacities = [end - start for start, end in safe]
        safe_capacity = sum(capacities)
        maximum_component = max(capacities, default=0.0)
        fragmented = (
            len(capacities) > max(3, missing_line_count * 3)
            and safe_capacity > 0
            and maximum_component / safe_capacity < 0.34
        )
        reason: str | None = None
        if safe_capacity + 1e-12 < required_capacity:
            reason = "missing_line_capacity_shortfall"
        elif maximum_component + 1e-12 < config.min_line_seconds:
            reason = "no_component_fits_one_minimum_line"
        elif fragmented:
            reason = "extreme_safe_component_fragmentation"
        if reason is None:
            break
        demoted = max(
            hard,
            key=lambda interval: (
                interval[1] - interval[0],
                -interval[0],
            ),
        )
        hard.remove(demoted)
        softened.append(demoted)
        diagnostics.append(
            {
                "start": demoted[0],
                "end": demoted[1],
                "provenance": "confirmed_acoustic_silence",
                "hard": False,
                "reason": reason,
            }
        )
    return sorted(hard), sorted(softened), diagnostics


def _score_candidates_with_boundary_support(
    candidates: dict[int, list[Candidate]],
    components: list[tuple[float, float]],
    config: AlignConfig,
) -> dict[int, list[Candidate]]:
    rescored: dict[int, list[Candidate]] = {}
    for line_index, items in candidates.items():
        rescored[line_index] = []
        for candidate in items:
            effective = candidate
            if candidate.boundary_support in {"segment", "line"}:
                contained_words = [
                    other
                    for other in items
                    if other.boundary_support == "word"
                    and other.start
                    >= candidate.start - config.forbidden_tolerance_seconds
                    and other.end
                    <= candidate.end + config.forbidden_tolerance_seconds
                    and abs(other.similarity - candidate.similarity) <= 0.12
                ]
                if contained_words:
                    closest_word = max(
                        contained_words,
                        key=lambda item: item.similarity,
                    )
                    expansion = max(0.0, closest_word.start - candidate.start) + max(
                        0.0,
                        candidate.end - closest_word.end,
                    )
                    required = max(
                        0.10,
                        config.forbidden_tolerance_seconds * 4,
                    )
                    if expansion < required:
                        effective = replace(candidate, boundary_support="unknown")
            bonus = 0.0
            if effective.boundary_support in {"segment", "line"}:
                # Larger than the ambiguity margin: a full segment/line boundary
                # should beat an otherwise identical word-only hypothesis.
                bonus += config.ambiguity_score_margin + 0.25
            center = (effective.start + effective.end) / 2
            for component_start, component_end in components:
                if not component_start <= center <= component_end:
                    continue
                support_duration = component_end - component_start
                if (
                    support_duration <= config.max_line_seconds
                    and effective.start - component_start
                    <= config.adaptive_boundary_seconds
                    + config.forbidden_tolerance_seconds
                    and component_end - effective.end
                    <= config.adaptive_boundary_seconds
                    + config.forbidden_tolerance_seconds
                ):
                    bonus += config.ambiguity_score_margin + 0.35
                break
            rescored[line_index].append(
                replace(effective, score=effective.score + bonus)
            )
    return rescored


def _expand_anchors_with_trusted_activity(
    anchors: dict[int, Candidate],
    features: AudioFeatures,
    components: list[tuple[float, float]],
    config: AlignConfig,
) -> tuple[dict[int, Candidate], dict[int, dict[str, object]]]:
    diagnostics: dict[int, dict[str, object]] = {}
    for index, candidate in anchors.items():
        model_supported = candidate.boundary_support in {"segment", "line"}
        diagnostics[index] = {
            "trusted_activity_supported": False,
            "model_boundary_supported": model_supported,
            "model_boundary_kind": candidate.boundary_support,
            "reason": (
                "stt_segment_boundary_without_acoustic_support"
                if model_supported
                else "word_timestamp_only"
            ),
        }
    if not features.trusted_vocal or not components:
        return anchors, diagnostics
    grouped: dict[int, list[tuple[int, Candidate]]] = {}
    for line_index, candidate in anchors.items():
        center = (candidate.start + candidate.end) / 2
        for component_index, (start, end) in enumerate(components):
            if (
                start - config.forbidden_tolerance_seconds
                <= center
                <= end + config.forbidden_tolerance_seconds
            ):
                grouped.setdefault(component_index, []).append((line_index, candidate))
                break
    adjusted = dict(anchors)
    for component_index, group in grouped.items():
        component_start, component_end = components[component_index]
        ordered = sorted(group, key=lambda item: item[1].start)
        splits: list[float] = []
        for (_, left), (_, right) in zip(ordered, ordered[1:], strict=False):
            search_start = min(left.end, right.start)
            search_end = max(left.end, right.start)
            if search_end - search_start >= 0.04:
                split = features.minimum_envelope_time(search_start, search_end)
            else:
                split = ((left.start + left.end) + (right.start + right.end)) / 4
            splits.append(split)
        boundaries = [component_start, *splits, component_end]
        for position, (line_index, candidate) in enumerate(ordered):
            desired_start = min(candidate.start, boundaries[position])
            desired_end = max(candidate.end, boundaries[position + 1])
            new_start = max(
                desired_start,
                candidate.start - config.adaptive_boundary_seconds,
            )
            new_end = min(
                desired_end,
                candidate.end + config.adaptive_boundary_seconds,
            )
            full_support = (
                abs(new_start - desired_start) <= config.forbidden_tolerance_seconds
                and abs(new_end - desired_end) <= config.forbidden_tolerance_seconds
            )
            if new_end - new_start > config.max_line_seconds:
                diagnostics[line_index] = {
                    "trusted_activity_supported": False,
                    "model_boundary_supported": candidate.boundary_support
                    in {"segment", "line"},
                    "model_boundary_kind": candidate.boundary_support,
                    "reason": "activity_component_exceeds_max_line_seconds",
                    "component": [component_start, component_end],
                }
                continue
            adjusted[line_index] = replace(
                candidate,
                start=new_start,
                end=new_end,
                confidence=(
                    candidate.confidence
                    if full_support
                    else candidate.confidence * config.word_boundary_confidence_scale
                ),
                provenance=tuple(
                    dict.fromkeys([*candidate.provenance, "trusted-vocal-activity"])
                ),
            )
            diagnostics[line_index] = {
                "trusted_activity_supported": full_support,
                "model_boundary_supported": candidate.boundary_support
                in {"segment", "line"},
                "model_boundary_kind": candidate.boundary_support,
                "reason": (
                    "connected_activity_and_pause_boundaries"
                    if full_support
                    else "activity_extension_limited"
                ),
                "component": [component_start, component_end],
                "word_boundary": [candidate.start, candidate.end],
                "supported_boundary": [new_start, new_end],
                "start_extension": candidate.start - new_start,
                "end_extension": new_end - candidate.end,
            }
    return adjusted, diagnostics


def _refine_aligned_boundaries(
    result_lines: list[AlignedLine],
    features: AudioFeatures,
    config: AlignConfig,
    forbidden: list[tuple[float, float]],
) -> None:
    for index, line in enumerate(result_lines):
        if not line.diagnostics.get("anchored"):
            line.diagnostics["acoustic_refinement"] = {"method": "none_interpolated"}
            continue
        proposed_start, start_diagnostic = refine_boundary(
            features,
            line.start,
            role="start",
            radius=config.boundary_search_seconds,
        )
        proposed_end, end_diagnostic = refine_boundary(
            features,
            line.end,
            role="end",
            radius=config.boundary_search_seconds,
        )
        lower = result_lines[index - 1].end if index else 0.0
        upper = (
            result_lines[index + 1].start
            if index + 1 < len(result_lines)
            else features.duration
        )
        start = max(lower, proposed_start)
        end = min(upper, proposed_end)
        if start + config.min_line_seconds <= end:
            old_start, old_end = line.start, line.end
            line.start, line.end = start, end
            try:
                validate_alignment(
                    result_lines,
                    features.duration,
                    forbidden,
                    config,
                )
            except Exception:
                line.start, line.end = old_start, old_end
                start_diagnostic = {"method": "rejected_by_invariants", "shift": 0.0}
                end_diagnostic = {"method": "rejected_by_invariants", "shift": 0.0}
        else:
            start_diagnostic = {"method": "rejected_by_invariants", "shift": 0.0}
            end_diagnostic = {"method": "rejected_by_invariants", "shift": 0.0}
        line.diagnostics["acoustic_refinement"] = {
            "start": start_diagnostic,
            "end": end_diagnostic,
            "trusted_vocal_stem": features.trusted_vocal,
        }


def align_lyrics(
    audio_path: str | Path,
    lyrics: list[LyricLine],
    backend: Backend,
    *,
    config: AlignConfig | None = None,
    vocal_stem_path: str | Path | None = None,
) -> AlignmentResult:
    settings = config or AlignConfig()
    settings.validate()
    mixture_features = load_audio_features(
        audio_path,
        trusted_vocal=settings.input_audio_is_vocal_only,
    )
    if mixture_features.duration <= 0:
        raise ValueError("audio has zero duration")
    acoustic_features = mixture_features
    transcription_path = audio_path
    if vocal_stem_path is not None:
        stem_features = load_audio_features(vocal_stem_path, trusted_vocal=True)
        if abs(stem_features.duration - mixture_features.duration) > 0.25:
            raise ValueError("vocal stem duration differs from the mixture by more than 0.25 s")
        acoustic_features = stem_features
        if settings.use_vocal_stem_for_stt:
            transcription_path = vocal_stem_path

    initial_requests = _window_requests(
        mixture_features.duration,
        settings,
        lyrics,
    )
    initial, request_diagnostics = _run_requests(
        backend,
        transcription_path,
        initial_requests,
        settings,
    )
    cleaned_initial, rejected_initial = clean_observations(initial, lyrics)
    activity_components = acoustic_features.activity_components(
        bridge=settings.activity_bridge_seconds,
        minimum=settings.activity_min_seconds,
        boundary_padding=False,
    )
    confirmed_silences = acoustic_features.confirmed_silences(
        settings.hard_gap_seconds,
        bridge=settings.activity_bridge_seconds,
        activity_minimum=settings.activity_min_seconds,
    )
    retries, retry_diagnostics = _run_requests(
        backend,
        transcription_path,
        _retry_requests(
            mixture_features.duration,
            cleaned_initial,
            lyrics,
            confirmed_silences,
            settings,
            contextual_used=sum(
                request.prompt_strategy != "unprompted"
                for request in initial_requests
            ),
        ),
        settings,
    )
    cleaned, rejected = clean_observations([*initial, *retries], lyrics)
    raw_candidates = build_candidates(
        lyrics,
        cleaned,
        settings,
        confirmed_silences,
    )
    raw_candidates = _score_candidates_with_boundary_support(
        raw_candidates,
        activity_components,
        settings,
    )
    candidates, consensus_diagnostics = build_candidate_consensus(
        lyrics,
        raw_candidates,
        settings,
        normal_mix=not acoustic_features.trusted_vocal,
    )
    lattice_hard_barriers, _, _ = _guard_confirmed_acoustic_silences(
        mixture_features.duration,
        confirmed_silences,
        len(lyrics),
        settings,
    )
    lattice_selected, lattice_diagnostics = select_global_lattice(
        lyrics,
        candidates,
        mixture_features.duration,
        lattice_hard_barriers,
        settings,
    )
    candidates, progress_freeze_diagnostics = (
        _apply_progress_freeze_gate(
            lyrics,
            candidates,
            mixture_features.duration,
            lattice_hard_barriers,
            settings,
            lattice_diagnostics,
            normal_mix=not acoustic_features.trusted_vocal,
        )
    )
    lattice_diagnostics["progress_freeze_gate"] = (
        progress_freeze_diagnostics
    )
    consensus_diagnostics["progress_freeze_gate"] = (
        progress_freeze_diagnostics
    )
    candidates, lattice_conflict_demoted_count = (
        _apply_lattice_freeze_consistency(
            lyrics,
            candidates,
            lattice_selected,
            settings,
        )
    )
    lattice_diagnostics["conflicting_freeze_demoted_count"] = (
        lattice_conflict_demoted_count
    )
    lattice_provisional_count = sum(
        not any(
            candidate.freeze_eligible
            and abs(candidate.start - selected.start)
            <= settings.consensus_cluster_seconds
            for candidate in candidates[line_index]
        )
        for line_index, selected in lattice_selected.items()
    )
    lattice_diagnostics["local_provisional_count"] = (
        lattice_provisional_count
    )
    lattice_diagnostics["injected_count"] = 0
    lattice_diagnostics["overridden_by_strong_count"] = (
        len(lattice_selected) - lattice_provisional_count
    )
    supported_observations = _lyrics_supported_observations(
        cleaned,
        candidates,
        settings,
    )

    # Only observations that contribute to a sufficiently lyric-matched candidate
    # can close a recognition gap. Unrelated STT text cannot create a fake island.
    raw_evidence_gaps = recognition_gaps(
        supported_observations,
        settings.hard_gap_seconds,
    )
    recognition_only_gaps = _subtract_intervals(
        raw_evidence_gaps,
        activity_components,
        settings.forbidden_tolerance_seconds,
    )
    all_request_diagnostics = [*request_diagnostics, *retry_diagnostics]
    fallback_diagnostics: dict[str, object] | None = None
    semantic_barriers: list[tuple[float, float]] = []
    semantic_barrier_diagnostics: list[dict[str, object]] = []
    hard_acoustic_silences: list[tuple[float, float]] = []
    softened_acoustic_silences: list[tuple[float, float]] = []
    acoustic_capacity_guard_diagnostics: list[dict[str, object]] = []
    active_forbidden: list[tuple[float, float]] = []
    anchors: dict[int, Candidate] = {}
    try:
        anchors, dp_diagnostics = select_anchors(lyrics, candidates, settings)
        if lattice_provisional_count and anchors:
            raise AlignmentError(
                "global lattice selected local provisional candidates",
                code="global_lattice_requires_provisional_completion",
                diagnostics={
                    "global_lattice": lattice_diagnostics,
                    "affected_lyric_line_indexes": [],
                },
            )
        (
            hard_acoustic_silences,
            softened_acoustic_silences,
            acoustic_capacity_guard_diagnostics,
        ) = _guard_confirmed_acoustic_silences(
            mixture_features.duration,
            confirmed_silences,
            len(lyrics) - len(anchors),
            settings,
        )
        anchors, boundary_diagnostics = _expand_anchors_with_trusted_activity(
            anchors,
            acoustic_features,
            activity_components,
            settings,
        )
        semantic_barriers, semantic_barrier_diagnostics = (
            _semantic_no_singing_barriers(lyrics, anchors, settings)
        )
        active_forbidden = sorted(
            [*hard_acoustic_silences, *semantic_barriers]
        )
        aligned = materialize_lines(
            lyrics,
            anchors,
            mixture_features.duration,
            active_forbidden,
            activity_components,
            settings,
            boundary_diagnostics,
        )
        _refine_aligned_boundaries(
            aligned,
            acoustic_features,
            settings,
            active_forbidden,
        )
        validate_alignment(
            aligned,
            mixture_features.duration,
            active_forbidden,
            settings,
        )
    except AlignmentError as error:
        error.add_diagnostics(
            stt_request_count=sum(
                not bool(item["cached"]) for item in all_request_diagnostics
            ),
            stt_requests=all_request_diagnostics,
            raw_observation_count=len(initial) + len(retries),
            clean_observation_count=len(cleaned),
        )
        raw_ambiguous_lines = error.diagnostics.get(
            "affected_lyric_line_indexes",
            [],
        )
        ambiguous_lines = {
            line_index
            for line_index in raw_ambiguous_lines
            if isinstance(line_index, int)
        } if isinstance(raw_ambiguous_lines, list) else set()
        ambiguous_lines, repetition_group_demotions = (
            _expand_unresolved_repetition_groups(
                error.diagnostics,
                ambiguous_lines,
            )
        )
        ambiguous_line_reasons = {
            line_index: "strong_local_ambiguity"
            for line_index in ambiguous_lines
        }
        for group in repetition_group_demotions:
            group_indexes = group.get("lyric_line_indexes", [])
            if not isinstance(group_indexes, list):
                continue
            for line_index in group_indexes:
                if isinstance(line_index, int):
                    ambiguous_line_reasons[line_index] = (
                        "unresolved_repetition_group"
                    )
        anchors, weak_hints, separation_diagnostics = (
            _separate_fallback_candidates(
                lyrics,
                candidates,
                settings,
                ambiguous_line_indexes=ambiguous_lines,
                ambiguous_line_reasons=ambiguous_line_reasons,
                preferred_local_hints=lattice_selected,
            )
        )
        separation_diagnostics[
            "unresolved_repetition_group_demotions"
        ] = repetition_group_demotions
        injected_value = separation_diagnostics.get(
            "global_lattice_local_hint_count",
            0,
        )
        lattice_diagnostics["injected_count"] = (
            injected_value if isinstance(injected_value, int) else 0
        )
        lattice_diagnostics["overridden_by_strong_count"] = len(
            set(lattice_selected) & set(anchors)
        )
        (
            hard_acoustic_silences,
            softened_acoustic_silences,
            acoustic_capacity_guard_diagnostics,
        ) = _guard_confirmed_acoustic_silences(
            mixture_features.duration,
            confirmed_silences,
            len(lyrics) - len(anchors),
            settings,
        )
        anchors, boundary_diagnostics = _expand_anchors_with_trusted_activity(
            anchors,
            acoustic_features,
            activity_components,
            settings,
        )
        semantic_barriers, semantic_barrier_diagnostics = (
            _semantic_no_singing_barriers(lyrics, anchors, settings)
        )
        active_forbidden = sorted(
            [*hard_acoustic_silences, *semantic_barriers]
        )
        fallback = build_fallback_alignment(
            lyrics,
            anchors,
            mixture_features.duration,
            active_forbidden,
            activity_components,
            settings,
            weak_hints=weak_hints,
            reason=error.code,
            soft_intervals=recognition_only_gaps,
        )
        dp_diagnostics = separation_diagnostics
        aligned = fallback.lines
        strict_diagnostics = error.diagnostics
        fallback_diagnostics = {
            "stage": fallback.stage,
            **fallback.diagnostics,
            "mixture_stt_only": not acoustic_features.trusted_vocal,
            "trusted_activity_absent": not activity_components,
            "recognition_only_soft_gap_count": len(
                recognition_only_gaps
            ),
            "reason_codes": [
                error.code,
                fallback.diagnostics["reason_code"],
            ],
            "stt_request_count": strict_diagnostics.get("stt_request_count", 0),
            "strict_score_margin": strict_diagnostics.get("score_margin"),
            "competing_candidate_times": strict_diagnostics.get(
                "competing_candidates"
            ),
            "competing_paths": {
                "best": strict_diagnostics.get("best_path"),
                "alternative": strict_diagnostics.get("competing_path"),
            },
            "candidate_separation": separation_diagnostics,
            "strong_overwrite_prevention_reason": separation_diagnostics[
                "strong_overwrite_prevention_reason"
            ],
            "strict_failure": {
                "code": error.code,
                "message": str(error),
                "diagnostics": strict_diagnostics,
            },
        }
    lattice_actual_used_count = sum(
        "fallback_global_lattice_local_used" in line.provenance
        for line in aligned
    )
    lattice_remote_actual_used_count = sum(
        "fallback_lattice_remote_path_disagreement" in line.provenance
        for line in aligned
    )
    lattice_diagnostics["actual_used_count"] = (
        lattice_actual_used_count
    )
    lattice_diagnostics["remote_disagreement_actual_used_count"] = (
        lattice_remote_actual_used_count
    )
    lattice_diagnostics["lineage_counts"] = {
        "accepted": lattice_diagnostics.get(
            "accepted_selected_count",
            0,
        ),
        "injected": lattice_diagnostics.get("injected_count", 0),
        "rejected": lattice_diagnostics.get(
            "rejected_selected_count",
            0,
        ),
        "overridden": lattice_diagnostics.get(
            "overridden_by_strong_count",
            0,
        ),
        "actual_used": lattice_actual_used_count,
    }
    return AlignmentResult(
        lines=aligned,
        duration=mixture_features.duration,
        diagnostics={
            "backend_requests": all_request_diagnostics,
            "observation_count_raw": len(initial) + len(retries),
            "observation_count_clean": len(cleaned),
            "lyric_supported_observation_count": len(supported_observations),
            "candidate_consensus": consensus_diagnostics,
            "global_candidate_lattice": lattice_diagnostics,
            "rejected_observations": [*rejected_initial, *rejected],
            "confirmed_vocal_stem_silences": confirmed_silences,
            "confirmed_trusted_vocal_silences": confirmed_silences,
            "trusted_vocal_activity_components": activity_components,
            "raw_post_retry_observation_gaps": raw_evidence_gaps,
            "post_retry_recognition_gaps": recognition_only_gaps,
            "recognition_only_soft_gaps": recognition_only_gaps,
            "hard_forbidden_intervals": active_forbidden,
            "forbidden_interval_provenance": [
                *[
                    {
                        "start": start,
                        "end": end,
                        "provenance": "confirmed_acoustic_silence",
                        "hard": True,
                        "reason": "independent_trusted_vocal_evidence",
                    }
                    for start, end in hard_acoustic_silences
                ],
                *acoustic_capacity_guard_diagnostics,
                *[
                    {
                        "start": start,
                        "end": end,
                        "provenance": "recognition_only_gap",
                        "hard": False,
                        "reason": "no_independent_acoustic_evidence",
                    }
                    for start, end in recognition_only_gaps
                ],
                *[
                    {
                        "start": start,
                        "end": end,
                        "provenance": "semantic_barrier",
                        "hard": True,
                        "reason": (
                            "adjacent_high_quality_frozen_lyrics"
                        ),
                    }
                    for start, end in semantic_barriers
                ],
            ],
            "softened_confirmed_acoustic_silences": (
                softened_acoustic_silences
            ),
            "semantic_no_singing_barriers": semantic_barriers,
            "semantic_barrier_diagnostics": semantic_barrier_diagnostics,
            "used_vocal_stem_for_stt": transcription_path != audio_path,
            "acoustic_role": (
                "trusted_isolated_vocal_envelope"
                if acoustic_features.trusted_vocal
                else "mixture_boundary_cue_only"
            ),
            "alignment": dp_diagnostics,
            "fallback": fallback_diagnostics,
        },
    )

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass, replace

import numpy as np

from .config import AlignConfig
from .models import AlignedLine, BoundarySupport, Candidate, LyricLine, Observation
from .normalize import is_credit_hallucination, match_normalize

_BOUNDARY_SUPPORT_RANK = {"unknown": 0, "word": 1, "segment": 2, "line": 3}


class AlignmentError(RuntimeError):
    """Alignment failure with stable machine-readable context."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "alignment_error",
        diagnostics: dict[str, object] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.diagnostics: dict[str, object] = diagnostics or {}

    def add_diagnostics(self, **values: object) -> AlignmentError:
        for key, value in values.items():
            self.diagnostics.setdefault(key, value)
        return self


def edit_similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    if not left or not right:
        return 0.0
    previous = list(range(len(right) + 1))
    for row, left_char in enumerate(left, 1):
        current = [row]
        for column, right_char in enumerate(right, 1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + (left_char != right_char),
                )
            )
        previous = current
    return 1.0 - previous[-1] / max(len(left), len(right))


def clean_observations(
    observations: Iterable[Observation],
    lyrics: list[LyricLine],
) -> tuple[list[Observation], list[dict[str, object]]]:
    def rejection(
        observation: Observation,
        reason: str,
    ) -> dict[str, object]:
        return {
            "start": observation.start,
            "end": observation.end,
            "confidence": observation.confidence,
            "no_speech_probability": observation.no_speech_prob,
            "provenance": observation.provenance,
            "request_kind": observation.request_kind,
            "request_id": observation.request_id,
            "prompt_strategy": observation.prompt_strategy,
            "source_family": observation.source_family,
            "independence_group": observation.independence_group,
            "boundary_support": observation.boundary_support,
            "reason": reason,
        }

    rejected: list[dict[str, object]] = []
    usable: list[Observation] = []
    lyric_norms = [line.normalized for line in lyrics]
    for observation in observations:
        normalized = match_normalize(observation.text)
        if not normalized:
            continue
        best_lyric_match = max(edit_similarity(normalized, item) for item in lyric_norms)
        if is_credit_hallucination(observation.text) and best_lyric_match < 0.86:
            rejected.append(rejection(observation, "credit_hallucination"))
            continue
        if observation.no_speech_prob >= 0.92 and observation.confidence < 0.35:
            rejected.append(rejection(observation, "high_no_speech_probability"))
            continue
        if observation.end <= observation.start:
            rejected.append(rejection(observation, "invalid_time"))
            continue
        usable.append(observation)
    usable.sort(key=lambda item: (item.start, item.end, item.text))

    deduplicated: list[Observation] = []
    for observation in usable:
        normalized = match_normalize(observation.text)
        duplicate_index: int | None = None
        for index in range(max(0, len(deduplicated) - 12), len(deduplicated)):
            existing = deduplicated[index]
            if match_normalize(existing.text) != normalized:
                continue
            if {
                existing.boundary_support,
                observation.boundary_support,
            } == {"word", "segment"}:
                # These are intentionally distinct timing hypotheses.
                continue
            intersection = max(
                0.0, min(existing.end, observation.end) - max(existing.start, observation.start)
            )
            union = max(existing.end, observation.end) - min(existing.start, observation.start)
            if (union > 0 and intersection / union >= 0.45) or (
                abs(existing.start - observation.start) <= 0.09
                and abs(existing.end - observation.end) <= 0.09
            ):
                duplicate_index = index
                break
        if duplicate_index is None:
            deduplicated.append(observation)
            continue
        existing = deduplicated[duplicate_index]
        total_weight = max(0.01, existing.confidence) + max(0.01, observation.confidence)
        deduplicated[duplicate_index] = Observation(
            start=(
                existing.start * max(0.01, existing.confidence)
                + observation.start * max(0.01, observation.confidence)
            )
            / total_weight,
            end=(
                existing.end * max(0.01, existing.confidence)
                + observation.end * max(0.01, observation.confidence)
            )
            / total_weight,
            text=existing.text
            if existing.confidence >= observation.confidence
            else observation.text,
            confidence=max(existing.confidence, observation.confidence),
            no_speech_prob=min(existing.no_speech_prob, observation.no_speech_prob),
            provenance="|".join(
                dict.fromkeys([*existing.provenance.split("|"), observation.provenance])
            ),
            request_kind="|".join(
                dict.fromkeys(
                    [
                        *existing.request_kind.split("|"),
                        *observation.request_kind.split("|"),
                    ]
                )
            ),
            boundary_support=max(
                (existing.boundary_support, observation.boundary_support),
                key=lambda item: _BOUNDARY_SUPPORT_RANK[item],
            ),
            request_id="|".join(
                dict.fromkeys(
                    [
                        *existing.request_id.split("|"),
                        *observation.request_id.split("|"),
                    ]
                )
            ),
            prompt_strategy=existing.prompt_strategy,
            source_family=existing.source_family,
            independence_group=existing.independence_group,
            prompt_strategies=tuple(
                dict.fromkeys(
                    [
                        *(existing.prompt_strategies or (
                            existing.prompt_strategy,
                        )),
                        *(observation.prompt_strategies or (
                            observation.prompt_strategy,
                        )),
                    ]
                )
            ),
            source_families=tuple(
                dict.fromkeys(
                    [
                        *(existing.source_families or (
                            existing.source_family,
                        )),
                        *(observation.source_families or (
                            observation.source_family,
                        )),
                    ]
                )
            ),
            independence_groups=tuple(
                dict.fromkeys(
                    [
                        *(existing.independence_groups or (
                            existing.independence_group,
                        )),
                        *(observation.independence_groups or (
                            observation.independence_group,
                        )),
                    ]
                )
            ),
        )
    deduplicated.sort(key=lambda item: (item.start, item.end))
    return deduplicated, rejected


def _overlap_fraction(start: float, end: float, intervals: list[tuple[float, float]]) -> float:
    duration = max(1e-6, end - start)
    overlap = sum(max(0.0, min(end, right) - max(start, left)) for left, right in intervals)
    return min(1.0, overlap / duration)


def interval_intersects(
    start: float,
    end: float,
    intervals: list[tuple[float, float]],
    tolerance: float,
) -> bool:
    return any(
        min(end, right) - max(start, left) > tolerance
        for left, right in intervals
    )


def build_candidates(
    lyrics: list[LyricLine],
    observations: list[Observation],
    config: AlignConfig,
    forbidden: list[tuple[float, float]],
) -> dict[int, list[Candidate]]:
    result: dict[int, list[Candidate]] = {line.index: [] for line in lyrics}
    for line in lyrics:
        target = line.normalized
        for start_index in range(len(observations)):
            pieces: list[str] = []
            confidence_sum = 0.0
            provenance: list[str] = []
            for end_index in range(
                start_index,
                min(len(observations), start_index + config.max_observation_span),
            ):
                current = observations[end_index]
                if end_index > start_index:
                    previous = observations[end_index - 1]
                    if current.start - previous.end > config.hard_gap_seconds:
                        break
                pieces.append(match_normalize(current.text))
                confidence_sum += current.confidence * (1.0 - current.no_speech_prob)
                provenance.extend(current.provenance.split("|"))
                combined = "".join(pieces)
                similarity = edit_similarity(target, combined)
                # Exact containment remains useful when Whisper groups a short line with a neighbor,
                # but is deliberately discounted to avoid matching every repeated short phrase.
                if target in combined or combined in target:
                    coverage = min(len(target), len(combined)) / max(len(target), len(combined))
                    similarity = max(similarity, 0.55 + 0.45 * coverage)
                if len(target) <= 2 and target != combined:
                    similarity *= 0.72
                if similarity < config.min_similarity:
                    continue
                start = observations[start_index].start
                end = current.end
                if end - start > config.max_line_seconds:
                    continue
                if interval_intersects(
                    start,
                    end,
                    forbidden,
                    config.forbidden_tolerance_seconds,
                ):
                    continue
                confidence = confidence_sum / (end_index - start_index + 1)
                span = observations[start_index : end_index + 1]
                no_speech_probability = sum(
                    item.no_speech_prob for item in span
                ) / len(span)
                request_sets = [
                    {
                        request_id
                        for request_id in item.request_id.split("|")
                        if request_id
                    }
                    for item in span
                ]
                common_request_ids = set.intersection(*request_sets)
                request_ids = tuple(sorted(common_request_ids))
                independence_sets = [
                    {
                        group
                        for group in (
                            item.independence_groups
                            or (item.independence_group,)
                        )
                        if group != "unknown"
                    }
                    for item in span
                ]
                common_independence_groups = (
                    set.intersection(*independence_sets)
                    if all(independence_sets)
                    else set()
                )
                strategy_sets = [
                    set(
                        item.prompt_strategies
                        or (
                            (item.prompt_strategy,)
                            if item.independence_group != "unknown"
                            else ()
                        )
                    )
                    for item in span
                ]
                common_prompt_strategies = (
                    set.intersection(*strategy_sets)
                    if all(strategy_sets)
                    else set()
                )
                family_sets = [
                    {
                        family
                        for family in (
                            item.source_families
                            or (item.source_family,)
                        )
                        if family != "unknown"
                    }
                    for item in span
                ]
                common_source_families = (
                    set.intersection(*family_sets)
                    if all(family_sets)
                    else set()
                )
                support_observation_indexes = tuple(
                    range(start_index, end_index + 1)
                )
                length_ratio = max(1e-6, len(combined) / len(target))
                expected_duration = min(
                    config.max_line_seconds,
                    max(config.min_line_seconds, 0.22 * len(target)),
                )
                duration_ratio = max(
                    1e-6,
                    (end - start) / expected_duration,
                )
                model_support: BoundarySupport = "unknown"
                for item in span:
                    if item.boundary_support not in {"segment", "line"}:
                        continue
                    if (
                        item.start
                        <= start + config.forbidden_tolerance_seconds
                        and item.end
                        >= end - config.forbidden_tolerance_seconds
                        and edit_similarity(target, match_normalize(item.text))
                        >= config.anchor_similarity
                    ):
                        model_support = item.boundary_support
                        break
                if model_support == "unknown" and all(
                    item.boundary_support == "word" for item in span
                ):
                    model_support = "word"
                score = (
                    similarity * 5.0
                    + confidence * 1.4
                    - abs(math.log(length_ratio)) * 0.35
                    - min(0.35, abs(math.log(duration_ratio)) * 0.08)
                    - max(0, end_index - start_index - 2) * 0.08
                )
                result[line.index].append(
                    Candidate(
                        line_index=line.index,
                        obs_start_index=start_index,
                        obs_end_index=end_index,
                        start=start,
                        end=end,
                        similarity=similarity,
                        confidence=confidence,
                        score=score,
                        provenance=tuple(dict.fromkeys(provenance)),
                        boundary_support=model_support,
                        request_ids=request_ids,
                        support_observation_indexes=support_observation_indexes,
                        no_speech_prob=no_speech_probability,
                        independence_groups=tuple(
                            sorted(common_independence_groups)
                        ),
                        prompt_strategies=tuple(
                            sorted(common_prompt_strategies)
                        ),
                        source_families=tuple(
                            sorted(common_source_families)
                        ),
                        boundary_support_types=tuple(
                            sorted(
                                {
                                    item.boundary_support
                                    for item in span
                                }
                            )
                        ),
                    )
                )
        result[line.index].sort(key=lambda item: (item.obs_end_index, -item.score))
    return result


def _weighted_median(values: list[float], weights: list[float]) -> float:
    ordered = sorted(zip(values, weights, strict=True), key=lambda item: item[0])
    threshold = sum(weights) / 2
    cumulative = 0.0
    for value, weight in ordered:
        cumulative += weight
        if cumulative >= threshold:
            return value
    return ordered[-1][0]


def _candidate_independence_groups(
    candidate: Candidate,
) -> tuple[str, ...]:
    return (
        candidate.independence_groups
        or candidate.request_ids
        or ("unknown",)
    )


def _candidate_source_families(candidate: Candidate) -> tuple[str, ...]:
    if candidate.source_families:
        return candidate.source_families
    return tuple(
        f"legacy_request:{group}"
        for group in _candidate_independence_groups(candidate)
    )


def _trusted_source_family(source_family: str) -> bool:
    normalized = source_family.casefold().replace("-", "_")
    return (
        normalized.startswith("trusted")
        or "vocal_stem" in normalized
        or "isolated_vocal" in normalized
    )


def _candidate_has_unprompted_or_trusted_source(candidate: Candidate) -> bool:
    return (
        "unprompted" in candidate.prompt_strategies
        or any(
            _trusted_source_family(source_family)
            for source_family in _candidate_source_families(candidate)
        )
    )


def _consensus_candidate(
    line_index: int,
    cluster: list[Candidate],
    config: AlignConfig,
    *,
    normal_mix: bool,
) -> tuple[Candidate, dict[str, object]]:
    group_boundary_representatives: dict[
        tuple[str, BoundarySupport],
        Candidate,
    ] = {}
    for candidate in cluster:
        for independence_group in _candidate_independence_groups(candidate):
            key = (independence_group, candidate.boundary_support)
            current = group_boundary_representatives.get(key)
            if current is None or (
                candidate.similarity,
                _BOUNDARY_SUPPORT_RANK[candidate.boundary_support],
                -(candidate.end - candidate.start),
                candidate.score,
            ) > (
                current.similarity,
                _BOUNDARY_SUPPORT_RANK[current.boundary_support],
                -(current.end - current.start),
                current.score,
            ):
                group_boundary_representatives[key] = candidate

    # Prompt variants derived from the same source family are correlated.
    # Keep only one representative per family and boundary kind before
    # measuring independent support.
    family_boundary_representatives: dict[
        tuple[str, BoundarySupport],
        Candidate,
    ] = {}
    for (independence_group, _boundary), candidate in (
        group_boundary_representatives.items()
    ):
        source_families_for_cap = (
            _candidate_source_families(candidate)
            if config.require_segment_word_corroboration
            else (f"independent:{independence_group}",)
        )
        for source_family in source_families_for_cap:
            key = (source_family, candidate.boundary_support)
            current = family_boundary_representatives.get(key)
            if current is None or (
                candidate.similarity,
                candidate.quality_score,
                candidate.confidence,
                candidate.score,
            ) > (
                current.similarity,
                current.quality_score,
                current.confidence,
                current.score,
            ):
                family_boundary_representatives[key] = candidate

    representatives: dict[str, Candidate] = {}
    for (source_family, _boundary), candidate in (
        family_boundary_representatives.items()
    ):
        current = representatives.get(source_family)
        if current is None or (
            candidate.similarity,
            _BOUNDARY_SUPPORT_RANK[candidate.boundary_support],
            -(candidate.end - candidate.start),
            candidate.score,
        ) > (
            current.similarity,
            _BOUNDARY_SUPPORT_RANK[current.boundary_support],
            -(current.end - current.start),
            current.score,
        ):
            representatives[source_family] = candidate
    supported = list(representatives.values())
    boundary_evidence = list(family_boundary_representatives.values())
    weights = [
        max(
            1e-6,
            candidate.similarity
            * candidate.confidence
            * (1.0 - candidate.no_speech_prob)
            * (
                0.70
                + 0.10
                * _BOUNDARY_SUPPORT_RANK[candidate.boundary_support]
            ),
        )
        for candidate in supported
    ]
    starts = [candidate.start for candidate in supported]
    ends = [candidate.end for candidate in supported]
    centers = [
        (candidate.start + candidate.end) / 2
        for candidate in supported
    ]
    start = _weighted_median(starts, weights)
    end = _weighted_median(ends, weights)
    center = _weighted_median(centers, weights)
    dispersion = max(
        _weighted_median(
            [abs(value - center) for value in centers],
            weights,
        ),
        _weighted_median(
            [abs(value - start) for value in starts],
            weights,
        ),
        _weighted_median(
            [abs(value - end) for value in ends],
            weights,
        ),
    )
    weight_total = sum(weights)
    similarity = sum(
        candidate.similarity * weight
        for candidate, weight in zip(supported, weights, strict=True)
    ) / weight_total
    confidence = sum(
        candidate.confidence * weight
        for candidate, weight in zip(supported, weights, strict=True)
    ) / weight_total
    no_speech = sum(
        candidate.no_speech_prob * weight
        for candidate, weight in zip(supported, weights, strict=True)
    ) / weight_total
    boundary_support = max(
        (
            candidate.boundary_support
            for candidate in supported
        ),
        key=lambda value: _BOUNDARY_SUPPORT_RANK[value],
    )
    independence_groups = tuple(
        sorted(
            {
                group
                for candidate in supported
                for group in _candidate_independence_groups(candidate)
            }
        )
    )
    prompt_strategies = tuple(
        sorted(
            {
                strategy
                for candidate in supported
                for strategy in candidate.prompt_strategies
            }
        )
    )
    source_families = tuple(
        sorted(
            {
                family
                for candidate in supported
                for family in candidate.source_families
            }
        )
    )
    boundary_support_types = tuple(
        sorted(
            {
                support
                for candidate in boundary_evidence
                for support in (
                    candidate.boundary_support_types
                    or (candidate.boundary_support,)
                )
            }
        )
    )
    explicit_context_metadata = any(
        candidate.independence_groups
        or candidate.source_families
        for candidate in cluster
    )
    support_count = len(representatives)
    source_family_count = len(source_families)
    strategy_group_count = len(prompt_strategies)
    has_unprompted_or_trusted_source = any(
        _candidate_has_unprompted_or_trusted_source(candidate)
        for candidate in boundary_evidence
    )
    support_score = min(
        1.0,
        support_count / config.consensus_min_independent_support,
    )
    dispersion_score = max(
        0.0,
        1.0
        - dispersion / config.consensus_max_dispersion_seconds,
    )
    boundary_score = _BOUNDARY_SUPPORT_RANK[boundary_support] / 3
    quality = (
        0.28 * support_score
        + 0.17 * dispersion_score
        + 0.20 * similarity
        + 0.15 * confidence
        + 0.10 * (1.0 - no_speech)
        + 0.10 * boundary_score
    )

    segment_evidence = [
        candidate
        for candidate in boundary_evidence
        if candidate.boundary_support == "segment"
    ]
    word_evidence = [
        candidate
        for candidate in boundary_evidence
        if candidate.boundary_support == "word"
    ]
    segment_word_agreement = any(
        segment_group != word_group
        and any(
            segment_family != word_family
            for segment_family in _candidate_source_families(segment)
            for word_family in _candidate_source_families(word)
        )
        and (
            _candidate_has_unprompted_or_trusted_source(segment)
            or _candidate_has_unprompted_or_trusted_source(word)
        )
        and min(segment.end, word.end) > max(segment.start, word.start)
        and abs(
            (segment.start + segment.end) / 2
            - (word.start + word.end) / 2
        )
        <= config.segment_word_agreement_seconds
        for segment in segment_evidence
        for word in word_evidence
        for segment_group in _candidate_independence_groups(segment)
        for word_group in _candidate_independence_groups(word)
    )

    reason = "high_quality_temporal_consensus"
    freeze_eligible = True
    if end <= start:
        freeze_eligible = False
        reason = "invalid_consensus_duration"
    elif not (
        config.min_line_seconds
        <= end - start
        <= config.max_line_seconds
    ):
        freeze_eligible = False
        reason = "consensus_duration_outside_configured_bounds"
    elif dispersion > config.consensus_max_dispersion_seconds:
        freeze_eligible = False
        reason = "high_temporal_dispersion"
    elif no_speech >= 0.45:
        freeze_eligible = False
        reason = "high_no_speech_probability"
    elif similarity < config.anchor_similarity:
        freeze_eligible = False
        reason = "insufficient_text_similarity"
    elif (
        normal_mix
        and explicit_context_metadata
        and not has_unprompted_or_trusted_source
    ):
        freeze_eligible = False
        reason = "prompt_only_candidate_not_freeze_eligible"
    elif (
        normal_mix
        and boundary_support == "segment"
        and explicit_context_metadata
        and config.require_segment_word_corroboration
        and similarity < config.segment_freeze_min_similarity
    ):
        freeze_eligible = False
        reason = "segment_similarity_below_freeze_threshold"
    elif (
        normal_mix
        and boundary_support == "segment"
        and explicit_context_metadata
        and config.require_segment_word_corroboration
        and support_count
        < config.segment_freeze_min_independence_groups
    ):
        freeze_eligible = False
        reason = "segment_insufficient_decorrelated_support"
    elif (
        normal_mix
        and boundary_support == "segment"
        and explicit_context_metadata
        and config.require_segment_word_corroboration
        and strategy_group_count
        < config.segment_freeze_min_strategy_groups
    ):
        freeze_eligible = False
        reason = "segment_insufficient_strategy_diversity"
    elif (
        normal_mix
        and boundary_support == "segment"
        and explicit_context_metadata
        and config.require_segment_word_corroboration
        and not segment_word_agreement
    ):
        freeze_eligible = False
        reason = "segment_without_word_corroboration"
    elif quality < config.consensus_min_quality:
        freeze_eligible = False
        reason = "low_consensus_quality"
    elif normal_mix and boundary_support == "line":
        reason = "single_or_multi_pass_line_boundary"
    elif (
        normal_mix
        and support_count
        < config.consensus_min_independent_support
    ):
        freeze_eligible = False
        reason = "single_pass_generic_boundary_on_mixture"
    elif (
        normal_mix
        and boundary_support not in {"segment", "line"}
    ):
        freeze_eligible = False
        reason = "word_or_unknown_boundary_on_mixture"
    elif not normal_mix:
        reason = "trusted_vocal_candidate"
    provenance = tuple(
        dict.fromkeys(
            source
            for candidate in supported
            for source in candidate.provenance
        )
    )
    request_ids = tuple(
        sorted(
            {
                request_id
                for candidate in supported
                for request_id in candidate.request_ids
            }
        )
    )
    observation_indexes = tuple(
        sorted(
            {
                index
                for candidate in supported
                for index in (
                    candidate.support_observation_indexes
                    or tuple(
                        range(
                            candidate.obs_start_index,
                            candidate.obs_end_index + 1,
                        )
                    )
                )
            }
        )
    )
    consensus = Candidate(
        line_index=line_index,
        obs_start_index=min(observation_indexes),
        obs_end_index=max(observation_indexes),
        start=start,
        end=end,
        similarity=similarity,
        confidence=confidence,
        score=max(candidate.score for candidate in supported)
        + quality
        + 0.30 * math.log1p(support_count),
        provenance=provenance,
        boundary_support=boundary_support,
        request_ids=request_ids,
        support_observation_indexes=observation_indexes,
        no_speech_prob=no_speech,
        support_count=support_count,
        time_dispersion=dispersion,
        quality_score=quality,
        consensus=True,
        freeze_eligible=freeze_eligible,
        quality_reason=reason,
        independence_groups=independence_groups,
        prompt_strategies=prompt_strategies,
        source_families=source_families,
        boundary_support_types=boundary_support_types,
    )
    diagnostic = {
        "start": start,
        "end": end,
        "center": center,
        "support_count": support_count,
        "decorrelated_independence_group_count": support_count,
        "independence_groups": list(independence_groups),
        "strategy_group_count": strategy_group_count,
        "prompt_strategies": list(prompt_strategies),
        "source_family_count": source_family_count,
        "source_families": list(source_families),
        "has_unprompted_or_trusted_source": (
            has_unprompted_or_trusted_source
        ),
        "request_ids": list(request_ids),
        "dispersion_seconds": dispersion,
        "text_similarity": similarity,
        "confidence": confidence,
        "no_speech_probability": no_speech,
        "boundary_support": boundary_support,
        "boundary_support_types": list(boundary_support_types),
        "segment_word_agreement": segment_word_agreement,
        "quality_score": quality,
        "freeze_eligible": freeze_eligible,
        "quality_reason": reason,
    }
    return consensus, diagnostic


def build_candidate_consensus(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
    config: AlignConfig,
    *,
    normal_mix: bool,
) -> tuple[dict[int, list[Candidate]], dict[str, object]]:
    counts: dict[str, int] = {}
    for line in lyrics:
        counts[line.normalized] = counts.get(line.normalized, 0) + 1
    result: dict[int, list[Candidate]] = {}
    diagnostics: dict[str, object] = {}
    for line in lyrics:
        ordered = sorted(
            candidates[line.index],
            key=lambda candidate: (
                (candidate.start + candidate.end) / 2,
                candidate.start,
            ),
        )
        clusters: list[list[Candidate]] = []
        for candidate in ordered:
            center = (candidate.start + candidate.end) / 2
            if not clusters:
                clusters.append([candidate])
                continue
            previous_centers = [
                (item.start + item.end) / 2 for item in clusters[-1]
            ]
            cluster_center = float(np.median(previous_centers))
            if abs(center - cluster_center) <= config.consensus_cluster_seconds:
                clusters[-1].append(candidate)
            else:
                clusters.append([candidate])
        consensus_items: list[Candidate] = []
        cluster_diagnostics: list[dict[str, object]] = []
        for cluster in clusters:
            consensus, diagnostic = _consensus_candidate(
                line.index,
                cluster,
                config,
                normal_mix=normal_mix,
            )
            consensus_items.append(consensus)
            cluster_diagnostics.append(diagnostic)
        if counts[line.normalized] == 1:
            eligible = [
                index
                for index, candidate in enumerate(consensus_items)
                if candidate.freeze_eligible
            ]
            if len(eligible) > 1:
                ranked = sorted(
                    eligible,
                    key=lambda index: consensus_items[index].quality_score,
                    reverse=True,
                )
                best_candidate = consensus_items[ranked[0]]
                second_candidate = consensus_items[ranked[1]]
                quality_close = (
                    best_candidate.quality_score - second_candidate.quality_score
                    <= config.consensus_competition_margin
                )
                text_close = (
                    best_candidate.similarity - second_candidate.similarity
                    <= config.consensus_competition_margin
                )
                if quality_close and text_close:
                    for index in eligible:
                        consensus_items[index] = replace(
                            consensus_items[index],
                            freeze_eligible=False,
                            quality_reason="competing_temporal_clusters",
                        )
                        cluster_diagnostics[index]["freeze_eligible"] = False
                        cluster_diagnostics[index]["quality_reason"] = (
                            "competing_temporal_clusters"
                        )
        result[line.index] = sorted(
            consensus_items,
            key=lambda candidate: (candidate.obs_end_index, -candidate.score),
        )
        diagnostics[str(line.index)] = cluster_diagnostics
    return result, {
        "normal_mix_quality_gate": normal_mix,
        "lines": diagnostics,
    }


@dataclass(frozen=True)
class _State:
    score: float
    path: tuple[Candidate | None, ...]
    last_candidate: Candidate | None
    last_line: LyricLine | None


def _candidate_summary(candidate: Candidate | None) -> dict[str, object] | None:
    if candidate is None:
        return None
    return {
        "start": candidate.start,
        "end": candidate.end,
        "score": candidate.score,
        "similarity": candidate.similarity,
        "confidence": candidate.confidence,
        "boundary_support": candidate.boundary_support,
        "support_count": candidate.support_count,
        "dispersion_seconds": candidate.time_dispersion,
        "quality_score": candidate.quality_score,
        "freeze_eligible": candidate.freeze_eligible,
        "quality_reason": candidate.quality_reason,
        "observation_span": [
            candidate.obs_start_index,
            candidate.obs_end_index,
        ],
    }


def _candidate_slots(items: list[Candidate]) -> list[list[Candidate]]:
    unique: dict[tuple[int, int, str], Candidate] = {}
    for candidate in items:
        key = (
            round(candidate.start * 20),
            round(candidate.end * 20),
            candidate.boundary_support,
        )
        current = unique.get(key)
        if current is None or candidate.score > current.score:
            unique[key] = candidate
    ordered = sorted(
        unique.values(),
        key=lambda item: ((item.start + item.end) / 2, item.start),
    )
    slots: list[list[Candidate]] = []
    for candidate in ordered:
        if not slots:
            slots.append([candidate])
            continue
        previous = slots[-1]
        previous_start = min(item.start for item in previous)
        previous_end = max(item.end for item in previous)
        intersection = max(
            0.0,
            min(previous_end, candidate.end) - max(previous_start, candidate.start),
        )
        union = max(previous_end, candidate.end) - min(previous_start, candidate.start)
        previous_center = sum(
            (item.start + item.end) / 2 for item in previous
        ) / len(previous)
        candidate_center = (candidate.start + candidate.end) / 2
        if (
            abs(candidate_center - previous_center) <= 0.5
            or (union > 0 and intersection / union >= 0.45)
        ):
            previous.append(candidate)
        else:
            slots.append([candidate])
    return slots


def _slot_index(candidate: Candidate, slots: list[list[Candidate]]) -> int | None:
    center = (candidate.start + candidate.end) / 2
    best_index: int | None = None
    best_distance = math.inf
    for index, slot in enumerate(slots):
        slot_center = sum((item.start + item.end) / 2 for item in slot) / len(slot)
        distance = abs(center - slot_center)
        if distance < best_distance:
            best_distance = distance
            best_index = index
    return best_index if best_distance <= 0.6 else None


def _unique_anchor_bounds(
    lyrics: list[LyricLine],
    path: tuple[Candidate | None, ...],
    line_index: int,
) -> tuple[float, float]:
    counts: dict[str, int] = {}
    for line in lyrics:
        counts[line.normalized] = counts.get(line.normalized, 0) + 1
    lower = -math.inf
    upper = math.inf
    for position, (line, candidate) in enumerate(zip(lyrics, path, strict=True)):
        if candidate is None or counts[line.normalized] != 1:
            continue
        if position < line_index:
            lower = max(lower, candidate.end)
        elif position > line_index:
            upper = min(upper, candidate.start)
    return lower, upper


def _ordered_repetition_resolves(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
    path: tuple[Candidate | None, ...],
    differing_lines: list[int],
    config: AlignConfig,
) -> tuple[bool, list[dict[str, object]]]:
    by_normalized: dict[str, list[int]] = {}
    for line in lyrics:
        by_normalized.setdefault(line.normalized, []).append(line.index)
    affected_norms = {lyrics[index].normalized for index in differing_lines}
    group_diagnostics: list[dict[str, object]] = []
    resolved_any = False
    for group_index, normalized in enumerate(sorted(affected_norms)):
        group_id = f"repetition_resolution_{group_index}"
        occurrence_indexes = by_normalized[normalized]
        if len(occurrence_indexes) < 2:
            group_diagnostics.append(
                {
                    "group_id": group_id,
                    "resolved": False,
                    "reason": "not_a_repeated_lyric",
                    "lyric_line_indexes": occurrence_indexes,
                }
            )
            return False, group_diagnostics
        eligible: list[Candidate] = []
        for line_index in occurrence_indexes:
            lower, upper = _unique_anchor_bounds(lyrics, path, line_index)
            eligible.extend(
                candidate
                for candidate in candidates[line_index]
                if candidate.similarity >= config.anchor_similarity
                and candidate.freeze_eligible
                and candidate.start >= lower
                and candidate.end <= upper
            )
        slots = _candidate_slots(eligible)
        selected = [path[index] for index in occurrence_indexes]
        slot_indexes = [
            None if candidate is None else _slot_index(candidate, slots)
            for candidate in selected
        ]
        resolved = (
            len(slots) == len(occurrence_indexes)
            and all(index is not None for index in slot_indexes)
            and slot_indexes == list(range(len(occurrence_indexes)))
        )
        group_diagnostics.append(
            {
                "group_id": group_id,
                "resolved": resolved,
                "reason": (
                    "one_to_one_ordered_occurrence_slots"
                    if resolved
                    else "slot_count_or_order_is_not_unique"
                ),
                "lyric_line_indexes": occurrence_indexes,
                "candidate_slot_count": len(slots),
                "selected_slot_indexes": slot_indexes,
                "slot_times": [
                    [
                        min(candidate.start for candidate in slot),
                        max(candidate.end for candidate in slot),
                    ]
                    for slot in slots
                ],
            }
        )
        if not resolved:
            return False, group_diagnostics
        resolved_any = True
    return resolved_any, group_diagnostics


def _repetition_position_cost(
    lyrics: list[LyricLine],
    path: tuple[Candidate | None, ...],
) -> float | None:
    by_normalized: dict[str, list[int]] = {}
    counts: dict[str, int] = {}
    for line in lyrics:
        by_normalized.setdefault(line.normalized, []).append(line.index)
        counts[line.normalized] = counts.get(line.normalized, 0) + 1
    total_cost = 0.0
    used_prior = False
    for occurrence_indexes in by_normalized.values():
        if len(occurrence_indexes) < 2:
            continue
        selected = [path[index] for index in occurrence_indexes]
        if not any(candidate is None for candidate in selected):
            continue
        supported = [candidate for candidate in selected if candidate is not None]
        if not supported or any(
            candidate.boundary_support not in {"segment", "line"}
            for candidate in supported
        ):
            continue
        first = occurrence_indexes[0]
        last = occurrence_indexes[-1]
        previous = [
            path[index]
            for index in range(first)
            if counts[lyrics[index].normalized] == 1 and path[index] is not None
        ]
        following = [
            path[index]
            for index in range(last + 1, len(lyrics))
            if counts[lyrics[index].normalized] == 1 and path[index] is not None
        ]
        if not previous or not following:
            continue
        previous_candidate = previous[-1]
        next_candidate = following[0]
        if previous_candidate is None or next_candidate is None:
            continue
        lower = previous_candidate.end
        upper = next_candidate.start
        step = (upper - lower) / (len(occurrence_indexes) + 1)
        if step <= 0:
            continue
        for position, candidate in enumerate(selected, 1):
            if candidate is None:
                continue
            expected_center = lower + step * position
            candidate_center = (candidate.start + candidate.end) / 2
            total_cost += abs(candidate_center - expected_center) / step
        used_prior = True
    return total_cost if used_prior else None


def select_anchors(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
    config: AlignConfig,
    *,
    strict_ambiguity: bool = True,
    require_freeze_eligible: bool = True,
) -> tuple[dict[int, Candidate], dict[str, object]]:
    states: dict[int, list[_State]] = {-1: [_State(0.0, (), None, None)]}
    for line in lyrics:
        next_states: dict[int, list[_State]] = {}
        for key, state_group in states.items():
            for state in state_group:
                skipped = _State(
                    score=state.score - 1.15,
                    path=(*state.path, None),
                    last_candidate=state.last_candidate,
                    last_line=state.last_line,
                )
                next_states.setdefault(key, []).append(skipped)
                for candidate in candidates[line.index]:
                    if candidate.similarity < config.anchor_similarity:
                        continue
                    if require_freeze_eligible and not candidate.freeze_eligible:
                        continue
                    if candidate.obs_start_index <= key:
                        continue
                    transition = 0.0
                    if state.last_candidate is not None and state.last_line is not None:
                        time_gap = candidate.start - state.last_candidate.end
                        if time_gap < -0.12:
                            continue
                        changed_block = state.last_line.block != line.block
                        if not changed_block and time_gap >= config.long_gap_seconds:
                            transition -= 5.0
                        elif changed_block and time_gap >= config.hard_gap_seconds:
                            transition += min(1.8, time_gap / config.long_gap_seconds)
                        elif changed_block:
                            transition -= 1.2
                    anchored = _State(
                        score=state.score + candidate.score + transition,
                        path=(*state.path, candidate),
                        last_candidate=candidate,
                        last_line=line,
                    )
                    next_states.setdefault(candidate.obs_end_index, []).append(anchored)
        reduced: dict[int, list[_State]] = {}
        for key, group in next_states.items():
            ordered = sorted(group, key=lambda item: item.score, reverse=True)
            unique: list[_State] = []
            signatures: set[tuple[tuple[int, int] | None, ...]] = set()
            for state in ordered:
                signature = tuple(
                    None
                    if item is None
                    else (item.obs_start_index, item.obs_end_index)
                    for item in state.path
                )
                if signature in signatures:
                    continue
                signatures.add(signature)
                unique.append(state)
                if len(unique) == 2:
                    break
            reduced[key] = unique
        states = dict(
            sorted(
                reduced.items(),
                key=lambda item: item[1][0].score,
                reverse=True,
            )[:2048]
        )
    final_states = [state for group in states.values() for state in group]
    effective_scores: dict[int, float] = {}
    position_costs: dict[int, float | None] = {}
    for state in final_states:
        position_cost = _repetition_position_cost(lyrics, state.path)
        position_costs[id(state)] = position_cost
        effective_scores[id(state)] = state.score - (
            0.0
            if position_cost is None
            else (config.ambiguity_score_margin + 0.35) * position_cost
        )
    ordered_final = sorted(
        final_states,
        key=lambda state: effective_scores[id(state)],
        reverse=True,
    )
    best = ordered_final[0]
    ambiguity: dict[str, object] | None = None
    resolved_repetition_ambiguities: list[dict[str, object]] = []
    for alternative in ordered_final[1:]:
        margin = effective_scores[id(best)] - effective_scores[id(alternative)]
        if margin > config.ambiguity_score_margin:
            break
        differing_lines: list[int] = []
        for line, selected, other in zip(
            lyrics,
            best.path,
            alternative.path,
            strict=True,
        ):
            if selected is None or other is None:
                if selected is not other:
                    differing_lines.append(line.index)
            elif (
                abs(selected.start - other.start) > 0.5
                or abs(selected.end - other.end) > 0.5
            ):
                differing_lines.append(line.index)
        if not differing_lines:
            continue
        resolved, repetition_diagnostics = _ordered_repetition_resolves(
            lyrics,
            candidates,
            best.path,
            differing_lines,
            config,
        )
        if resolved:
            resolved_repetition_ambiguities.append(
                {
                    "score_margin": margin,
                    "affected_lyric_line_indexes": differing_lines,
                    "groups": repetition_diagnostics,
                }
            )
            continue
        ambiguity = {
            "reason_code": "ambiguous_timing_candidates",
            "score_margin": margin,
            "best_path_score": best.score,
            "competing_path_score": alternative.score,
            "best_effective_score": effective_scores[id(best)],
            "competing_effective_score": effective_scores[id(alternative)],
            "best_repetition_position_cost": position_costs[id(best)],
            "competing_repetition_position_cost": position_costs[id(alternative)],
            "affected_lyric_line_indexes": differing_lines,
            "best_path": {
                str(index): _candidate_summary(best.path[index])
                for index in differing_lines
            },
            "competing_path": {
                str(index): _candidate_summary(alternative.path[index])
                for index in differing_lines
            },
            "competing_candidates": {
                str(index): [
                    _candidate_summary(candidate)
                    for candidate in sorted(
                        candidates[index],
                        key=lambda item: item.score,
                        reverse=True,
                    )[:12]
                ]
                for index in differing_lines
            },
            "repetition_resolution": repetition_diagnostics,
        }
        break
    if ambiguity is not None and strict_ambiguity:
        raise AlignmentError(
            "ambiguous timing candidate assignment; refusing unsafe alignment "
            f"(lines {ambiguity['affected_lyric_line_indexes']})",
            code="ambiguous_timing_candidates",
            diagnostics=ambiguity,
        )
    anchors = {
        line.index: candidate
        for line, candidate in zip(lyrics, best.path, strict=True)
        if candidate is not None
    }
    return anchors, {
        "dp_score": best.score,
        "effective_dp_score": effective_scores[id(best)],
        "repetition_position_cost": position_costs[id(best)],
        "candidate_counts": {
            str(line.index): len(candidates[line.index]) for line in lyrics
        },
        "anchor_count": len(anchors),
        "resolved_repetition_ambiguities": resolved_repetition_ambiguities,
        "relaxed_ambiguity": ambiguity,
        "required_freeze_eligible": require_freeze_eligible,
    }


def recognition_gaps(
    observations: list[Observation],
    threshold: float,
) -> list[tuple[float, float]]:
    reliable = [
        item
        for item in observations
        if item.confidence * (1.0 - item.no_speech_prob) >= 0.36
    ]
    if not reliable:
        return []
    reliable.sort(key=lambda item: (item.start, item.end))
    gaps: list[tuple[float, float]] = []
    covered_end = reliable[0].end
    for observation in reliable[1:]:
        if observation.start - covered_end >= threshold:
            gaps.append((covered_end, observation.start))
        covered_end = max(covered_end, observation.end)
    return gaps


def _contains_gap(
    left: float,
    right: float,
    forbidden: list[tuple[float, float]],
    tolerance: float,
) -> bool:
    return interval_intersects(left, right, forbidden, tolerance)


def _weights(lines: list[LyricLine]) -> list[float]:
    return [max(1.0, min(12.0, len(line.normalized)) ** 0.72) for line in lines]


def _allocate(
    lines: list[LyricLine],
    start: float,
    end: float,
    config: AlignConfig,
    source: str,
) -> list[AlignedLine]:
    if not lines:
        return []
    if end <= start:
        raise AlignmentError(
            f"not enough safe time for lyrics lines {lines[0].index}..{lines[-1].index}"
        )
    duration = end - start
    if duration < config.min_line_seconds * len(lines):
        raise AlignmentError(
            f"safe span is too short for lyrics lines {lines[0].index}..{lines[-1].index}"
        )
    if duration > config.max_line_seconds * len(lines):
        raise AlignmentError(
            f"safe span exceeds max_line_seconds for lyrics lines "
            f"{lines[0].index}..{lines[-1].index}"
        )
    weights = _weights(lines)
    available = end - start
    # Never overlap lines. If the ideal minimum does not fit, allocate a positive
    # proportional duration and expose the low confidence in diagnostics.
    total = sum(weights)
    cursor = start
    output: list[AlignedLine] = []
    for position, (line, weight) in enumerate(zip(lines, weights, strict=True)):
        line_end = end if position == len(lines) - 1 else cursor + available * weight / total
        if line_end <= cursor:
            raise AlignmentError(f"non-positive interpolation for lyric line {line.index}")
        output.append(
            AlignedLine(
                index=line.index,
                block=line.block,
                text=line.text,
                start=cursor,
                end=line_end,
                confidence=0.24 if available >= config.min_line_seconds * len(lines) else 0.12,
                provenance=[source],
                diagnostics={"anchored": False, "interpolation_span": [start, end]},
            )
        )
        available -= line_end - cursor
        total -= weight
        cursor = line_end
    return output


def materialize_lines(
    lyrics: list[LyricLine],
    anchors: dict[int, Candidate],
    duration: float,
    forbidden: list[tuple[float, float]],
    activity_components: list[tuple[float, float]],
    config: AlignConfig,
    boundary_diagnostics: dict[int, dict[str, object]] | None = None,
) -> list[AlignedLine]:
    if not anchors:
        raise AlignmentError(
            "no lyric anchors were found; refusing to place known lyrics into unverified audio"
        )
    aligned: dict[int, AlignedLine] = {}
    support_diagnostics = boundary_diagnostics or {}
    for line in lyrics:
        candidate = anchors.get(line.index)
        if candidate is None:
            continue
        line_support = support_diagnostics.get(line.index, {})
        trusted_boundary_supported = bool(
            line_support.get("trusted_activity_supported")
        )
        model_boundary_supported = bool(
            line_support.get("model_boundary_supported")
        )
        if not trusted_boundary_supported and not model_boundary_supported:
            raise AlignmentError(
                f"lyric line {line.index} has only an unsupported word/unknown "
                "boundary on a mixture; provide a vocal stem, use --vocal-only "
                "for isolated vocals, or provide segment boundary support"
            )
        confidence = min(
            1.0,
            0.55 * candidate.similarity + 0.45 * candidate.confidence,
        )
        if not trusted_boundary_supported:
            confidence *= min(
                0.78,
                config.word_boundary_confidence_scale + 0.06,
            )
        aligned[line.index] = AlignedLine(
            index=line.index,
            block=line.block,
            text=line.text,
            start=max(0.0, candidate.start),
            end=min(duration, candidate.end),
            confidence=confidence,
            provenance=list(candidate.provenance),
            diagnostics={
                "anchored": True,
                "text_similarity": candidate.similarity,
                "observation_span": [
                    candidate.obs_start_index,
                    candidate.obs_end_index,
                ],
                "boundary_support": line_support,
            },
        )

    block_ids = sorted({line.block for line in lyrics})
    by_block = {block: [line for line in lyrics if line.block == block] for block in block_ids}
    for block in block_ids:
        block_lines = by_block[block]
        block_indexes = {line.index for line in block_lines}
        block_anchors = sorted(index for index in aligned if index in block_indexes)
        if not block_anchors:
            raise AlignmentError(
                f"lyric block {block} has no anchor; refusing unconstrained allocation"
            )
        previous_block_ends = [
            aligned[index].end
            for index in aligned
            if index < block_lines[0].index
        ]
        next_block_starts = [
            aligned[index].start
            for index in aligned
            if index > block_lines[-1].index
        ]
        lower = max(previous_block_ends, default=0.0)
        upper = min(next_block_starts, default=duration)
        first_start = aligned[block_anchors[0]].start
        last_end = aligned[block_anchors[-1]].end
        for gap_start, gap_end in forbidden:
            if lower < gap_end <= first_start:
                lower = max(lower, gap_end)
            if last_end <= gap_start < upper:
                upper = min(upper, gap_start)

        boundaries = [block_lines[0].index - 1, *block_anchors, block_lines[-1].index + 1]
        for left_index, right_index in zip(boundaries, boundaries[1:], strict=False):
            missing = [
                line for line in block_lines if left_index < line.index < right_index
            ]
            if not missing:
                continue
            left_time = aligned[left_index].end if left_index in aligned else lower
            right_time = aligned[right_index].start if right_index in aligned else upper
            left_is_anchor = left_index in aligned
            right_is_anchor = right_index in aligned
            if not left_is_anchor or not right_is_anchor:
                if not activity_components:
                    raise AlignmentError(
                        f"edge lyrics lines {missing[0].index}..{missing[-1].index} "
                        "lack two safe boundaries and no trusted vocal activity is available"
                    )
                if right_is_anchor and not left_is_anchor:
                    preceding = [
                        component
                        for component in activity_components
                        if component[1]
                        <= aligned[right_index].start
                        + config.forbidden_tolerance_seconds
                    ]
                    if not preceding:
                        raise AlignmentError(
                            f"no distinct trusted vocal component supports edge lyrics "
                            f"lines {missing[0].index}..{missing[-1].index}"
                        )
                    left_time, right_time = preceding[-1]
                elif left_is_anchor and not right_is_anchor:
                    following = [
                        component
                        for component in activity_components
                        if component[0]
                        >= aligned[left_index].end
                        - config.forbidden_tolerance_seconds
                    ]
                    if not following:
                        raise AlignmentError(
                            f"no distinct trusted vocal component supports edge lyrics "
                            f"lines {missing[0].index}..{missing[-1].index}"
                        )
                    left_time, right_time = following[0]
                else:
                    raise AlignmentError(
                        f"edge lyrics lines {missing[0].index}..{missing[-1].index} "
                        "are unconstrained"
                    )
            if _contains_gap(
                left_time,
                right_time,
                forbidden,
                config.forbidden_tolerance_seconds,
            ):
                # Clamp to the safe component attached to the nearest anchor.
                relevant = [
                    gap
                    for gap in forbidden
                    if left_time < gap[1] and right_time > gap[0]
                ]
                if left_is_anchor:
                    right_time = min(gap[0] for gap in relevant)
                elif right_is_anchor:
                    left_time = max(gap[1] for gap in relevant)
                else:
                    raise AlignmentError(
                        f"unanchored lyric block {block} spans a no-vocal interval"
                    )
            for item in _allocate(
                missing,
                left_time,
                right_time,
                config,
                "safe_interpolation",
            ):
                aligned[item.index] = item
    result = [aligned[line.index] for line in lyrics]
    validate_alignment(result, duration, forbidden, config)
    return result


def validate_alignment(
    lines: list[AlignedLine],
    duration: float,
    forbidden: list[tuple[float, float]],
    config: AlignConfig,
) -> None:
    previous_end = -1.0
    for line in lines:
        if not (0 <= line.start < line.end <= duration + 1e-6):
            raise AlignmentError(f"invalid timestamps for lyric line {line.index}")
        line_duration = line.end - line.start
        if not config.min_line_seconds <= line_duration <= config.max_line_seconds:
            raise AlignmentError(
                f"lyric line {line.index} duration {line_duration:.3f}s violates "
                "configured bounds"
            )
        if line.start < previous_end - 1e-6:
            raise AlignmentError(f"non-monotonic timestamps at lyric line {line.index}")
        if interval_intersects(
            line.start,
            line.end,
            forbidden,
            config.forbidden_tolerance_seconds,
        ):
            raise AlignmentError(
                f"lyric line {line.index} intersects a forbidden interval"
            )
        previous_end = line.end

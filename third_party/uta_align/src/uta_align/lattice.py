from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, replace

from .config import AlignConfig
from .models import Candidate, LyricLine

_PRIOR_INLIER_SECONDS = 2.0
_PRIOR_MIN_POINTS = 3
_DURATION_RATE_INLIER_SECONDS_PER_CHAR = 0.18
_DURATION_PRIOR_MIN_POINTS = 3
_END_START_CLUSTER_SECONDS = 0.75
_END_HUBER_SECONDS = 0.35
_DURATION_PRIOR_BLEND = 0.50
_PRIOR_MODEL_LINE_LIMIT = 24
_LATTICE_PROMPT_CORRELATION_PENALTY = 0.90
_LATTICE_BEAM_SIZE = 4096


@dataclass(frozen=True)
class _PriorHypothesis:
    line_index: int
    progress: float
    start: float
    quality: float


@dataclass(frozen=True)
class _ProgressPrior:
    mode: str
    rate: float
    intercept: float
    point_count: int
    inlier_count: int
    inlier_line_count: int
    valid: bool
    validation_reason: str

    def predict(self, progress: float) -> float:
        return self.intercept + self.rate * progress


@dataclass(frozen=True)
class _LatticeState:
    score: float
    path: tuple[Candidate | None, ...]
    last_candidate: Candidate | None
    last_position: int | None
    repeat_slots: frozenset[tuple[str, int]]


def _source_families(candidate: Candidate) -> tuple[str, ...]:
    return candidate.source_families or ("unknown",)


def _groups(candidate: Candidate) -> tuple[str, ...]:
    return candidate.independence_groups or candidate.request_ids or ("unknown",)


def _trusted_family(source_family: str) -> bool:
    normalized = source_family.casefold().replace("-", "_")
    return (
        normalized.startswith("trusted")
        or "vocal_stem" in normalized
        or "isolated_vocal" in normalized
    )


def _has_unprompted_or_trusted(candidate: Candidate) -> bool:
    return (
        "unprompted" in candidate.prompt_strategies
        or any(_trusted_family(family) for family in _source_families(candidate))
    )


def _explicit_context_metadata(candidate: Candidate) -> bool:
    return bool(
        candidate.prompt_strategies
        or candidate.source_families
        or candidate.independence_groups
    )


def _boundary_types(candidate: Candidate) -> set[str]:
    return set(
        candidate.boundary_support_types
        or (candidate.boundary_support,)
    )


def _intersects(
    start: float,
    end: float,
    intervals: list[tuple[float, float]],
    tolerance: float,
) -> bool:
    return any(
        start < right - tolerance and end > left + tolerance
        for left, right in intervals
    )


def _line_progress(lyrics: list[LyricLine]) -> tuple[dict[int, float], float]:
    positions: dict[int, float] = {}
    progress = 0.0
    for line in lyrics:
        positions[line.index] = progress
        progress += max(1, len(line.normalized))
    return positions, max(1.0, progress)


def _candidate_rank(candidate: Candidate) -> tuple[float, ...]:
    return (
        candidate.similarity,
        candidate.quality_score,
        candidate.confidence,
        -candidate.no_speech_prob,
        float(candidate.support_count),
        candidate.score,
        -candidate.start,
    )


def _progress_prior_hypotheses(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
    progress: dict[int, float],
    config: AlignConfig,
) -> dict[int, list[_PriorHypothesis]]:
    hypotheses: dict[int, list[_PriorHypothesis]] = {}
    for line in lyrics:
        trusted = [
            candidate
            for candidate in candidates.get(line.index, [])
            if "word" in _boundary_types(candidate)
            and _has_unprompted_or_trusted(candidate)
            and candidate.similarity >= 0.78
            and candidate.quality_score >= 0.64
            and candidate.confidence >= 0.60
            and candidate.no_speech_prob < 0.35
        ]
        ordered = sorted(trusted, key=_candidate_rank, reverse=True)
        line_hypotheses: list[_PriorHypothesis] = []
        seen_starts: set[float] = set()
        for candidate in ordered:
            rounded_start = round(candidate.start, 3)
            if rounded_start in seen_starts:
                continue
            seen_starts.add(rounded_start)
            line_hypotheses.append(
                _PriorHypothesis(
                    line_index=line.index,
                    progress=progress[line.index],
                    start=candidate.start,
                    quality=(
                        candidate.similarity
                        * candidate.quality_score
                        * candidate.confidence
                        * (1.0 - candidate.no_speech_prob)
                    ),
                )
            )
            if (
                len(line_hypotheses)
                >= config.progress_prior_top_k_per_line
            ):
                break
        if line_hypotheses:
            hypotheses[line.index] = line_hypotheses
    return hypotheses


def _sample_model_lines(line_indexes: list[int]) -> list[int]:
    if len(line_indexes) <= _PRIOR_MODEL_LINE_LIMIT:
        return line_indexes
    selected = {
        line_indexes[
            round(
                ordinal
                * (len(line_indexes) - 1)
                / (_PRIOR_MODEL_LINE_LIMIT - 1)
            )
        ]
        for ordinal in range(_PRIOR_MODEL_LINE_LIMIT)
    }
    return sorted(selected)


def _model_votes(
    rate: float,
    intercept: float,
    hypotheses: dict[int, list[_PriorHypothesis]],
) -> list[_PriorHypothesis]:
    votes: list[_PriorHypothesis] = []
    for line_hypotheses in hypotheses.values():
        best = min(
            line_hypotheses,
            key=lambda item: (
                abs(item.start - (intercept + rate * item.progress)),
                -item.quality,
                item.start,
            ),
        )
        if (
            abs(best.start - (intercept + rate * best.progress))
            <= _PRIOR_INLIER_SECONDS
        ):
            votes.append(best)
    return votes


def _prior_model_is_plausible(
    *,
    rate: float,
    intercept: float,
    votes: list[_PriorHypothesis],
    evidence_line_count: int,
    total_progress: float,
    duration: float,
    usable_audio_span: float,
    config: AlignConfig,
) -> tuple[bool, str]:
    if duration <= 0 or total_progress <= 0:
        return False, "invalid_audio_or_lyric_span"
    proportional_rate = usable_audio_span / total_progress
    slope_ratio = rate / proportional_rate
    if not (
        config.progress_prior_min_slope_ratio
        <= slope_ratio
        <= config.progress_prior_max_slope_ratio
    ):
        return False, "slope_ratio_outside_configured_bounds"
    predicted_span = rate * total_progress
    span_ratio = predicted_span / usable_audio_span
    if not (
        config.progress_prior_min_span_ratio
        <= span_ratio
        <= config.progress_prior_max_span_ratio
    ):
        return False, "predicted_span_ratio_outside_configured_bounds"
    if evidence_line_count <= 0:
        return False, "no_prior_evidence_lines"
    inlier_fraction = len(votes) / evidence_line_count
    if inlier_fraction < config.progress_prior_min_inlier_fraction:
        return False, "insufficient_inlier_line_fraction"
    if len(votes) < _PRIOR_MIN_POINTS:
        return False, "insufficient_inlier_lines"
    progress_values = [vote.progress for vote in votes]
    endpoint_coverage = (
        max(progress_values) - min(progress_values)
    ) / total_progress
    if (
        endpoint_coverage
        < config.progress_prior_min_endpoint_coverage
    ):
        return False, "insufficient_endpoint_coverage"
    predicted_start = intercept
    predicted_end = intercept + predicted_span
    overlap = max(
        0.0,
        min(duration, predicted_end) - max(0.0, predicted_start),
    )
    if overlap < 0.5 * min(duration, predicted_span):
        return False, "predicted_span_mostly_outside_audio"
    return True, "validated_multi_hypothesis_prior"


def _refit_prior_votes(
    votes: list[_PriorHypothesis],
) -> tuple[float, float] | None:
    slopes = [
        (right.start - left.start)
        / (right.progress - left.progress)
        for left_index, left in enumerate(votes)
        for right in votes[left_index + 1 :]
        if right.progress > left.progress
        and (right.start - left.start)
        / (right.progress - left.progress)
        > 0.0
    ]
    if not slopes:
        return None
    rate = statistics.median(slopes)
    intercept = statistics.median(
        [vote.start - rate * vote.progress for vote in votes]
    )
    return rate, intercept


def _fit_multi_hypothesis_prior(
    hypotheses: dict[int, list[_PriorHypothesis]],
    total_progress: float,
    duration: float,
    usable_audio_span: float,
    config: AlignConfig,
) -> tuple[
    float,
    float,
    list[_PriorHypothesis],
] | None:
    if len(hypotheses) < _PRIOR_MIN_POINTS:
        return None
    model_lines = _sample_model_lines(sorted(hypotheses))
    best: tuple[
        tuple[int, float, float],
        float,
        float,
        list[_PriorHypothesis],
    ] | None = None
    for left_position, left_index in enumerate(model_lines):
        for right_index in model_lines[left_position + 1 :]:
            for left in hypotheses[left_index]:
                for right in hypotheses[right_index]:
                    progress_delta = right.progress - left.progress
                    if progress_delta <= 0:
                        continue
                    rate = (right.start - left.start) / progress_delta
                    if rate <= 0:
                        continue
                    intercept = left.start - rate * left.progress
                    votes = _model_votes(
                        rate,
                        intercept,
                        hypotheses,
                    )
                    plausible, _reason = _prior_model_is_plausible(
                        rate=rate,
                        intercept=intercept,
                        votes=votes,
                        evidence_line_count=len(hypotheses),
                        total_progress=total_progress,
                        duration=duration,
                        usable_audio_span=usable_audio_span,
                        config=config,
                    )
                    if not plausible:
                        continue
                    time_span = (
                        max(vote.start for vote in votes)
                        - min(vote.start for vote in votes)
                    )
                    quality = sum(vote.quality for vote in votes)
                    lexicographic = (
                        len(votes),
                        time_span,
                        quality,
                    )
                    if best is None or lexicographic > best[0]:
                        best = (
                            lexicographic,
                            rate,
                            intercept,
                            votes,
                        )
    if best is None:
        return None
    _, _seed_rate, _seed_intercept, seed_votes = best
    refitted = _refit_prior_votes(seed_votes)
    if refitted is None:
        return None
    rate, intercept = refitted
    votes = _model_votes(rate, intercept, hypotheses)
    plausible, _reason = _prior_model_is_plausible(
        rate=rate,
        intercept=intercept,
        votes=votes,
        evidence_line_count=len(hypotheses),
        total_progress=total_progress,
        duration=duration,
        usable_audio_span=usable_audio_span,
        config=config,
    )
    if not plausible:
        return None
    return rate, intercept, votes


def _build_progress_prior(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
    duration: float,
    usable_audio_span: float,
    config: AlignConfig,
) -> tuple[_ProgressPrior, dict[int, float], float]:
    progress, total = _line_progress(lyrics)
    hypotheses = _progress_prior_hypotheses(
        lyrics,
        candidates,
        progress,
        config,
    )
    fitted = _fit_multi_hypothesis_prior(
        hypotheses,
        total,
        duration,
        usable_audio_span,
        config,
    )
    point_count = sum(len(items) for items in hypotheses.values())
    if fitted is None:
        return (
            _ProgressPrior(
                mode="proportional_fallback",
                rate=usable_audio_span / total,
                intercept=0.0,
                point_count=point_count,
                inlier_count=0,
                inlier_line_count=0,
                valid=duration > 0 and total > 0,
                validation_reason=(
                    "multi_hypothesis_prior_rejected"
                    if len(hypotheses) >= _PRIOR_MIN_POINTS
                    else "insufficient_prior_evidence"
                ),
            ),
            progress,
            total,
        )
    rate, intercept, votes = fitted
    return (
        _ProgressPrior(
            mode="robust_multi_hypothesis",
            rate=rate,
            intercept=intercept,
            point_count=point_count,
            inlier_count=len(votes),
            inlier_line_count=len(votes),
            valid=True,
            validation_reason="validated_multi_hypothesis_prior",
        ),
        progress,
        total,
    )


def _duration_prior(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
) -> tuple[float | None, int, int]:
    values: list[float] = []
    for line in lyrics:
        character_count = max(1, len(line.normalized))
        trusted = [
            candidate
            for candidate in candidates.get(line.index, [])
            if {"segment", "word"} <= _boundary_types(candidate)
            and _has_unprompted_or_trusted(candidate)
            and candidate.similarity >= 0.78
            and candidate.quality_score >= 0.64
            and candidate.confidence >= 0.60
        ]
        if not trusted:
            continue
        best = max(trusted, key=_candidate_rank)
        rate = (best.end - best.start) / character_count
        if 0.03 <= rate <= 2.0:
            values.append(rate)
    if len(values) < _DURATION_PRIOR_MIN_POINTS:
        return None, len(values), 0
    median = statistics.median(values)
    inliers = [
        value
        for value in values
        if abs(value - median) <= _DURATION_RATE_INLIER_SECONDS_PER_CHAR
    ]
    if len(inliers) < _DURATION_PRIOR_MIN_POINTS:
        return None, len(values), len(inliers)
    return statistics.median(inliers), len(values), len(inliers)


def _valid_candidate(
    candidate: Candidate,
    duration: float,
    hard_barriers: list[tuple[float, float]],
    config: AlignConfig,
) -> bool:
    line_duration = candidate.end - candidate.start
    return (
        candidate.similarity >= config.min_similarity
        and 0.0 <= candidate.start < candidate.end <= duration + 1e-9
        and config.min_line_seconds <= line_duration <= config.max_line_seconds
        and not _intersects(
            candidate.start,
            candidate.end,
            hard_barriers,
            config.forbidden_tolerance_seconds,
        )
    )


def _candidate_end_reliability(
    candidate: Candidate,
    line_candidates: list[Candidate],
    hard_barriers: list[tuple[float, float]],
    config: AlignConfig,
) -> float:
    compatible = [
        other
        for other in line_candidates
        if abs(other.start - candidate.start)
        <= _END_START_CLUSTER_SECONDS
        and abs(other.end - candidate.end) <= _END_START_CLUSTER_SECONDS
        and config.min_line_seconds
        <= other.end - candidate.start
        <= config.max_line_seconds
        and not _intersects(
            candidate.start,
            other.end,
            hard_barriers,
            config.forbidden_tolerance_seconds,
        )
        and other.boundary_support in {"word", "segment", "line"}
    ]
    capped = _cap_end_evidence(compatible)
    if len(capped) < 2:
        return 0.0
    ends = [other.end for other in capped]
    dispersion = max(ends) - min(ends)
    diversity = min(1.0, (len(capped) - 1) / 2.0)
    agreement = 1.0 - min(
        1.0,
        dispersion / _END_START_CLUSTER_SECONDS,
    )
    return min(1.0, 0.60 * diversity + 0.40 * agreement)


def _raw_emission_score(
    candidate: Candidate,
    end_reliability: float = 0.0,
    end_reliability_weight: float = 0.0,
) -> float:
    strategy_count = len(set(candidate.prompt_strategies))
    source_count = len(set(_source_families(candidate)))
    prompt_only = (
        _explicit_context_metadata(candidate)
        and not _has_unprompted_or_trusted(candidate)
    )
    prompt_correlation = max(
        0,
        len(set(_groups(candidate))) - max(1, source_count),
    )
    score = (
        2.05 * candidate.similarity
        + 0.90 * candidate.quality_score
        + 0.40 * candidate.confidence
        + 0.15 * min(2, strategy_count)
        + (0.20 if candidate.freeze_eligible else 0.0)
        + 0.22 * max(-2.0, min(8.0, candidate.score))
        + (
            0.55
            if candidate.boundary_support in {"segment", "line"}
            else 0.0
        )
        + end_reliability_weight
        * max(0.0, min(1.0, end_reliability))
    )
    if prompt_only:
        score -= _LATTICE_PROMPT_CORRELATION_PENALTY
    score -= 0.18 * prompt_correlation
    return score


def _emission_score(
    candidate: Candidate,
    predicted_start: float,
    prior: _ProgressPrior,
    location: float,
    scale: float,
    config: AlignConfig,
    end_reliability: float = 0.0,
) -> float:
    standardized = (
        _raw_emission_score(
            candidate,
            end_reliability,
            config.lattice_end_reliability_weight,
        )
        - location
    ) / scale
    positive_emission = max(
        0.20,
        min(2.50, 1.0 + 0.30 * standardized),
    )
    if prior.mode != "robust_multi_hypothesis":
        return positive_emission
    residual = abs(candidate.start - predicted_start)
    prior_penalty = min(
        config.lattice_prior_penalty_cap,
        config.lattice_prior_penalty_cap
        * residual
        / _PRIOR_INLIER_SECONDS,
    )
    return positive_emission - prior_penalty


def _transition_score(
    previous: Candidate,
    previous_position: int,
    candidate: Candidate,
    position: int,
    progress: dict[int, float],
    prior: _ProgressPrior,
    lyrics: list[LyricLine],
) -> float | None:
    if candidate.start < previous.end - 1e-9:
        return None
    previous_progress = progress[lyrics[previous_position].index]
    current_progress = progress[lyrics[position].index]
    expected = prior.rate * max(0.0, current_progress - previous_progress)
    observed = candidate.start - previous.start
    if prior.mode != "robust_multi_hypothesis":
        return 0.0
    mismatch = abs(observed - expected)
    return -min(0.75, mismatch / _PRIOR_INLIER_SECONDS)


def _repeat_slot(
    line: LyricLine,
    candidate: Candidate,
    config: AlignConfig,
) -> tuple[str, int]:
    width = max(0.25, config.consensus_cluster_seconds)
    center = (candidate.start + candidate.end) / 2
    return line.normalized, int(math.floor(center / width + 0.5))


def _path_signature(
    path: tuple[Candidate | None, ...],
) -> tuple[tuple[float, float] | None, ...]:
    return tuple(
        None
        if candidate is None
        else (round(candidate.start, 3), round(candidate.end, 3))
        for candidate in path
    )


def _cap_end_evidence(
    candidates: list[Candidate],
) -> list[Candidate]:
    group_representatives: dict[tuple[str, str], Candidate] = {}
    for candidate in candidates:
        for group in _groups(candidate):
            for family in _source_families(candidate):
                key = (group, family)
                current = group_representatives.get(key)
                if current is None or _candidate_rank(candidate) > _candidate_rank(current):
                    group_representatives[key] = candidate
    family_representatives: dict[str, Candidate] = {}
    for (_group, family), candidate in group_representatives.items():
        current = family_representatives.get(family)
        if current is None or _candidate_rank(candidate) > _candidate_rank(current):
            family_representatives[family] = candidate
    return list(family_representatives.values())


def _end_evidence_weight(candidate: Candidate) -> float:
    return max(
        1e-6,
        candidate.quality_score
        * candidate.confidence
        * (1.0 - candidate.no_speech_prob),
    )


def _weighted_upper_quantile(
    candidates: list[Candidate],
    quantile: float,
) -> float:
    ordered = sorted(candidates, key=lambda candidate: candidate.end)
    total_weight = sum(_end_evidence_weight(candidate) for candidate in ordered)
    threshold = quantile * total_weight
    cumulative = 0.0
    for candidate in ordered:
        cumulative += _end_evidence_weight(candidate)
        if cumulative + 1e-12 >= threshold:
            return candidate.end
    return ordered[-1].end


def _huber_cost(value: float, center: float) -> float:
    residual = abs(value - center)
    if residual <= _END_HUBER_SECONDS:
        return 0.5 * residual * residual
    return _END_HUBER_SECONDS * (
        residual - 0.5 * _END_HUBER_SECONDS
    )


def _fuse_selected_ends(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
    selected: dict[int, Candidate],
    hard_barriers: list[tuple[float, float]],
    config: AlignConfig,
) -> tuple[dict[int, Candidate], dict[str, object]]:
    rate, duration_points, duration_inliers = _duration_prior(
        lyrics,
        candidates,
    )
    ordered_indexes = sorted(selected)
    fused = dict(selected)
    end_evidence_count = 0
    fused_count = 0
    duration_blend_count = 0
    evidence_group_histogram = {
        "0": 0,
        "1": 0,
        "2": 0,
        "3_plus": 0,
    }
    for ordinal, line_index in enumerate(ordered_indexes):
        chosen = selected[line_index]
        next_start = (
            selected[ordered_indexes[ordinal + 1]].start
            if ordinal + 1 < len(ordered_indexes)
            else math.inf
        )
        barrier_starts = [
            start
            for start, _end in hard_barriers
            if start >= chosen.start
        ]
        upper = min(next_start, min(barrier_starts, default=math.inf))
        evidence = [
            candidate
            for candidate in candidates.get(line_index, [])
            if abs(candidate.start - chosen.start)
            <= _END_START_CLUSTER_SECONDS
            and config.min_line_seconds
            <= candidate.end - chosen.start
            <= config.max_line_seconds
            and candidate.end <= upper + 1e-9
            and not _intersects(
                chosen.start,
                candidate.end,
                hard_barriers,
                config.forbidden_tolerance_seconds,
            )
            and candidate.boundary_support in {"word", "segment", "line"}
        ]
        capped = _cap_end_evidence(evidence)
        end_evidence_count += len(capped)
        if len(capped) >= 3:
            evidence_group_histogram["3_plus"] += 1
        else:
            evidence_group_histogram[str(len(capped))] += 1
        new_end = chosen.end
        if len(capped) >= 2:
            if config.end_fusion_method == "huber_medoid":
                new_end = min(
                    (candidate.end for candidate in capped),
                    key=lambda value: (
                        sum(
                            _huber_cost(other.end, value)
                            for other in capped
                        ),
                        abs(value - chosen.end),
                        value,
                    ),
                )
            else:
                new_end = _weighted_upper_quantile(
                    capped,
                    config.end_fusion_quantile,
                )
            fused_count += 1
        elif rate is not None:
            line = next(item for item in lyrics if item.index == line_index)
            predicted = chosen.start + max(1, len(line.normalized)) * rate
            new_end = (
                (1.0 - _DURATION_PRIOR_BLEND) * chosen.end
                + _DURATION_PRIOR_BLEND * predicted
            )
            duration_blend_count += 1
        maximum_end = min(
            chosen.start + config.max_line_seconds,
            upper,
        )
        minimum_end = chosen.start + config.min_line_seconds
        if maximum_end >= minimum_end:
            new_end = min(maximum_end, max(minimum_end, new_end))
            fused[line_index] = replace(chosen, end=new_end)
    return fused, {
        "end_evidence_count": end_evidence_count,
        "end_fused_count": fused_count,
        "duration_prior_point_count": duration_points,
        "duration_prior_inlier_count": duration_inliers,
        "duration_prior_blend_count": duration_blend_count,
        "end_fusion_method": config.end_fusion_method,
        "end_fusion_quantile": config.end_fusion_quantile,
        "fusion_evidence_group_histogram": evidence_group_histogram,
    }


def _usable_audio_span(
    duration: float,
    hard_barriers: list[tuple[float, float]],
) -> float:
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
    blocked = sum(end - start for start, end in merged)
    return max(1e-9, duration - blocked)


def select_global_lattice(
    lyrics: list[LyricLine],
    candidates: dict[int, list[Candidate]],
    duration: float,
    hard_barriers: list[tuple[float, float]],
    config: AlignConfig,
) -> tuple[dict[int, Candidate], dict[str, object]]:
    usable_audio_span = _usable_audio_span(
        duration,
        hard_barriers,
    )
    prior, progress, total_progress = _build_progress_prior(
        lyrics,
        candidates,
        duration,
        usable_audio_span,
        config,
    )
    valid_by_line = {
        line.index: [
            candidate
            for candidate in candidates.get(line.index, [])
            if _valid_candidate(
                candidate,
                duration,
                hard_barriers,
                config,
            )
        ]
        for line in lyrics
    }
    end_reliability = {
        id(candidate): _candidate_end_reliability(
            candidate,
            valid_by_line[line.index],
            hard_barriers,
            config,
        )
        for line in lyrics
        for candidate in valid_by_line[line.index]
    }
    raw_emissions = [
        _raw_emission_score(
            candidate,
            end_reliability.get(id(candidate), 0.0),
            config.lattice_end_reliability_weight,
        )
        for items in valid_by_line.values()
        for candidate in items
    ]
    emission_location = (
        statistics.median(raw_emissions)
        if raw_emissions
        else 1.0
    )
    deviations = [
        abs(value - emission_location)
        for value in raw_emissions
    ]
    emission_scale = max(
        0.25,
        1.4826 * (
            statistics.median(deviations)
            if deviations
            else 0.0
        ),
        abs(emission_location) * 0.15,
    )
    states = [
        _LatticeState(
            score=0.0,
            path=(),
            last_candidate=None,
            last_position=None,
            repeat_slots=frozenset(),
        )
    ]
    valid_count = sum(len(items) for items in valid_by_line.values())
    for position, line in enumerate(lyrics):
        valid = valid_by_line[line.index]
        next_states: list[_LatticeState] = []
        for state in states:
            next_states.append(
                _LatticeState(
                    score=(
                        state.score
                        - config.lattice_skip_relative_penalty
                    ),
                    path=(*state.path, None),
                    last_candidate=state.last_candidate,
                    last_position=state.last_position,
                    repeat_slots=state.repeat_slots,
                )
            )
            for candidate in valid:
                slot = _repeat_slot(line, candidate, config)
                if slot in state.repeat_slots:
                    continue
                transition = 0.0
                if (
                    state.last_candidate is not None
                    and state.last_position is not None
                ):
                    maybe_transition = _transition_score(
                        state.last_candidate,
                        state.last_position,
                        candidate,
                        position,
                        progress,
                        prior,
                        lyrics,
                    )
                    if maybe_transition is None:
                        continue
                    transition = maybe_transition
                predicted = prior.predict(progress[line.index])
                next_states.append(
                    _LatticeState(
                        score=(
                            state.score
                            + _emission_score(
                                candidate,
                                predicted,
                                prior,
                                emission_location,
                                emission_scale,
                                config,
                                end_reliability.get(id(candidate), 0.0),
                            )
                            + transition
                        ),
                        path=(*state.path, candidate),
                        last_candidate=candidate,
                        last_position=position,
                        repeat_slots=state.repeat_slots | {slot},
                    )
                )
        ordered = sorted(
            next_states,
            key=lambda state: (
                state.score,
                sum(
                    candidate is not None
                    for candidate in state.path
                ),
            ),
            reverse=True,
        )
        states = []
        signatures: set[
            tuple[tuple[float, float] | None, ...]
        ] = set()
        for state in ordered:
            signature = _path_signature(state.path)
            if signature in signatures:
                continue
            signatures.add(signature)
            states.append(state)
            if len(states) >= _LATTICE_BEAM_SIZE:
                break
    ordered_final = sorted(
        states,
        key=lambda state: (
            state.score,
            sum(candidate is not None for candidate in state.path),
        ),
        reverse=True,
    )
    best = ordered_final[0]
    selected_count = sum(
        candidate is not None for candidate in best.path
    )
    selected_ratio = (
        selected_count / len(lyrics)
        if lyrics
        else 0.0
    )
    margin = (
        best.score - ordered_final[1].score
        if len(ordered_final) > 1
        else None
    )
    robust_authority = (
        prior.mode == "robust_multi_hypothesis"
        and prior.valid
    )
    proportional_authority_opt_in = (
        prior.mode == "proportional_fallback"
        and prior.valid
        and config.allow_proportional_authoritative_lattice
    )
    authority_allowed = (
        robust_authority or proportional_authority_opt_in
    )
    if robust_authority:
        authority_reason = "validated_robust_progress_prior"
    elif proportional_authority_opt_in:
        authority_reason = "proportional_fallback_explicit_opt_in"
    elif prior.mode == "proportional_fallback":
        authority_reason = "proportional_fallback_diagnostic_only"
    else:
        authority_reason = "invalid_progress_prior"

    acceptance_reason = "accepted"
    if selected_ratio < config.lattice_min_selected_ratio:
        acceptance_reason = "insufficient_selected_ratio"
    elif config.lattice_require_valid_prior and not prior.valid:
        acceptance_reason = "invalid_progress_prior"
    elif not authority_allowed:
        acceptance_reason = "progress_prior_not_authoritative"
    accepted = acceptance_reason == "accepted"
    top_paths = ordered_final[: config.lattice_path_summary_count]
    top_path_accepted_scores: list[float] = []
    top_path_rejected_scores: list[float] = []
    for state in top_paths:
        state_ratio = (
            sum(candidate is not None for candidate in state.path)
            / len(lyrics)
            if lyrics
            else 0.0
        )
        state_accepted = (
            state_ratio >= config.lattice_min_selected_ratio
            and (
                not config.lattice_require_valid_prior
                or prior.valid
            )
            and authority_allowed
        )
        (
            top_path_accepted_scores
            if state_accepted
            else top_path_rejected_scores
        ).append(state.score)

    def score_aggregate(values: list[float]) -> dict[str, float | int | None]:
        return {
            "count": len(values),
            "sum": sum(values),
            "mean": statistics.fmean(values) if values else None,
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }

    predicted_span = prior.rate * total_progress
    base_diagnostics: dict[str, object] = {
        "candidate_count": sum(
            len(candidates.get(line.index, [])) for line in lyrics
        ),
        "valid_candidate_count": valid_count,
        "selected_count": selected_count,
        "accepted_selected_count": (
            selected_count if accepted else 0
        ),
        "rejected_selected_count": (
            0 if accepted else selected_count
        ),
        "skipped_count": len(lyrics) - selected_count,
        "selected_ratio": selected_ratio,
        "path_score": best.score,
        "path_margin": margin,
        "prior_point_count": prior.point_count,
        "prior_inlier_count": prior.inlier_count,
        "prior_inlier_line_count": prior.inlier_line_count,
        "prior_mode": prior.mode,
        "prior_valid": prior.valid,
        "prior_valid_authoritative": robust_authority,
        "authority_allowed": authority_allowed,
        "authority_reason": authority_reason,
        "proportional_authority_opt_in": (
            proportional_authority_opt_in
        ),
        "prior_validation_reason": prior.validation_reason,
        "prior_validation_subreasons": [prior.validation_reason],
        "prior_rate": prior.rate,
        "prior_intercept": prior.intercept,
        "usable_audio_span_seconds": usable_audio_span,
        "prior_predicted_span_seconds": predicted_span,
        "prior_predicted_span_ratio": (
            predicted_span / usable_audio_span
            if usable_audio_span > 0
            else None
        ),
        "top_path_count": len(top_paths),
        "top_path_score_aggregates": {
            "accepted": score_aggregate(top_path_accepted_scores),
            "rejected": score_aggregate(top_path_rejected_scores),
        },
        "coverage_sufficient": (
            selected_ratio >= config.lattice_min_selected_ratio
        ),
        "accepted": accepted,
        "acceptance_reason": acceptance_reason,
        "lineage_counts": {
            "accepted": selected_count if accepted else 0,
            "injected": 0,
            "rejected": 0 if accepted else selected_count,
            "overridden": 0,
            "actual_used": 0,
        },
    }
    empty_fusion = {
        "end_evidence_count": 0,
        "end_fused_count": 0,
        "duration_prior_point_count": 0,
        "duration_prior_inlier_count": 0,
        "duration_prior_blend_count": 0,
        "end_fusion_method": config.end_fusion_method,
        "end_fusion_quantile": config.end_fusion_quantile,
        "fusion_evidence_group_histogram": {
            "0": 0,
            "1": 0,
            "2": 0,
            "3_plus": 0,
        },
        "top_path_agreement_histogram": {
            "0.00-0.25": 0,
            "0.25-0.50": 0,
            "0.50-0.75": 0,
            "0.75-1.00": 0,
        },
        "remote_disagreement_line_count": 0,
    }
    if not accepted:
        return {}, {**base_diagnostics, **empty_fusion}
    selected: dict[int, Candidate] = {}
    agreement_histogram = {
        "0.00-0.25": 0,
        "0.25-0.50": 0,
        "0.50-0.75": 0,
        "0.75-1.00": 0,
    }
    remote_disagreement_line_count = 0
    for position, (line, path_candidate) in enumerate(
        zip(lyrics, best.path, strict=True)
    ):
        if path_candidate is None:
            continue
        agreeing_votes = 0
        remote_votes = 0
        for state in top_paths:
            alternative = state.path[position]
            if alternative is None:
                continue
            if (
                abs(alternative.start - path_candidate.start)
                <= config.consensus_cluster_seconds
            ):
                agreeing_votes += 1
            else:
                remote_votes += 1
        vote_count = len(top_paths)
        agreement = (
            agreeing_votes / vote_count
            if vote_count
            else 1.0
        )
        if agreement < 0.25:
            bucket = "0.00-0.25"
        elif agreement < 0.50:
            bucket = "0.25-0.50"
        elif agreement < 0.75:
            bucket = "0.50-0.75"
        else:
            bucket = "0.75-1.00"
        agreement_histogram[bucket] += 1
        path_confidence = (
            agreement
            * (0.50 if proportional_authority_opt_in else 1.0)
        )
        remote_disagreement = remote_votes > 0
        if remote_disagreement:
            remote_disagreement_line_count += 1
        markers = ["global_lattice_path_selected"]
        if proportional_authority_opt_in:
            markers.append(
                "global_lattice_proportional_authority_opt_in"
            )
        if path_confidence < 0.60:
            markers.append("global_lattice_low_path_agreement")
        if remote_disagreement:
            markers.append("global_lattice_remote_path_disagreement")
        selected[line.index] = replace(
            path_candidate,
            provenance=tuple(
                dict.fromkeys((*path_candidate.provenance, *markers))
            ),
            lattice_path_confidence=path_confidence,
            lattice_remote_disagreement=remote_disagreement,
            lattice_top_path_votes=vote_count,
            lattice_top_path_agreeing_votes=agreeing_votes,
        )
    base_diagnostics["top_path_agreement_histogram"] = agreement_histogram
    base_diagnostics["remote_disagreement_line_count"] = (
        remote_disagreement_line_count
    )
    fused, fusion_diagnostics = _fuse_selected_ends(
        lyrics,
        candidates,
        selected,
        hard_barriers,
        config,
    )
    return fused, {**base_diagnostics, **fusion_diagnostics}

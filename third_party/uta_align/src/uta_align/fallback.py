from __future__ import annotations

import math
from dataclasses import dataclass, replace

import numpy as np

from .alignment import AlignmentError, interval_intersects, validate_alignment
from .config import AlignConfig
from .models import AlignedLine, Candidate, LyricLine


@dataclass(frozen=True)
class FallbackOutcome:
    lines: list[AlignedLine]
    stage: int
    diagnostics: dict[str, object]


@dataclass(frozen=True)
class _StageFourRunChunk:
    component: int
    left: float
    right: float
    offset: int
    count: int
    starts: tuple[float, ...]
    durations: tuple[float, ...]
    compression_loss: float
    soft_overlap: float
    squared_error: float


def _safe_intervals(
    duration: float,
    forbidden: list[tuple[float, float]],
    tolerance: float,
) -> list[tuple[float, float]]:
    merged: list[tuple[float, float]] = []
    for start, end in sorted(forbidden):
        start = max(0.0, start)
        end = min(duration, end)
        if end - start <= tolerance:
            continue
        if merged and start <= merged[-1][1] + tolerance:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    safe: list[tuple[float, float]] = []
    cursor = 0.0
    for start, end in merged:
        if start - cursor > tolerance:
            safe.append((cursor, start))
        cursor = max(cursor, end)
    if duration - cursor > tolerance:
        safe.append((cursor, duration))
    return safe


def _candidate_line(
    line: LyricLine,
    candidate: Candidate,
    *,
    stage: int,
    confidence: float,
    reason: str,
) -> AlignedLine:
    return AlignedLine(
        index=line.index,
        block=line.block,
        text=line.text,
        start=candidate.start,
        end=candidate.end,
        confidence=confidence,
        provenance=[
            *candidate.provenance,
            f"fallback_stage_{stage}_relaxed_assignment",
        ],
        diagnostics={
            "anchored": True,
            "fallback_stage": stage,
            "fallback_reason": reason,
            "text_similarity": candidate.similarity,
            "boundary_support": candidate.boundary_support,
        },
    )


def _stage_two(
    lyrics: list[LyricLine],
    anchors: dict[int, Candidate],
    duration: float,
    forbidden: list[tuple[float, float]],
    config: AlignConfig,
    reason: str,
) -> FallbackOutcome | None:
    if len(anchors) != len(lyrics):
        return None
    if any(not candidate.freeze_eligible for candidate in anchors.values()):
        return None
    lines: list[AlignedLine] = []
    previous_end = 0.0
    for line in lyrics:
        candidate = anchors[line.index]
        if not 0 <= candidate.start < candidate.end <= duration:
            return None
        if candidate.start < previous_end:
            return None
        if not (
            config.min_line_seconds
            <= candidate.end - candidate.start
            <= config.max_line_seconds
        ):
            return None
        if interval_intersects(
            candidate.start,
            candidate.end,
            forbidden,
            config.forbidden_tolerance_seconds,
        ):
            return None
        confidence = min(
            0.46,
            max(0.20, candidate.confidence * candidate.similarity * 0.48),
        )
        lines.append(
            _candidate_line(
                line,
                candidate,
                stage=2,
                confidence=confidence,
                reason=reason,
            )
        )
        previous_end = candidate.end
    try:
        validate_alignment(lines, duration, forbidden, config)
    except AlignmentError:
        return None
    return FallbackOutcome(
        lines=lines,
        stage=2,
        diagnostics={
            "reason_code": "relaxed_ordered_assignment",
            "affected_lyric_line_indexes": [line.index for line in lyrics],
            "warnings": [
                "Strict ambiguity or boundary checks were relaxed; timestamps may be inaccurate."
            ],
        },
    )


def _safe_component_index(
    candidate: Candidate,
    safe_intervals: list[tuple[float, float]],
    tolerance: float,
) -> int | None:
    for index, (left, right) in enumerate(safe_intervals):
        if (
            candidate.start >= left - tolerance
            and candidate.end <= right + tolerance
        ):
            return index
    return None


def _freeze_valid_anchors(
    anchors: dict[int, Candidate],
    duration: float,
    forbidden: list[tuple[float, float]],
    safe_intervals: list[tuple[float, float]],
    config: AlignConfig,
    *,
    tolerance: float | None = None,
) -> tuple[dict[int, Candidate], dict[int, int], list[dict[str, object]]]:
    effective_tolerance = (
        config.forbidden_tolerance_seconds
        if tolerance is None
        else tolerance
    )
    valid: list[tuple[int, Candidate, int]] = []
    demoted: list[dict[str, object]] = []
    for line_index, candidate in sorted(anchors.items()):
        reason: str | None = None
        component = _safe_component_index(
            candidate,
            safe_intervals,
            effective_tolerance,
        )
        if not candidate.freeze_eligible:
            reason = candidate.quality_reason
        elif not 0 <= candidate.start < candidate.end <= duration:
            reason = "outside_audio_bounds"
        elif not (
            config.min_line_seconds
            <= candidate.end - candidate.start
            <= config.max_line_seconds
        ):
            reason = "duration_outside_configured_bounds"
        elif interval_intersects(
            candidate.start,
            candidate.end,
            forbidden,
            effective_tolerance,
        ):
            reason = "forbidden_interval_collision"
        elif component is None:
            reason = "not_contained_in_one_safe_component"
        if reason is not None:
            demoted.append(
                {
                    "lyric_line_index": line_index,
                    "reason": reason,
                    "original_time": [candidate.start, candidate.end],
                    "quality_score": candidate.quality_score,
                    "support_count": candidate.support_count,
                    "dispersion_seconds": candidate.time_dispersion,
                    "freeze_eligible": candidate.freeze_eligible,
                    "quality_reason": candidate.quality_reason,
                }
            )
            continue
        assert component is not None
        valid.append((line_index, candidate, component))
    if not valid:
        return {}, {}, demoted

    best_paths: list[tuple[int, float, float, tuple[int, ...]]] = []
    for index, (_, candidate, _) in enumerate(valid):
        best: tuple[int, float, float, tuple[int, ...]] = (
            1,
            candidate.quality_score,
            candidate.score,
            (index,),
        )
        for previous_index in range(index):
            _, previous, _ = valid[previous_index]
            if previous.end > candidate.start:
                continue
            previous_best = best_paths[previous_index]
            proposal = (
                previous_best[0] + 1,
                previous_best[1] + candidate.quality_score,
                previous_best[2] + candidate.score,
                (*previous_best[3], index),
            )
            if proposal[:3] > best[:3]:
                best = proposal
        best_paths.append(best)
    selected_path = max(best_paths, key=lambda item: item[:3])[3]
    selected = set(selected_path)
    frozen: dict[int, Candidate] = {}
    components: dict[int, int] = {}
    for index, (line_index, candidate, component) in enumerate(valid):
        if index in selected:
            frozen[line_index] = candidate
            components[line_index] = component
        else:
            demoted.append(
                {
                    "lyric_line_index": line_index,
                    "reason": "monotonic_order_conflict",
                    "original_time": [candidate.start, candidate.end],
                    "quality_score": candidate.quality_score,
                    "support_count": candidate.support_count,
                    "dispersion_seconds": candidate.time_dispersion,
                    "freeze_eligible": candidate.freeze_eligible,
                    "quality_reason": candidate.quality_reason,
                }
            )
    return frozen, components, demoted


_SEMANTIC_CONFLICT_HINT_REASONS = {
    "ambiguous_timing_candidates",
    "competing_temporal_clusters",
    "forbidden_interval_collision",
    "monotonic_order_conflict",
    "global_lattice_path_conflict",
    "not_contained_in_one_safe_component",
    "outside_audio_bounds",
    "slot_count_or_order_is_not_unique",
    "stage_four_zero_capacity_adjacent_to_frozen_anchor",
    "strong_local_ambiguity",
    "unresolved_repetition_group",
    "unresolved_repetition_group_requires_group_demotion",
}

_LOCAL_ONLY_HINT_REASONS = {
    "consensus_duration_outside_configured_bounds",
    "segment_similarity_below_freeze_threshold",
    "segment_insufficient_decorrelated_support",
    "segment_insufficient_strategy_diversity",
    "segment_without_word_corroboration",
    "prompt_only_candidate_not_freeze_eligible",
    "global_lattice_local_provisional",
    "global_lattice_authoritative_local",
    "absolute_progress_outlier",
}


def _is_semantically_conflicted_hint(candidate: Candidate) -> bool:
    reason = candidate.quality_reason
    return (
        reason in _SEMANTIC_CONFLICT_HINT_REASONS
        or "ambiguity" in reason
        or reason.startswith("unresolved_repetition")
    )


def _is_strong_ambiguity_demotion_reason(reason: str) -> bool:
    return reason in {
        "strong_local_ambiguity",
        "unresolved_repetition_group",
    }


def _is_high_quality_provisional_hint(
    candidate: Candidate,
    config: AlignConfig,
) -> bool:
    return (
        not _is_semantically_conflicted_hint(candidate)
        and candidate.quality_reason not in _LOCAL_ONLY_HINT_REASONS
        and not candidate.quality_reason.startswith(
            "global_lattice_authoritative_local"
        )
        and candidate.end > candidate.start
        and candidate.end - candidate.start <= config.max_line_seconds
        and candidate.similarity >= config.anchor_similarity
        and candidate.no_speech_prob < 0.45
        and candidate.quality_score >= config.consensus_min_quality
        and candidate.support_count
        >= config.consensus_min_independent_support
        and candidate.time_dispersion
        <= config.consensus_max_dispersion_seconds
        and candidate.boundary_support in {"segment", "line"}
    )


def _maximum_monotonic_hint_chain(
    entries: list[tuple[int, int, float, Candidate]],
) -> list[tuple[int, int, float, Candidate]]:
    if not entries:
        return []
    paths: list[list[tuple[int, int, float, Candidate]]] = []
    scores: list[tuple[int, float, int, float, float]] = []
    for item_index, item in enumerate(entries):
        _position, component, center, candidate = item
        best_path = [item]
        best_score = (
            1,
            candidate.quality_score,
            candidate.support_count,
            -candidate.time_dispersion,
            -candidate.no_speech_prob,
        )
        for previous_index in range(item_index):
            previous = entries[previous_index]
            previous_component = previous[1]
            previous_center = previous[2]
            if (
                previous_component > component
                or previous_center >= center - 1e-12
            ):
                continue
            previous_score = scores[previous_index]
            candidate_score = (
                previous_score[0] + 1,
                previous_score[1] + candidate.quality_score,
                previous_score[2] + candidate.support_count,
                previous_score[3] - candidate.time_dispersion,
                previous_score[4] - candidate.no_speech_prob,
            )
            if candidate_score > best_score:
                best_score = candidate_score
                best_path = [*paths[previous_index], item]
        paths.append(best_path)
        scores.append(best_score)
    selected_index = max(
        range(len(entries)),
        key=lambda index: scores[index],
    )
    return paths[selected_index]


def _bounded_provisional_center(
    value: float,
    duration: float,
    lower: float,
    upper: float,
) -> float:
    if upper - lower >= duration:
        return min(upper - duration / 2, max(lower + duration / 2, value))
    return (lower + upper) / 2


def _apply_direct_hint_geometry(
    centers: list[float],
    durations: list[float],
    run_positions: list[int],
    selected: list[tuple[int, int, float, Candidate]],
    lower: float,
    upper: float,
) -> None:
    for position, _component, center, _candidate in selected:
        centers[position] = center
    if len(selected) < 2:
        return
    selected_by_position = sorted(selected)
    for position in run_positions:
        if any(item[0] == position for item in selected_by_position):
            continue
        if position < selected_by_position[0][0]:
            left = selected_by_position[0]
            right = selected_by_position[1]
        elif position > selected_by_position[-1][0]:
            left = selected_by_position[-2]
            right = selected_by_position[-1]
        else:
            pairs = zip(
                selected_by_position,
                selected_by_position[1:],
                strict=False,
            )
            left, right = next(
                (first, second)
                for first, second in pairs
                if first[0] < position < second[0]
            )
        slope = (right[2] - left[2]) / (right[0] - left[0])
        estimated = left[2] + slope * (position - left[0])
        centers[position] = _bounded_provisional_center(
            estimated,
            durations[position],
            lower,
            upper,
        )


def _safe_capacity_center(
    fraction: float,
    line_duration: float,
    spans: list[tuple[int, float, float]],
) -> float | None:
    total_capacity = sum(right - left for _, left, right in spans)
    if total_capacity <= 0:
        return None
    target = min(
        total_capacity,
        max(0.0, fraction * total_capacity),
    )
    elapsed = 0.0
    for span_index, (_component, left, right) in enumerate(spans):
        capacity = right - left
        if target <= elapsed + capacity or span_index == len(spans) - 1:
            raw_center = left + min(capacity, max(0.0, target - elapsed))
            if capacity >= line_duration:
                return min(
                    right - line_duration / 2,
                    max(left + line_duration / 2, raw_center),
                )
            return (left + right) / 2
        elapsed += capacity
    return None


def _spread_run_centers(
    centers: list[float],
    durations: list[float],
    weights: list[float],
    run_positions: list[int],
    spans: list[tuple[int, float, float]],
) -> None:
    if not run_positions or not spans:
        return
    run_weights = [weights[position] for position in run_positions]
    edge_weight = max(1.0, float(np.median(run_weights))) / 2
    denominator = sum(run_weights) + 2 * edge_weight
    cumulative = edge_weight
    for position, weight in zip(
        run_positions,
        run_weights,
        strict=True,
    ):
        fraction = (cumulative + weight / 2) / denominator
        center = _safe_capacity_center(
            fraction,
            durations[position],
            spans,
        )
        if center is not None:
            centers[position] = center
        cumulative += weight


def _desired_centers(
    lyrics: list[LyricLine],
    anchors: dict[int, Candidate],
    hints: dict[int, Candidate],
    safe_intervals: list[tuple[float, float]],
    duration: float,
    config: AlignConfig,
    preferred_intervals: list[tuple[float, float]] | None = None,
    soft_intervals: list[tuple[float, float]] | None = None,
) -> tuple[list[float], list[float], dict[int, float]]:
    weights = [max(1.0, len(line.normalized) ** 0.72) for line in lyrics]
    position_by_index = {
        line.index: position for position, line in enumerate(lyrics)
    }
    anchor_positions = sorted(position_by_index[index] for index in anchors)
    observed_durations = [
        candidate.end - candidate.start for candidate in anchors.values()
    ]
    typical_duration = (
        float(np.median(observed_durations))
        if observed_durations
        else 0.8
    )
    typical_duration = min(3.0, max(0.35, typical_duration))
    median_weight = max(1.0, float(np.median(weights)))
    centers = [0.0] * len(lyrics)
    durations = [
        min(3.0, max(0.35, typical_duration * weight / median_weight))
        for weight in weights
    ]
    for line_index, candidate in anchors.items():
        position = position_by_index[line_index]
        centers[position] = (candidate.start + candidate.end) / 2
        durations[position] = candidate.end - candidate.start
    for position in range(len(lyrics)):
        if position in anchor_positions:
            continue
        if not anchor_positions:
            centers[position] = (
                duration * (position + 0.5) / max(1, len(lyrics))
            )
            continue
        left_positions = [item for item in anchor_positions if item < position]
        right_positions = [item for item in anchor_positions if item > position]
        if left_positions and right_positions:
            left = left_positions[-1]
            right = right_positions[0]
            fraction = (position - left) / (right - left)
            centers[position] = (
                centers[left]
                + fraction * (centers[right] - centers[left])
            )
        elif right_positions:
            right = right_positions[0]
            centers[position] = max(
                0.0,
                centers[right] - sum(durations[position:right]),
            )
        else:
            left = left_positions[-1]
            centers[position] = min(
                duration,
                centers[left] + sum(durations[left + 1 : position + 1]),
            )

    weak_hint_centers: dict[int, float] = {}
    effective_soft_for_hints = _effective_soft_intervals(
        soft_intervals or [],
        preferred_intervals or [],
    )
    semantic_conflict_indexes = {
        line_index
        for line_index, hint in hints.items()
        if _is_semantically_conflicted_hint(hint)
    }
    authoritative_lattice_indexes = {
        line_index
        for line_index, hint in hints.items()
        if hint.quality_reason.startswith(
            "global_lattice_authoritative_local"
        )
    }
    high_quality_indexes = {
        line_index
        for line_index, hint in hints.items()
        if line_index in position_by_index
        and line_index not in anchors
        and _is_high_quality_provisional_hint(hint, config)
    }
    boundaries = [-1, *anchor_positions, len(lyrics)]
    for left_position, right_position in zip(
        boundaries,
        boundaries[1:],
        strict=False,
    ):
        run_positions = list(range(left_position + 1, right_position))
        if not run_positions:
            continue
        lower = (
            anchors[lyrics[left_position].index].end
            if left_position >= 0
            else 0.0
        )
        upper = (
            anchors[lyrics[right_position].index].start
            if right_position < len(lyrics)
            else duration
        )
        run_spans = _bounded_spans(
            safe_intervals,
            lower,
            upper,
            0.0,
        )
        preferred_spans: list[tuple[int, float, float]] = []
        for preferred_left, preferred_right in preferred_intervals or []:
            for _safe_component, safe_left, safe_right in run_spans:
                preferred_start = max(preferred_left, safe_left)
                preferred_end = min(preferred_right, safe_right)
                if preferred_end > preferred_start:
                    preferred_spans.append(
                        (
                            len(preferred_spans),
                            preferred_start,
                            preferred_end,
                        )
                    )
        distribution_spans = preferred_spans or run_spans
        if (
            not preferred_spans
            and left_position < 0
            and right_position < len(lyrics)
            and run_spans
        ):
            distribution_spans = [run_spans[-1]]
        elif (
            not preferred_spans
            and left_position >= 0
            and right_position == len(lyrics)
            and run_spans
        ):
            distribution_spans = [run_spans[0]]
        _spread_run_centers(
            centers,
            durations,
            weights,
            run_positions,
            distribution_spans,
        )
        for position in run_positions:
            line_index = lyrics[position].index
            if line_index not in authoritative_lattice_indexes:
                continue
            hint = hints[line_index]
            component = _safe_component_index(
                hint,
                safe_intervals,
                0.0,
            )
            if (
                component is None
                or hint.start < lower
                or hint.end > upper
            ):
                continue
            centers[position] = (hint.start + hint.end) / 2
            durations[position] = hint.end - hint.start
            weak_hint_centers[line_index] = centers[position]
        entries: list[tuple[int, int, float, Candidate]] = []
        for position in run_positions:
            line_index = lyrics[position].index
            if line_index not in high_quality_indexes:
                continue
            hint = hints[line_index]
            component = _safe_component_index(
                hint,
                safe_intervals,
                0.0,
            )
            if (
                component is None
                or hint.start < lower
                or hint.end > upper
            ):
                continue
            entries.append(
                (
                    position,
                    component,
                    (hint.start + hint.end) / 2,
                    hint,
                )
            )
        selected = _maximum_monotonic_hint_chain(entries)
        _apply_direct_hint_geometry(
            centers,
            durations,
            run_positions,
            selected,
            lower,
            upper,
        )
        for position, _component, center, _candidate in selected:
            weak_hint_centers[lyrics[position].index] = center

    for line_index, hint in hints.items():
        if (
            line_index in anchors
            or line_index not in position_by_index
            or line_index in high_quality_indexes
            or line_index in authoritative_lattice_indexes
            or line_index in semantic_conflict_indexes
        ):
            continue
        component = _safe_component_index(hint, safe_intervals, 0.0)
        if component is None:
            continue
        position = position_by_index[line_index]
        left_bounds = [
            candidate.end
            for anchor_index, candidate in anchors.items()
            if position_by_index[anchor_index] < position
        ]
        right_bounds = [
            candidate.start
            for anchor_index, candidate in anchors.items()
            if position_by_index[anchor_index] > position
        ]
        lower = max(left_bounds, default=0.0)
        upper = min(right_bounds, default=duration)
        if hint.start < lower or hint.end > upper:
            continue
        hint_center = (hint.start + hint.end) / 2
        hint_weight = min(
            0.45,
            max(0.10, hint.quality_score * 0.40),
        )
        if (
            hint.support_count
            < config.consensus_min_independent_support
            and any(
                soft_left <= hint_center <= soft_right
                for soft_left, soft_right in effective_soft_for_hints
            )
        ):
            hint_weight *= 0.20
        centers[position] = (
            (1.0 - hint_weight) * centers[position]
            + hint_weight * hint_center
        )
        weak_hint_centers[line_index] = hint_center
    return centers, durations, weak_hint_centers


def _bounded_spans(
    safe_intervals: list[tuple[float, float]],
    lower: float,
    upper: float,
    tolerance: float,
) -> list[tuple[int, float, float]]:
    spans: list[tuple[int, float, float]] = []
    for component, (left, right) in enumerate(safe_intervals):
        start = max(left, lower)
        end = min(right, upper)
        if end - start > tolerance:
            spans.append((component, start, end))
    return spans


def _place_unanchored_run(
    lines: list[LyricLine],
    positions: list[int],
    centers: list[float],
    durations: list[float],
    spans: list[tuple[int, float, float]],
    config: AlignConfig,
    reason: str,
    demoted_reasons: dict[int, str],
    strong_demoted_indexes: set[int],
    weak_hint_centers: dict[int, float],
) -> list[AlignedLine] | None:
    if not lines:
        return []
    minimum = config.min_line_seconds
    if sum(math.floor((right - left + 1e-9) / minimum) for _, left, right in spans) < len(lines):
        return None
    cursor = spans[0][1] if spans else 0.0
    output: list[AlignedLine] = []
    for sequence, (line, position) in enumerate(zip(lines, positions, strict=True)):
        remaining = len(lines) - sequence - 1
        desired_duration = min(
            config.max_line_seconds,
            max(minimum, durations[position]),
        )
        choices: list[tuple[float, int, float, float, int]] = []
        for span_index, (component, raw_left, right) in enumerate(spans):
            left = max(raw_left, cursor)
            if right - left < minimum:
                continue
            later_slots = sum(
                math.floor((later_right - later_left + 1e-9) / minimum)
                for _, later_left, later_right in spans[span_index + 1 :]
            )
            required_here = max(0, remaining - later_slots)
            maximum_end = right - required_here * minimum
            for line_duration in dict.fromkeys((desired_duration, minimum)):
                if maximum_end - left < line_duration - 1e-9:
                    continue
                latest_start = maximum_end - line_duration
                desired_start = centers[position] - line_duration / 2
                start = min(latest_start, max(left, desired_start))
                end = start + line_duration
                distance = abs((start + end) / 2 - centers[position])
                choices.append((distance, span_index, start, end, component))
                break
        if not choices:
            return None
        _, _, start, end, component = min(
            choices,
            key=lambda item: (item[0], item[1], item[2]),
        )
        demoted_reason = demoted_reasons.get(line.index)
        demoted_reason_text = demoted_reason or ""
        authoritative_lattice_used = (
            isinstance(demoted_reason, str)
            and demoted_reason.startswith(
                "global_lattice_authoritative_local"
            )
            and line.index in weak_hint_centers
        )
        remote_lattice_disagreement = (
            authoritative_lattice_used
            and demoted_reason_text.endswith("remote_disagreement")
        )
        low_lattice_agreement = (
            authoritative_lattice_used
            and (
                remote_lattice_disagreement
                or demoted_reason_text.endswith("low_agreement")
            )
        )
        output.append(
            AlignedLine(
                index=line.index,
                block=line.block,
                text=line.text,
                start=start,
                end=end,
                confidence=(
                    0.04
                    if remote_lattice_disagreement
                    else 0.06
                    if low_lattice_agreement
                    else 0.10
                    if demoted_reason
                    else 0.14
                ),
                provenance=[
                    *(
                        ["fallback_strong_demoted"]
                        if line.index in strong_demoted_indexes
                        else []
                    ),
                    *(
                        ["fallback_weak_hint_used"]
                        if line.index in weak_hint_centers
                        else []
                    ),
                    *(
                        ["fallback_global_lattice_local_used"]
                        if authoritative_lattice_used
                        else []
                    ),
                    *(
                        ["fallback_global_lattice_low_path_agreement"]
                        if low_lattice_agreement
                        else []
                    ),
                    *(
                        ["fallback_lattice_remote_path_disagreement"]
                        if remote_lattice_disagreement
                        else []
                    ),
                    "fallback_stage_3_anchor_interpolation",
                ],
                diagnostics={
                    "anchored": False,
                    "fallback_stage": 3,
                    "fallback_reason": reason,
                    "desired_center": centers[position],
                    "safe_component_index": component,
                    "demoted_anchor_reason": demoted_reason,
                    "weak_hint_center": weak_hint_centers.get(line.index),
                    "global_lattice_local_used": (
                        authoritative_lattice_used
                    ),
                    "global_lattice_remote_path_disagreement": (
                        remote_lattice_disagreement
                    ),
                    "global_lattice_low_path_agreement": (
                        low_lattice_agreement
                    ),
                },
            )
        )
        cursor = end
    return output


def _stage_three(
    lyrics: list[LyricLine],
    frozen_anchors: dict[int, Candidate],
    weak_hints: dict[int, Candidate],
    duration: float,
    forbidden: list[tuple[float, float]],
    activity_components: list[tuple[float, float]],
    config: AlignConfig,
    reason: str,
) -> FallbackOutcome | None:
    if not frozen_anchors:
        return None
    safe_intervals = _safe_intervals(
        duration,
        forbidden,
        config.forbidden_tolerance_seconds,
    )
    frozen, frozen_components, demoted = _freeze_valid_anchors(
        frozen_anchors,
        duration,
        forbidden,
        safe_intervals,
        config,
    )
    if not frozen:
        return None
    demoted_reasons: dict[int, str] = {}
    for decision in demoted:
        decision_line_index = decision.get("lyric_line_index")
        demotion_reason = decision.get("reason")
        if isinstance(decision_line_index, int) and isinstance(
            demotion_reason,
            str,
        ):
            demoted_reasons[decision_line_index] = demotion_reason
    for line_index, hint in weak_hints.items():
        demoted_reasons.setdefault(line_index, hint.quality_reason)
    hint_candidates = dict(weak_hints)
    for line_index, candidate in frozen_anchors.items():
        if line_index not in frozen:
            hint_candidates.setdefault(
                line_index,
                replace(
                    candidate,
                    freeze_eligible=False,
                    quality_reason=demoted_reasons.get(
                        line_index,
                        candidate.quality_reason,
                    ),
                ),
            )
    centers, durations, weak_hint_centers = _desired_centers(
        lyrics,
        frozen,
        hint_candidates,
        safe_intervals,
        duration,
        config,
        activity_components,
    )
    position_by_index = {
        line.index: position for position, line in enumerate(lyrics)
    }
    strong_demoted_indexes = {
        decision_line_index
        for decision in demoted
        if isinstance(
            decision_line_index := decision.get("lyric_line_index"),
            int,
        )
    }
    strong_demoted_indexes.update(
        line_index
        for line_index, hint in weak_hints.items()
        if _is_strong_ambiguity_demotion_reason(
            hint.quality_reason
        )
    )
    aligned: dict[int, AlignedLine] = {}
    for line in lyrics:
        selected_candidate = frozen.get(line.index)
        if selected_candidate is None:
            continue
        aligned[line.index] = AlignedLine(
            index=line.index,
            block=line.block,
            text=line.text,
            start=selected_candidate.start,
            end=selected_candidate.end,
            confidence=min(
                0.34,
                selected_candidate.confidence
                * selected_candidate.similarity
                * 0.36,
            ),
            provenance=[
                *selected_candidate.provenance,
                "fallback_stage_3_anchor_frozen",
            ],
            diagnostics={
                "anchored": True,
                "fallback_stage": 3,
                "fallback_reason": reason,
                "safe_component_index": frozen_components[line.index],
                "original_anchor_time": [
                    selected_candidate.start,
                    selected_candidate.end,
                ],
                "consensus_quality_score": selected_candidate.quality_score,
                "consensus_support_count": selected_candidate.support_count,
                "consensus_dispersion_seconds": selected_candidate.time_dispersion,
                "consensus_quality_reason": selected_candidate.quality_reason,
            },
        )

    frozen_positions = sorted(position_by_index[index] for index in frozen)
    boundaries = [-1, *frozen_positions, len(lyrics)]
    for left_position, right_position in zip(boundaries, boundaries[1:], strict=False):
        missing_positions = list(range(left_position + 1, right_position))
        if not missing_positions:
            continue
        lower = (
            aligned[lyrics[left_position].index].end
            if left_position >= 0
            else 0.0
        )
        upper = (
            aligned[lyrics[right_position].index].start
            if right_position < len(lyrics)
            else duration
        )
        spans = _bounded_spans(
            safe_intervals,
            lower,
            upper,
            config.forbidden_tolerance_seconds,
        )
        run_lines = [lyrics[position] for position in missing_positions]
        placed = _place_unanchored_run(
            run_lines,
            missing_positions,
            centers,
            durations,
            spans,
            config,
            reason,
            demoted_reasons,
            strong_demoted_indexes,
            weak_hint_centers,
        )
        if placed is None:
            return None
        for item in placed:
            aligned[item.index] = item
    result = [aligned[line.index] for line in lyrics]
    try:
        validate_alignment(result, duration, forbidden, config)
    except AlignmentError:
        return None
    return FallbackOutcome(
        lines=result,
        stage=3,
        diagnostics={
            "reason_code": "anchor_interpolation_and_extrapolation",
            "affected_lyric_line_indexes": [line.index for line in lyrics],
            "safe_intervals": [list(interval) for interval in safe_intervals],
            "trusted_activity_components": [
                list(interval) for interval in activity_components
            ],
            "trusted_activity_preferred": bool(activity_components),
            "strong_selected_count": len(frozen_anchors),
            "strong_frozen_count": len(frozen),
            "strong_demoted_count": len(demoted),
            "weak_hint_count": len(weak_hints),
            "frozen_anchor_line_indexes": sorted(frozen),
            "demoted_anchors": demoted,
            "weak_hint_line_indexes": sorted(weak_hint_centers),
            "warnings": [
                "Valid anchors were frozen in their original safe components; "
                "other timestamps were inferred."
            ],
        },
    )


def _bounded_weighted_durations(
    total: float,
    weights: list[float],
    maximum: float,
) -> list[float]:
    if not weights:
        return []
    target = min(total, maximum * len(weights))
    remaining = target
    active = set(range(len(weights)))
    durations = [0.0] * len(weights)
    while active:
        weight_sum = sum(weights[index] for index in active)
        changed = False
        for index in list(active):
            proposed = remaining * weights[index] / weight_sum
            if proposed > maximum:
                durations[index] = maximum
                remaining -= maximum
                active.remove(index)
                changed = True
        if not changed:
            weight_sum = sum(weights[index] for index in active)
            for index in active:
                durations[index] = remaining * weights[index] / weight_sum
            break
    return durations


def _component_line_counts(
    capacities: list[float],
    line_count: int,
    minimum: float,
) -> list[int]:
    counts = [0] * len(capacities)
    if line_count == 0 or not capacities:
        return counts
    total_capacity = sum(capacities)
    ideals = [line_count * capacity / total_capacity for capacity in capacities]
    normal_slots = [math.floor((capacity + 1e-12) / minimum) for capacity in capacities]
    if sum(normal_slots) >= line_count:
        counts = [
            min(math.floor(ideal), slots)
            for ideal, slots in zip(ideals, normal_slots, strict=True)
        ]
        remaining = line_count - sum(counts)
        while remaining:
            available = [
                index
                for index, slots in enumerate(normal_slots)
                if counts[index] < slots
            ]
            selected = max(
                available,
                key=lambda index: (
                    ideals[index] - counts[index],
                    capacities[index],
                    -index,
                ),
            )
            counts[selected] += 1
            remaining -= 1
        return counts

    counts = [math.floor(ideal) for ideal in ideals]
    remaining = line_count - sum(counts)
    while remaining:
        selected = max(
            range(len(capacities)),
            key=lambda index: (
                ideals[index] - counts[index],
                capacities[index],
                -index,
            ),
        )
        counts[selected] += 1
        remaining -= 1
    return counts


def _stage_four_component_durations(
    capacity: float,
    weights: list[float],
    config: AlignConfig,
) -> list[float]:
    if not weights:
        return []
    minimum_needed = config.min_line_seconds * len(weights)
    if capacity + 1e-12 < minimum_needed:
        total_weight = sum(weights)
        return [capacity * weight / total_weight for weight in weights]
    extra_capacity = min(
        capacity - minimum_needed,
        (config.max_line_seconds - config.min_line_seconds) * len(weights),
    )
    extras = _bounded_weighted_durations(
        extra_capacity,
        weights,
        max(0.0, config.max_line_seconds - config.min_line_seconds),
    )
    return [config.min_line_seconds + extra for extra in extras]


def _stage_four_emergency(
    lyrics: list[LyricLine],
    duration: float,
    weights: list[float],
    config: AlignConfig,
    reason: str,
    *,
    safe_capacity: float,
    strong_selected_count: int,
    strong_frozen_count: int,
    strong_demoted_count: int,
    strong_demoted_line_indexes: set[int],
) -> FallbackOutcome:
    durations = _bounded_weighted_durations(duration, weights, duration)
    cursor = 0.0
    lines: list[AlignedLine] = []
    for line, weight, line_duration in zip(lyrics, weights, durations, strict=True):
        end = min(duration, cursor + line_duration)
        if end <= cursor:
            end = min(duration, cursor + max(1e-9, duration / (len(lyrics) * 1000)))
        lines.append(
            AlignedLine(
                index=line.index,
                block=line.block,
                text=line.text,
                start=cursor,
                end=end,
                confidence=0.01,
                provenance=[
                    *(
                        ["fallback_strong_demoted"]
                        if line.index in strong_demoted_line_indexes
                        else []
                    ),
                    "fallback_stage_4_emergency_barrier_override",
                ],
                diagnostics={
                    "anchored": False,
                    "fallback_stage": 4,
                    "fallback_reason": reason,
                    "weight": weight,
                    "barrier_override": True,
                    "below_min_duration": (
                        end - cursor < config.min_line_seconds - 1e-12
                    ),
                },
            )
        )
        cursor = end
    return FallbackOutcome(
        lines=lines,
        stage=4,
        diagnostics={
            "reason_code": "emergency_barrier_override",
            "affected_lyric_line_indexes": [line.index for line in lyrics],
            "forbidden_respected": False,
            "barrier_override": True,
            "safe_component_count": 0,
            "safe_capacity_seconds": safe_capacity,
            "strong_selected_count": strong_selected_count,
            "strong_frozen_count": strong_frozen_count,
            "strong_demoted_count": strong_demoted_count,
            "compressed_line_count": sum(
                line.end - line.start < config.min_line_seconds - 1e-12
                for line in lines
            ),
            "warnings": [
                "no_safe_capacity",
                "barrier_override_required",
                "No barrier-respecting placement is mathematically possible; "
                "timestamps use the full audio as an emergency completion schedule.",
            ],
        },
    )


def _stage_four_anchor_line(
    line: LyricLine,
    candidate: Candidate,
    component: int,
    reason: str,
) -> AlignedLine:
    return AlignedLine(
        index=line.index,
        block=line.block,
        text=line.text,
        start=candidate.start,
        end=candidate.end,
        confidence=min(0.34, candidate.confidence * candidate.similarity * 0.36),
        provenance=[*candidate.provenance, "fallback_stage_4_anchor_frozen"],
        diagnostics={
            "anchored": True,
            "fallback_stage": 4,
            "fallback_reason": reason,
            "safe_component_index": component,
            "original_anchor_time": [candidate.start, candidate.end],
            "consensus_quality_score": candidate.quality_score,
            "consensus_support_count": candidate.support_count,
            "consensus_dispersion_seconds": candidate.time_dispersion,
            "consensus_quality_reason": candidate.quality_reason,
            "barrier_override": False,
        },
    )


def _stage_four_run_durations(
    capacity: float,
    desired_durations: list[float],
    config: AlignConfig,
) -> list[float]:
    bounded = [
        min(config.max_line_seconds, max(1e-12, duration))
        for duration in desired_durations
    ]
    desired_total = sum(bounded)
    if desired_total <= capacity + 1e-12:
        return bounded
    minimum_total = config.min_line_seconds * len(bounded)
    if capacity >= minimum_total - 1e-12:
        return _soft_avoidance_durations(
            bounded,
            capacity,
            config.min_line_seconds,
        )
    scale = capacity / desired_total
    return [duration * scale for duration in bounded]


def _subtract_intervals_from_spans(
    spans: list[tuple[int, float, float]],
    intervals: list[tuple[float, float]],
) -> list[tuple[int, float, float]]:
    result: list[tuple[int, float, float]] = []
    for component, left, right in spans:
        pieces = [(left, right)]
        for blocked_left, blocked_right in intervals:
            next_pieces: list[tuple[float, float]] = []
            for piece_left, piece_right in pieces:
                if blocked_right <= piece_left or blocked_left >= piece_right:
                    next_pieces.append((piece_left, piece_right))
                    continue
                if blocked_left > piece_left:
                    next_pieces.append(
                        (piece_left, min(piece_right, blocked_left))
                    )
                if blocked_right < piece_right:
                    next_pieces.append(
                        (max(piece_left, blocked_right), piece_right)
                    )
            pieces = next_pieces
        result.extend(
            (component, piece_left, piece_right)
            for piece_left, piece_right in pieces
            if piece_right - piece_left > 1e-12
        )
    return result


def _effective_soft_intervals(
    soft_intervals: list[tuple[float, float]],
    activity_components: list[tuple[float, float]],
) -> list[tuple[float, float]]:
    pieces = list(soft_intervals)
    for activity_left, activity_right in activity_components:
        next_pieces: list[tuple[float, float]] = []
        for left, right in pieces:
            if activity_right <= left or activity_left >= right:
                next_pieces.append((left, right))
                continue
            if activity_left > left:
                next_pieces.append((left, min(right, activity_left)))
            if activity_right < right:
                next_pieces.append((max(left, activity_right), right))
        pieces = next_pieces
    return sorted(pieces)


def _span_capacity(spans: list[tuple[int, float, float]]) -> float:
    return sum(right - left for _component, left, right in spans)


def _soft_avoidance_durations(
    requested: list[float],
    capacity: float,
    minimum: float,
) -> list[float]:
    desired_total = sum(requested)
    if desired_total <= capacity + 1e-12:
        return requested
    minimum_total = minimum * len(requested)
    if capacity <= minimum_total + 1e-12:
        return [minimum] * len(requested)
    extra_total = sum(max(0.0, duration - minimum) for duration in requested)
    if extra_total <= 1e-12:
        return requested
    scale = min(1.0, (capacity - minimum_total) / extra_total)
    return [
        minimum + max(0.0, duration - minimum) * scale
        for duration in requested
    ]


def _minimal_soft_intrusion_spans(
    spans: list[tuple[int, float, float]],
    soft_intervals: list[tuple[float, float]],
    required_capacity: float,
    minimum: float,
) -> list[tuple[int, float, float]]:
    free_spans = _subtract_intervals_from_spans(spans, soft_intervals)
    required_slots = math.ceil(
        max(0.0, required_capacity - 1e-12) / minimum
    )

    def capacity_fits(
        allowed: list[tuple[int, float, float]],
    ) -> bool:
        return (
            _span_capacity(allowed) >= required_capacity - 1e-12
            and sum(
                math.floor((right - left + 1e-9) / minimum)
                for _component, left, right in allowed
            )
            >= required_slots
        )

    if capacity_fits(free_spans):
        return free_spans
    maximum_margin = max(
        (right - left) / 2
        for left, right in soft_intervals
    )
    lower = 0.0
    upper = maximum_margin
    for _iteration in range(60):
        margin = (lower + upper) / 2
        residual = [
            (left + margin, right - margin)
            for left, right in soft_intervals
            if right - left > 2 * margin
        ]
        allowed = _subtract_intervals_from_spans(spans, residual)
        if capacity_fits(allowed):
            upper = margin
        else:
            lower = margin
    intrusion_margin = min(maximum_margin, upper + 1e-8)
    residual = [
        (
            left + intrusion_margin,
            right - intrusion_margin,
        )
        for left, right in soft_intervals
        if right - left > 2 * intrusion_margin
    ]
    return _subtract_intervals_from_spans(spans, residual)


def _soft_overlap_duration(
    start: float,
    end: float,
    soft_intervals: list[tuple[float, float]],
) -> float:
    return sum(
        max(0.0, min(end, soft_end) - max(start, soft_start))
        for soft_start, soft_end in soft_intervals
    )


def _stage_four_component_chunk(
    component: int,
    left: float,
    right: float,
    offset: int,
    positions: list[int],
    centers: list[float],
    desired_durations: list[float],
    center_weights: list[float],
    soft_intervals: list[tuple[float, float]],
    config: AlignConfig,
) -> _StageFourRunChunk:
    requested = [
        min(
            config.max_line_seconds,
            max(1e-12, desired_durations[position]),
        )
        for position in positions
    ]
    durations = _stage_four_run_durations(
        right - left,
        requested,
        config,
    )
    used = sum(durations)
    prefixes: list[float] = []
    elapsed = 0.0
    for duration in durations:
        prefixes.append(elapsed)
        elapsed += duration

    transformed_targets = [
        centers[position] - duration / 2 - prefix
        for position, duration, prefix in zip(
            positions,
            durations,
            prefixes,
            strict=True,
        )
    ]
    blocks: list[tuple[float, float, int]] = []
    for target, weight in zip(
        transformed_targets,
        center_weights,
        strict=True,
    ):
        blocks.append((target * weight, weight, 1))
        while (
            len(blocks) >= 2
            and blocks[-2][0] / blocks[-2][1]
            > blocks[-1][0] / blocks[-1][1]
        ):
            previous_sum, previous_weight, previous_count = blocks[-2]
            current_sum, current_weight, current_count = blocks[-1]
            blocks[-2:] = [
                (
                    previous_sum + current_sum,
                    previous_weight + current_weight,
                    previous_count + current_count,
                )
            ]

    upper = max(left, right - used)
    transformed_starts: list[float] = []
    for weighted_total, weight_total, count in blocks:
        fitted = min(
            upper,
            max(left, weighted_total / weight_total),
        )
        transformed_starts.extend([fitted] * count)
    starts = [
        transformed + prefix
        for transformed, prefix in zip(
            transformed_starts,
            prefixes,
            strict=True,
        )
    ]
    if (
        soft_intervals
        and not config.conservative_soft_gap_avoidance
        and config.soft_gap_penalty_weight > 0
    ):
        minimum_delta = left - min(starts)
        maximum_delta = right - max(
            start + duration
            for start, duration in zip(
                starts,
                durations,
                strict=True,
            )
        )
        candidate_deltas = {
            0.0,
            minimum_delta,
            maximum_delta,
        }
        for soft_left, soft_right in soft_intervals:
            for start, duration in zip(
                starts,
                durations,
                strict=True,
            ):
                candidate_deltas.update(
                    {
                        soft_left - start,
                        soft_right - start,
                        soft_left - (start + duration),
                        soft_right - (start + duration),
                    }
                )

        def shifted_objective(delta: float) -> float:
            shifted_overlap = sum(
                _soft_overlap_duration(
                    start + delta,
                    start + delta + duration,
                    soft_intervals,
                )
                for start, duration in zip(
                    starts,
                    durations,
                    strict=True,
                )
            )
            shifted_error = sum(
                weight
                * (
                    start
                    + delta
                    + duration / 2
                    - centers[position]
                )
                ** 2
                for start, duration, position, weight in zip(
                    starts,
                    durations,
                    positions,
                    center_weights,
                    strict=True,
                )
            )
            return (
                shifted_error
                + config.soft_gap_penalty_weight * shifted_overlap
            )

        feasible_deltas = [
            delta
            for delta in candidate_deltas
            if minimum_delta - 1e-12
            <= delta
            <= maximum_delta + 1e-12
        ]
        if feasible_deltas:
            selected_delta = min(
                feasible_deltas,
                key=lambda delta: (
                    shifted_objective(delta),
                    abs(delta),
                ),
            )
            starts = [
                start + selected_delta for start in starts
            ]
    compression_loss = sum(
        max(0.0, requested_duration - actual_duration)
        for requested_duration, actual_duration in zip(
            requested,
            durations,
            strict=True,
        )
    )
    soft_overlap = sum(
        _soft_overlap_duration(
            start,
            start + duration,
            soft_intervals,
        )
        for start, duration in zip(starts, durations, strict=True)
    )
    squared_error = sum(
        weight * (start + duration / 2 - centers[position]) ** 2
        for start, duration, position, weight in zip(
            starts,
            durations,
            positions,
            center_weights,
            strict=True,
        )
    )
    return _StageFourRunChunk(
        component=component,
        left=left,
        right=right,
        offset=offset,
        count=len(positions),
        starts=tuple(starts),
        durations=tuple(durations),
        compression_loss=compression_loss,
        soft_overlap=soft_overlap,
        squared_error=squared_error,
    )


def _stage_four_run_plan(
    positions: list[int],
    centers: list[float],
    desired_durations: list[float],
    center_weights: list[float],
    spans: list[tuple[int, float, float]],
    soft_intervals: list[tuple[float, float]],
    config: AlignConfig,
    *,
    enforce_minimum: bool = False,
) -> tuple[_StageFourRunChunk, ...] | None:
    states: dict[
        int,
        tuple[float, float, float, tuple[_StageFourRunChunk, ...]],
    ] = {0: (0.0, 0.0, 0.0, ())}
    for component, left, right in spans:
        next_states: dict[
            int,
            tuple[float, float, float, tuple[_StageFourRunChunk, ...]],
        ] = {}
        for offset, (loss, overlap, error, chunks) in states.items():
            for end in range(offset, len(positions) + 1):
                next_loss = loss
                next_overlap = overlap
                next_error = error
                next_chunks = chunks
                if end > offset:
                    if (
                        enforce_minimum
                        and right - left
                        < config.min_line_seconds
                        * (end - offset)
                        - 1e-12
                    ):
                        continue
                    chunk = _stage_four_component_chunk(
                        component,
                        left,
                        right,
                        offset,
                        positions[offset:end],
                        centers,
                        desired_durations,
                        center_weights[offset:end],
                        soft_intervals,
                        config,
                    )
                    next_loss += chunk.compression_loss
                    next_overlap += chunk.soft_overlap
                    next_error += chunk.squared_error
                    next_chunks = (*chunks, chunk)
                current = next_states.get(end)
                if config.conservative_soft_gap_avoidance:
                    score = (next_loss, next_overlap, next_error)
                    current_score = (
                        None
                        if current is None
                        else current[:3]
                    )
                else:
                    score = (
                        next_loss,
                        next_error
                        + config.soft_gap_penalty_weight
                        * next_overlap,
                        next_overlap,
                    )
                    current_score = (
                        None
                        if current is None
                        else (
                            current[0],
                            current[2]
                            + config.soft_gap_penalty_weight
                            * current[1],
                            current[1],
                        )
                    )
                if current_score is None or score < current_score:
                    next_states[end] = (
                        next_loss,
                        next_overlap,
                        next_error,
                        next_chunks,
                    )
        states = next_states
    completed = states.get(len(positions))
    return None if completed is None else completed[3]


def _stage_four_place_run(
    lines: list[LyricLine],
    positions: list[int],
    centers: list[float],
    desired_durations: list[float],
    spans: list[tuple[int, float, float]],
    soft_intervals: list[tuple[float, float]],
    activity_components: list[tuple[float, float]],
    config: AlignConfig,
    reason: str,
    demoted_reasons: dict[int, str],
    strong_demoted_indexes: set[int],
    weak_hint_centers: dict[int, float],
) -> tuple[list[AlignedLine], int] | None:
    if not lines:
        return [], 0
    if not spans or _span_capacity(spans) <= 0:
        return None

    effective_soft = _effective_soft_intervals(
        soft_intervals,
        activity_components,
    )
    soft_free_spans = _subtract_intervals_from_spans(
        spans,
        effective_soft,
    )
    soft_free_capacity = _span_capacity(soft_free_spans)
    soft_free_slots = sum(
        math.floor(
            (right - left + 1e-9) / config.min_line_seconds
        )
        for _component, left, right in soft_free_spans
    )
    requested = [
        min(
            config.max_line_seconds,
            max(1e-12, desired_durations[position]),
        )
        for position in positions
    ]
    desired_total = sum(requested)
    minimum_total = config.min_line_seconds * len(lines)
    planned_durations = list(desired_durations)
    plan_spans = spans
    mode = "no_soft_intervals"
    plan_soft_intervals = effective_soft
    if effective_soft and not config.conservative_soft_gap_avoidance:
        mode = "finite_soft_gap_penalty"
    elif effective_soft and soft_free_capacity >= desired_total - 1e-12:
        mode = "soft_avoid_preserve_duration"
        plan_spans = soft_free_spans
        plan_soft_intervals = []
    elif (
        effective_soft
        and soft_free_capacity >= minimum_total - 1e-12
        and soft_free_slots >= len(lines)
    ):
        mode = "soft_avoid_compress_to_capacity"
        compressed = _soft_avoidance_durations(
            requested,
            soft_free_capacity,
            config.min_line_seconds,
        )
        planned_durations = list(desired_durations)
        for position, duration in zip(
            positions,
            compressed,
            strict=True,
        ):
            planned_durations[position] = duration
        plan_spans = soft_free_spans
        plan_soft_intervals = []
    elif effective_soft:
        mode = "unavoidable_soft_overlap"
        planned_durations = list(desired_durations)
        for position in positions:
            planned_durations[position] = (
                config.min_line_seconds + 1e-9
            )
        plan_spans = _minimal_soft_intrusion_spans(
            spans,
            effective_soft,
            minimum_total,
            config.min_line_seconds,
        )

    center_weights = [
        max(1.0, len(line.normalized) ** 0.72)
        for line in lines
    ]
    chunks = _stage_four_run_plan(
        positions,
        centers,
        planned_durations,
        center_weights,
        plan_spans,
        plan_soft_intervals,
        config,
        enforce_minimum=(
            bool(effective_soft)
            and _span_capacity(spans) >= minimum_total - 1e-12
        ),
    )
    if chunks is None:
        return None

    output: list[AlignedLine] = []
    compressed_count = 0
    for chunk in chunks:
        for relative, (start, line_duration) in enumerate(
            zip(chunk.starts, chunk.durations, strict=True)
        ):
            line = lines[chunk.offset + relative]
            position = positions[chunk.offset + relative]
            end = min(chunk.right, start + line_duration)
            below_minimum = (
                end - start < config.min_line_seconds - 1e-12
            )
            if below_minimum:
                compressed_count += 1
            overlap = _soft_overlap_duration(
                start,
                end,
                effective_soft,
            )
            compressed_for_soft = (
                mode == "soft_avoid_compress_to_capacity"
                and end - start
                < desired_durations[position] - 1e-12
            )
            demoted_reason = demoted_reasons.get(line.index)
            demoted_reason_text = demoted_reason or ""
            authoritative_lattice_used = (
                isinstance(demoted_reason, str)
                and demoted_reason.startswith(
                    "global_lattice_authoritative_local"
                )
                and line.index in weak_hint_centers
            )
            remote_lattice_disagreement = (
                authoritative_lattice_used
                and demoted_reason_text.endswith("remote_disagreement")
            )
            low_lattice_agreement = (
                authoritative_lattice_used
                and (
                    remote_lattice_disagreement
                    or demoted_reason_text.endswith("low_agreement")
                )
            )
            provenance = [
                *(
                    ["fallback_strong_demoted"]
                    if line.index in strong_demoted_indexes
                    else []
                ),
                *(
                    ["fallback_weak_hint_used"]
                    if line.index in weak_hint_centers
                    else []
                ),
                *(
                    ["fallback_global_lattice_local_used"]
                    if authoritative_lattice_used
                    else []
                ),
                *(
                    ["fallback_global_lattice_low_path_agreement"]
                    if low_lattice_agreement
                    else []
                ),
                *(
                    ["fallback_lattice_remote_path_disagreement"]
                    if remote_lattice_disagreement
                    else []
                ),
                "fallback_stage_4_anchor_run_schedule",
            ]
            output.append(
                AlignedLine(
                    index=line.index,
                    block=line.block,
                    text=line.text,
                    start=start,
                    end=end,
                    confidence=(
                        0.01
                        if below_minimum and low_lattice_agreement
                        else 0.02
                        if below_minimum or low_lattice_agreement
                        else 0.04
                    ),
                    provenance=provenance,
                    diagnostics={
                        "anchored": False,
                        "fallback_stage": 4,
                        "fallback_reason": reason,
                        "desired_center": centers[position],
                        "desired_duration": desired_durations[position],
                        "safe_component_index": chunk.component,
                        "safe_component": [chunk.left, chunk.right],
                        "below_min_duration": below_minimum,
                        "duration_compressed": (
                            end - start
                            < desired_durations[position] - 1e-12
                        ),
                        "soft_avoidance_mode": mode,
                        "soft_free_capacity_seconds": soft_free_capacity,
                        "soft_desired_duration_seconds": desired_total,
                        "soft_minimum_duration_seconds": minimum_total,
                        "compressed_for_soft_avoidance": compressed_for_soft,
                        "soft_gap_overlap_seconds": overlap,
                        "unavoidable_soft_overlap": (
                            mode == "unavoidable_soft_overlap"
                            and overlap > 1e-12
                        ),
                        "soft_gap_penalty_weight": (
                            config.soft_gap_penalty_weight
                        ),
                        "conservative_soft_gap_avoidance": (
                            config.conservative_soft_gap_avoidance
                        ),
                        "demoted_anchor_reason": demoted_reason,
                        "global_lattice_local_used": (
                            authoritative_lattice_used
                        ),
                        "global_lattice_remote_path_disagreement": (
                            remote_lattice_disagreement
                        ),
                        "global_lattice_low_path_agreement": (
                            low_lattice_agreement
                        ),
                        "weak_hint_center": weak_hint_centers.get(
                            line.index
                        ),
                        "barrier_override": False,
                    },
                )
            )
    return output, compressed_count


def _stage_four_anchor_schedule(
    lyrics: list[LyricLine],
    frozen: dict[int, Candidate],
    frozen_components: dict[int, int],
    hints: dict[int, Candidate],
    safe_intervals: list[tuple[float, float]],
    duration: float,
    forbidden: list[tuple[float, float]],
    soft_intervals: list[tuple[float, float]],
    activity_components: list[tuple[float, float]],
    config: AlignConfig,
    reason: str,
    demoted_reasons: dict[int, str],
    strong_demoted_indexes: set[int],
) -> tuple[
    list[AlignedLine] | None,
    int,
    tuple[int | None, int | None] | None,
]:
    centers, desired_durations, weak_hint_centers = _desired_centers(
        lyrics,
        frozen,
        hints,
        safe_intervals,
        duration,
        config,
        activity_components,
        soft_intervals,
    )
    position_by_index = {
        line.index: position for position, line in enumerate(lyrics)
    }
    aligned = {
        line.index: _stage_four_anchor_line(
            line,
            frozen[line.index],
            frozen_components[line.index],
            reason,
        )
        for line in lyrics
        if line.index in frozen
    }
    compressed_count = 0
    frozen_positions = sorted(position_by_index[index] for index in frozen)
    boundaries = [-1, *frozen_positions, len(lyrics)]
    for left_position, right_position in zip(
        boundaries,
        boundaries[1:],
        strict=False,
    ):
        missing_positions = list(range(left_position + 1, right_position))
        if not missing_positions:
            continue
        lower = (
            aligned[lyrics[left_position].index].end
            if left_position >= 0
            else 0.0
        )
        upper = (
            aligned[lyrics[right_position].index].start
            if right_position < len(lyrics)
            else duration
        )
        spans = _bounded_spans(safe_intervals, lower, upper, 0.0)
        placed = _stage_four_place_run(
            [lyrics[position] for position in missing_positions],
            missing_positions,
            centers,
            desired_durations,
            spans,
            soft_intervals,
            activity_components,
            config,
            reason,
            demoted_reasons,
            strong_demoted_indexes,
            weak_hint_centers,
        )
        if placed is None:
            return (
                None,
                0,
                (
                    lyrics[left_position].index if left_position >= 0 else None,
                    (
                        lyrics[right_position].index
                        if right_position < len(lyrics)
                        else None
                    ),
                ),
            )
        run_lines, run_compressed = placed
        compressed_count += run_compressed
        for item in run_lines:
            aligned[item.index] = item
    result = [aligned[line.index] for line in lyrics]
    previous_end = 0.0
    for aligned_line in result:
        if not 0 <= aligned_line.start < aligned_line.end <= duration:
            return None, 0, None
        if aligned_line.start < previous_end - 1e-12:
            return None, 0, None
        if interval_intersects(
            aligned_line.start,
            aligned_line.end,
            forbidden,
            0.0,
        ):
            return None, 0, None
        previous_end = aligned_line.end
    return result, compressed_count, None


def _stage_four_global_safe_schedule(
    lyrics: list[LyricLine],
    safe_intervals: list[tuple[float, float]],
    soft_intervals: list[tuple[float, float]],
    activity_components: list[tuple[float, float]],
    config: AlignConfig,
    reason: str,
    demoted_reasons: dict[int, str],
    strong_demoted_indexes: set[int],
) -> tuple[list[AlignedLine], int]:
    weights = [max(1.0, len(line.normalized) ** 0.72) for line in lyrics]
    activity_safe_intervals = [
        (max(activity_left, safe_left), min(activity_right, safe_right))
        for activity_left, activity_right in activity_components
        for safe_left, safe_right in safe_intervals
        if min(activity_right, safe_right)
        > max(activity_left, safe_left)
    ]
    activity_capacity = sum(
        right - left for left, right in activity_safe_intervals
    )
    activity_slots = sum(
        math.floor(
            (right - left + 1e-9) / config.min_line_seconds
        )
        for left, right in activity_safe_intervals
    )
    minimum_needed = config.min_line_seconds * len(lyrics)
    effective_soft = _effective_soft_intervals(
        soft_intervals,
        activity_components,
    )
    safe_spans = [
        (component, left, right)
        for component, (left, right) in enumerate(safe_intervals)
    ]
    soft_free_spans = _subtract_intervals_from_spans(
        safe_spans,
        effective_soft,
    )
    soft_free_capacity = _span_capacity(soft_free_spans)
    soft_free_slots = sum(
        math.floor(
            (right - left + 1e-9) / config.min_line_seconds
        )
        for _component, left, right in soft_free_spans
    )
    if (
        activity_capacity >= minimum_needed
        and activity_slots >= len(lyrics)
    ):
        scheduling_intervals = activity_safe_intervals
        soft_mode = "trusted_activity_preferred"
    elif not config.conservative_soft_gap_avoidance:
        scheduling_intervals = safe_intervals
        soft_mode = "finite_soft_gap_penalty"
    elif (
        soft_free_capacity >= minimum_needed
        and soft_free_slots >= len(lyrics)
    ):
        scheduling_intervals = [
            (left, right) for _component, left, right in soft_free_spans
        ]
        soft_mode = "soft_avoid_global_schedule"
    elif effective_soft:
        intrusion_spans = _minimal_soft_intrusion_spans(
            safe_spans,
            effective_soft,
            minimum_needed,
            config.min_line_seconds,
        )
        scheduling_intervals = [
            (left, right) for _component, left, right in intrusion_spans
        ]
        soft_mode = "unavoidable_soft_overlap"
    else:
        scheduling_intervals = safe_intervals
        soft_mode = "no_soft_intervals"
    capacities = [right - left for left, right in scheduling_intervals]
    counts = _component_line_counts(
        capacities,
        len(lyrics),
        config.min_line_seconds,
    )
    lines: list[AlignedLine] = []
    position = 0
    compressed_count = 0
    for component, ((left, right), count) in enumerate(
        zip(scheduling_intervals, counts, strict=True)
    ):
        if count == 0:
            continue
        component_weights = weights[position : position + count]
        durations = _stage_four_component_durations(
            right - left,
            component_weights,
            config,
        )
        used = sum(durations)
        cursor = left + max(0.0, (right - left - used) / 2)
        for weight, line_duration in zip(
            component_weights,
            durations,
            strict=True,
        ):
            line = lyrics[position]
            end = min(right, cursor + line_duration)
            below_minimum = end - cursor < config.min_line_seconds - 1e-12
            if below_minimum:
                compressed_count += 1
            lines.append(
                AlignedLine(
                    index=line.index,
                    block=line.block,
                    text=line.text,
                    start=cursor,
                    end=end,
                    confidence=0.02 if below_minimum else 0.04,
                    provenance=[
                        *(
                            ["fallback_strong_demoted"]
                            if line.index in strong_demoted_indexes
                            else []
                        ),
                        "fallback_stage_4_safe_component_schedule",
                    ],
                    diagnostics={
                        "anchored": False,
                        "fallback_stage": 4,
                        "fallback_reason": reason,
                        "weight": weight,
                        "safe_component_index": component,
                        "safe_component": [left, right],
                        "below_min_duration": below_minimum,
                        "soft_avoidance_mode": soft_mode,
                        "soft_free_capacity_seconds": soft_free_capacity,
                        "soft_minimum_duration_seconds": minimum_needed,
                        "soft_gap_overlap_seconds": _soft_overlap_duration(
                            cursor,
                            end,
                            effective_soft,
                        ),
                        "unavoidable_soft_overlap": (
                            soft_mode == "unavoidable_soft_overlap"
                            and _soft_overlap_duration(
                                cursor,
                                end,
                                effective_soft,
                            )
                            > 1e-12
                        ),
                        "soft_gap_penalty_weight": (
                            config.soft_gap_penalty_weight
                        ),
                        "conservative_soft_gap_avoidance": (
                            config.conservative_soft_gap_avoidance
                        ),
                        "compressed_for_soft_avoidance": False,
                        "demoted_anchor_reason": demoted_reasons.get(line.index),
                        "barrier_override": False,
                    },
                )
            )
            cursor = end
            position += 1
    return lines, compressed_count


def _stage_four(
    lyrics: list[LyricLine],
    frozen_anchors: dict[int, Candidate],
    weak_hints: dict[int, Candidate],
    duration: float,
    forbidden: list[tuple[float, float]],
    activity_components: list[tuple[float, float]],
    config: AlignConfig,
    reason: str,
    soft_intervals: list[tuple[float, float]] | None = None,
) -> FallbackOutcome:
    soft_intervals = [] if soft_intervals is None else soft_intervals
    weights = [max(1.0, len(line.normalized) ** 0.72) for line in lyrics]
    safe_intervals = _safe_intervals(duration, forbidden, 0.0)
    classified_frozen, classified_components, classified_demoted = (
        _freeze_valid_anchors(
            frozen_anchors,
            duration,
            forbidden,
            safe_intervals,
            config,
            tolerance=0.0,
        )
    )
    classified_frozen_count = len(classified_frozen)
    capacities = [right - left for left, right in safe_intervals]
    safe_capacity = sum(capacities)
    if not safe_intervals or safe_capacity <= 0:
        emergency = _stage_four_emergency(
            lyrics,
            duration,
            weights,
            config,
            reason,
            safe_capacity=safe_capacity,
            strong_selected_count=len(frozen_anchors),
            strong_frozen_count=0,
            strong_demoted_count=len(frozen_anchors),
            strong_demoted_line_indexes=set(frozen_anchors),
        )
        emergency.diagnostics.update(
            {
                "classified_frozen_count": classified_frozen_count,
                "classified_demoted_count": len(classified_demoted),
                "anchor_preservation_failure_reasons": [
                    "zero_safe_capacity",
                ],
            }
        )
        return emergency

    demoted = list(classified_demoted)
    demoted_reasons: dict[int, str] = {}
    for decision in demoted:
        line_index = decision.get("lyric_line_index")
        demotion_reason = decision.get("reason")
        if isinstance(line_index, int) and isinstance(demotion_reason, str):
            demoted_reasons[line_index] = demotion_reason
    for line_index, hint in weak_hints.items():
        demoted_reasons.setdefault(line_index, hint.quality_reason)
    strong_demoted_indexes = {
        line_index
        for line_index in demoted_reasons
        if line_index in frozen_anchors
    }
    strong_demoted_indexes.update(
        line_index
        for line_index, hint in weak_hints.items()
        if _is_strong_ambiguity_demotion_reason(
            hint.quality_reason
        )
    )
    hints = dict(weak_hints)
    for line_index, candidate in frozen_anchors.items():
        if line_index not in classified_frozen:
            hints.setdefault(
                line_index,
                replace(
                    candidate,
                    freeze_eligible=False,
                    quality_reason=demoted_reasons.get(
                        line_index,
                        candidate.quality_reason,
                    ),
                ),
            )

    current_frozen = dict(classified_frozen)
    current_components = dict(classified_components)
    anchor_failure_reasons: list[str] = []
    lines: list[AlignedLine] | None = None
    compressed_count = 0
    while current_frozen:
        lines, compressed_count, conflict = _stage_four_anchor_schedule(
            lyrics,
            current_frozen,
            current_components,
            hints,
            safe_intervals,
            duration,
            forbidden,
            soft_intervals,
            activity_components,
            config,
            reason,
            demoted_reasons,
            strong_demoted_indexes,
        )
        if lines is not None:
            break
        adjacent = (
            []
            if conflict is None
            else [
                line_index
                for line_index in conflict
                if line_index is not None and line_index in current_frozen
            ]
        )
        if not adjacent:
            adjacent = list(current_frozen)
        demote_index = min(
            adjacent,
            key=lambda line_index: (
                current_frozen[line_index].quality_score,
                current_frozen[line_index].support_count,
                -current_frozen[line_index].time_dispersion,
                current_frozen[line_index].score,
                line_index,
            ),
        )
        candidate = current_frozen.pop(demote_index)
        current_components.pop(demote_index, None)
        strong_demoted_indexes.add(demote_index)
        demoted_reasons[demote_index] = (
            "stage_four_zero_capacity_adjacent_to_frozen_anchor"
        )
        hints[demote_index] = replace(
            candidate,
            freeze_eligible=False,
            quality_reason=demoted_reasons[demote_index],
        )
        demoted.append(
            {
                "lyric_line_index": demote_index,
                "reason": demoted_reasons[demote_index],
                "original_time": [candidate.start, candidate.end],
                "quality_score": candidate.quality_score,
                "support_count": candidate.support_count,
                "dispersion_seconds": candidate.time_dispersion,
                "freeze_eligible": candidate.freeze_eligible,
                "quality_reason": candidate.quality_reason,
            }
        )
        anchor_failure_reasons.append(
            "demoted_lower_quality_anchor_for_positive_run_capacity"
        )

    if lines is None and any(
        hint.quality_reason.startswith(
            "global_lattice_authoritative_local"
        )
        for hint in hints.values()
    ):
        hinted_lines, hinted_compressed_count, _hint_conflict = (
            _stage_four_anchor_schedule(
                lyrics,
                {},
                {},
                hints,
                safe_intervals,
                duration,
                forbidden,
                soft_intervals,
                activity_components,
                config,
                reason,
                demoted_reasons,
                strong_demoted_indexes,
            )
        )
        if hinted_lines is not None:
            lines = hinted_lines
            compressed_count = hinted_compressed_count
            for aligned_line in lines:
                if (
                    "fallback_stage_4_safe_component_schedule"
                    not in aligned_line.provenance
                ):
                    aligned_line.provenance.append(
                        "fallback_stage_4_safe_component_schedule"
                    )

    if lines is None:
        lines, compressed_count = _stage_four_global_safe_schedule(
            lyrics,
            safe_intervals,
            soft_intervals,
            activity_components,
            config,
            reason,
            demoted_reasons,
            strong_demoted_indexes,
        )

    previous_end = 0.0
    for aligned_line in lines:
        if not 0 <= aligned_line.start < aligned_line.end <= duration:
            raise AlignmentError(
                "stage 4 produced a non-positive or out-of-bounds line"
            )
        if aligned_line.start < previous_end - 1e-12:
            raise AlignmentError("stage 4 produced non-monotonic lines")
        if interval_intersects(
            aligned_line.start,
            aligned_line.end,
            forbidden,
            0.0,
        ):
            raise AlignmentError("stage 4 crossed a forbidden interval")
        previous_end = aligned_line.end

    effective_soft_intervals = _effective_soft_intervals(
        soft_intervals,
        activity_components,
    )
    global_safe_spans = [
        (component, left, right)
        for component, (left, right) in enumerate(safe_intervals)
    ]
    soft_free_capacity = _span_capacity(
        _subtract_intervals_from_spans(
            global_safe_spans,
            effective_soft_intervals,
        )
    )
    provisional_lines = [
        line
        for line in lines
        if not bool(line.diagnostics.get("anchored"))
    ]
    soft_desired_duration = sum(
        float(
            line.diagnostics.get(
                "desired_duration",
                line.end - line.start,
            )
        )
        for line in provisional_lines
    )
    soft_minimum_duration = (
        config.min_line_seconds * len(provisional_lines)
    )
    compressed_for_soft_count = sum(
        bool(line.diagnostics.get("compressed_for_soft_avoidance"))
        for line in provisional_lines
    )
    soft_gap_overlap_seconds = sum(
        float(line.diagnostics.get("soft_gap_overlap_seconds", 0.0))
        for line in provisional_lines
    )
    unavoidable_soft_overlap_seconds = sum(
        float(line.diagnostics.get("soft_gap_overlap_seconds", 0.0))
        for line in provisional_lines
        if bool(line.diagnostics.get("unavoidable_soft_overlap"))
    )

    warnings = [
        "All provisional timestamps remain inside safe components.",
    ]
    if compressed_count:
        warnings.extend(
            [
                "below_min_duration",
                "Safe run capacity was insufficient for configured minimum "
                "durations; stage 4 compressed only provisional run lines.",
            ]
        )
    if compressed_for_soft_count:
        warnings.append("compressed_for_soft_avoidance")
    if unavoidable_soft_overlap_seconds > 1e-12:
        warnings.append("unavoidable_soft_overlap")
    if anchor_failure_reasons:
        warnings.append(
            "One or more lower-quality anchors were demoted because no positive "
            "barrier-respecting run placement existed beside them."
        )
    actual_frozen = sum(
        "fallback_stage_4_anchor_frozen" in line.provenance for line in lines
    )
    reason_code = (
        "anchor_preserving_barrier_aware_schedule"
        if actual_frozen
        else "barrier_aware_provisional_schedule"
    )
    return FallbackOutcome(
        lines=lines,
        stage=4,
        diagnostics={
            "reason_code": reason_code,
            "affected_lyric_line_indexes": [line.index for line in lyrics],
            "forbidden_respected": True,
            "barrier_override": False,
            "safe_component_count": len(safe_intervals),
            "safe_capacity_seconds": safe_capacity,
            "safe_intervals": [list(interval) for interval in safe_intervals],
            "recognition_only_soft_intervals": [
                list(interval) for interval in soft_intervals
            ],
            "effective_soft_interval_count": len(
                effective_soft_intervals
            ),
            "soft_free_capacity_seconds": soft_free_capacity,
            "soft_desired_duration_seconds": soft_desired_duration,
            "soft_minimum_duration_seconds": soft_minimum_duration,
            "compressed_for_soft_avoidance_count": (
                compressed_for_soft_count
            ),
            "soft_gap_overlap_seconds": soft_gap_overlap_seconds,
            "soft_gap_penalty_weight": config.soft_gap_penalty_weight,
            "conservative_soft_gap_avoidance": (
                config.conservative_soft_gap_avoidance
            ),
            "unavoidable_soft_overlap": (
                unavoidable_soft_overlap_seconds > 1e-12
            ),
            "unavoidable_soft_overlap_seconds": (
                unavoidable_soft_overlap_seconds
            ),
            "trusted_activity_absent": not activity_components,
            "minimum_capacity_needed_seconds": (
                config.min_line_seconds * (len(lyrics) - actual_frozen)
            ),
            "capacity_shortfall_seconds": max(
                0.0,
                config.min_line_seconds * (len(lyrics) - actual_frozen)
                - safe_capacity,
            ),
            "compressed_line_count": compressed_count,
            "strong_selected_count": len(frozen_anchors),
            "strong_frozen_count": actual_frozen,
            "strong_demoted_count": len(strong_demoted_indexes),
            "classified_frozen_count": classified_frozen_count,
            "classified_demoted_count": len(classified_demoted),
            "demoted_anchors": demoted,
            "weak_hint_count": len(weak_hints),
            "activity_component_count": len(activity_components),
            "trusted_activity_components": [
                list(interval) for interval in activity_components
            ],
            "trusted_activity_safe_capacity_seconds": sum(
                max(
                    0.0,
                    min(activity_right, safe_right)
                    - max(activity_left, safe_left),
                )
                for activity_left, activity_right in activity_components
                for safe_left, safe_right in safe_intervals
            ),
            "trusted_activity_preferred": bool(activity_components),
            "anchor_preservation_failure_reasons": anchor_failure_reasons,
            "warnings": warnings,
        },
    )


def _diagnostic_count(
    diagnostics: dict[str, object],
    key: str,
    default: int,
) -> int:
    value = diagnostics.get(key, default)
    return value if isinstance(value, int) else default


def _finalize_fallback_counts(
    outcome: FallbackOutcome,
    *,
    selected_strong_input_count: int,
    weak_hint_input_count: int,
) -> FallbackOutcome:
    actual_frozen = sum(
        any(
            provenance == "fallback_stage_2_relaxed_assignment"
            or provenance.endswith("_anchor_frozen")
            for provenance in line.provenance
        )
        for line in outcome.lines
    )
    actual_demoted = sum(
        "fallback_strong_demoted" in line.provenance
        for line in outcome.lines
    )
    actual_weak_hints = sum(
        "fallback_weak_hint_used" in line.provenance
        for line in outcome.lines
    )
    classified_frozen = _diagnostic_count(
        outcome.diagnostics,
        "classified_frozen_count",
        _diagnostic_count(
            outcome.diagnostics,
            "strong_frozen_count",
            actual_frozen,
        ),
    )
    classified_demoted = _diagnostic_count(
        outcome.diagnostics,
        "classified_demoted_count",
        _diagnostic_count(
            outcome.diagnostics,
            "strong_demoted_count",
            actual_demoted,
        ),
    )
    actual_selected = actual_frozen + actual_demoted
    outcome.diagnostics.update(
        {
            "selected_strong_input_count": selected_strong_input_count,
            "classified_frozen_count": classified_frozen,
            "classified_demoted_count": classified_demoted,
            "actual_strong_selected_count": actual_selected,
            "actual_frozen_count": actual_frozen,
            "actual_demoted_count": actual_demoted,
            "weak_hint_input_count": weak_hint_input_count,
            "actual_weak_hint_used_count": actual_weak_hints,
            # Backward-compatible count names always describe the final output.
            "strong_selected_count": actual_selected,
            "strong_frozen_count": actual_frozen,
            "strong_demoted_count": actual_demoted,
            "weak_hint_count": actual_weak_hints,
        }
    )
    return outcome


def build_fallback_alignment(
    lyrics: list[LyricLine],
    frozen_anchors: dict[int, Candidate],
    duration: float,
    forbidden: list[tuple[float, float]],
    activity_components: list[tuple[float, float]],
    config: AlignConfig,
    *,
    weak_hints: dict[int, Candidate] | None = None,
    reason: str,
    soft_intervals: list[tuple[float, float]] | None = None,
) -> FallbackOutcome:
    hints = {} if weak_hints is None else weak_hints
    soft = [] if soft_intervals is None else soft_intervals
    stage_two = _stage_two(
        lyrics,
        frozen_anchors,
        duration,
        forbidden,
        config,
        reason,
    )
    if stage_two is not None:
        stage_two.diagnostics.update(
            {
                "classified_frozen_count": len(frozen_anchors),
                "classified_demoted_count": 0,
            }
        )
        return _finalize_fallback_counts(
            stage_two,
            selected_strong_input_count=len(frozen_anchors),
            weak_hint_input_count=len(hints),
        )
    stage_three = _stage_three(
        lyrics,
        frozen_anchors,
        hints,
        duration,
        forbidden,
        activity_components,
        config,
        reason,
    )
    if stage_three is not None:
        return _finalize_fallback_counts(
            stage_three,
            selected_strong_input_count=len(frozen_anchors),
            weak_hint_input_count=len(hints),
        )
    stage_four = _stage_four(
        lyrics,
        frozen_anchors,
        hints,
        duration,
        forbidden,
        activity_components,
        config,
        reason,
        soft,
    )
    return _finalize_fallback_counts(
        stage_four,
        selected_strong_input_count=len(frozen_anchors),
        weak_hint_input_count=len(hints),
    )

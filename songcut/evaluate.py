from __future__ import annotations

from dataclasses import dataclass

from .timestamps import Segment


@dataclass(frozen=True)
class EvaluationResult:
    precision: float
    recall: float
    f1: float
    intersection_seconds: float
    predicted_seconds: float
    truth_seconds: float
    median_boundary_error_seconds: float | None


def evaluate_segments(predicted: list[Segment], truth: list[Segment]) -> EvaluationResult:
    predicted_seconds = sum(segment.duration for segment in predicted)
    truth_seconds = sum(segment.duration for segment in truth)
    intersection = interval_intersection(predicted, truth)
    precision = intersection / predicted_seconds if predicted_seconds else 0.0
    recall = intersection / truth_seconds if truth_seconds else 0.0
    f1 = 2.0 * precision * recall / (precision + recall) if precision + recall else 0.0
    boundary_error = median_boundary_error(predicted, truth)
    return EvaluationResult(precision, recall, f1, intersection, predicted_seconds, truth_seconds, boundary_error)


def interval_intersection(left: list[Segment], right: list[Segment]) -> float:
    total = 0.0
    i = 0
    j = 0
    left_sorted = sorted(left, key=lambda item: item.start)
    right_sorted = sorted(right, key=lambda item: item.start)
    while i < len(left_sorted) and j < len(right_sorted):
        a = left_sorted[i]
        b = right_sorted[j]
        total += max(0.0, min(a.end, b.end) - max(a.start, b.start))
        if a.end < b.end:
            i += 1
        else:
            j += 1
    return total


def median_boundary_error(predicted: list[Segment], truth: list[Segment]) -> float | None:
    if not predicted or not truth:
        return None
    errors: list[float] = []
    for truth_segment in truth:
        closest = min(
            predicted,
            key=lambda pred: abs(pred.start - truth_segment.start) + abs(pred.end - truth_segment.end),
        )
        errors.append(abs(closest.start - truth_segment.start))
        errors.append(abs(closest.end - truth_segment.end))
    errors.sort()
    mid = len(errors) // 2
    if len(errors) % 2:
        return errors[mid]
    return (errors[mid - 1] + errors[mid]) / 2.0


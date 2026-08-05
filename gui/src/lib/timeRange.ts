/** The smallest shared shape used by timeline operations. */
export type TimedEntity = {
  start: number;
  end: number;
};

/** A range intentionally has the same structural shape as a timed entity. */
export type TimeRange = TimedEntity;

export const TIME_RANGE_EPSILON = 1e-6;

export function timeRangeDuration(range: TimedEntity): number {
  return range.end - range.start;
}

export const rangeDuration = timeRangeDuration;

export function isValidTimeRange(range: TimedEntity, minimumDuration = 0): boolean {
  return (
    Number.isFinite(range.start) &&
    Number.isFinite(range.end) &&
    timeRangeDuration(range) >= Math.max(0, minimumDuration)
  );
}

export function rangesOverlap(
  left: TimedEntity,
  right: TimedEntity,
  epsilon = TIME_RANGE_EPSILON,
): boolean {
  return left.start < right.end - epsilon && right.start < left.end - epsilon;
}

export function boundaryTime(range: TimedEntity, edge: "start" | "end"): number {
  return edge === "start" ? range.start : range.end;
}

export function withBoundary(
  range: TimedEntity,
  edge: "start" | "end",
  value: number,
): TimeRange {
  return edge === "start"
    ? { start: value, end: range.end }
    : { start: range.start, end: value };
}

export function clampTime(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

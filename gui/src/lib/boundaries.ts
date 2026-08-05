import {
  TIME_RANGE_EPSILON,
  boundaryTime,
  type TimeRange,
  type TimedEntity,
} from "@/lib/timeRange";

export type BoundaryEdge = "start" | "end";

export type BoundaryTarget = {
  segmentId: string;
  edge: BoundaryEdge;
};

export type BoundaryPlaybackRange = {
  start: number;
  stopAt: number;
};

export type BoundaryNeighbors = {
  previousEnd?: number | null;
  nextStart?: number | null;
};

export type BoundaryPolicyContext = BoundaryNeighbors & {
  range: TimeRange;
  edge: BoundaryEdge;
  minimum: number;
  maximum: number;
};

/**
 * A mode supplies only the parts of boundary editing that differ from the
 * shared range arithmetic. The callbacks are deliberately value-oriented so
 * Segment and LyricsSegment payloads remain independent.
 */
export type BoundaryPolicy = {
  minimumDuration: number;
  strict?: boolean;
  clamp?: boolean;
  snap?: (value: number, context: BoundaryPolicyContext) => number | null;
  nudge?: (
    value: number,
    direction: -1 | 1,
    context: BoundaryPolicyContext,
  ) => number | null;
  nudgeStep?: number;
};

export type BoundaryEditIntent = "drag" | "nudge" | "dialog";

export type CutBoundaryPolicyOptions = {
  nudgeStep?: number;
  clamp?: boolean;
};

/**
 * Cut uses free decimal seconds for every operation, while preserving its
 * intentional precision difference: timeline edits keep 0.1 s and the timing
 * dialog accepts 0.001 s ranges.
 */
export function createCutBoundaryPolicy(
  intent: BoundaryEditIntent,
  options: CutBoundaryPolicyOptions = {},
): BoundaryPolicy {
  return {
    minimumDuration: intent === "dialog" ? 0.001 : 0.1,
    strict: false,
    clamp: options.clamp ?? intent !== "dialog",
    nudgeStep: options.nudgeStep,
  };
}

/** Backwards-compatible default for Cut timeline drag behavior. */
export const CUT_BOUNDARY_POLICY: BoundaryPolicy = createCutBoundaryPolicy("drag");

export function resolveBoundaryTime(
  range: TimeRange,
  edge: BoundaryEdge,
  proposedTime: number,
  policy: BoundaryPolicy,
  neighbors: BoundaryNeighbors = {},
): number | null {
  const context = boundaryPolicyContext(range, edge, policy, neighbors);
  const snapped = policy.snap ? policy.snap(proposedTime, context) : proposedTime;
  return acceptedBoundaryTime(snapped, context, policy.strict === true, policy.clamp === true);
}

export function nudgeBoundaryTime(
  range: TimeRange,
  edge: BoundaryEdge,
  direction: -1 | 1,
  policy: BoundaryPolicy,
  neighbors: BoundaryNeighbors = {},
): number | null {
  const current = boundaryTime(range, edge);
  const context = boundaryPolicyContext(range, edge, policy, neighbors);
  const proposed = policy.nudge
    ? policy.nudge(current, direction, context)
    : typeof policy.nudgeStep === "number" && Number.isFinite(policy.nudgeStep)
      ? current + direction * policy.nudgeStep
      : null;
  return acceptedBoundaryTime(proposed, context, policy.strict === true, policy.clamp === true);
}

/** Resolve both edges of a proposed range through the same policy contract. */
export function resolveBoundaryRange(
  proposedRange: TimeRange,
  policy: BoundaryPolicy,
  neighbors: BoundaryNeighbors = {},
): TimeRange | null {
  const start = resolveBoundaryTime(
    proposedRange,
    "start",
    proposedRange.start,
    policy,
    neighbors,
  );
  if (start === null) return null;
  const end = resolveBoundaryTime(
    { start, end: proposedRange.end },
    "end",
    proposedRange.end,
    policy,
    neighbors,
  );
  return end === null ? null : { start, end };
}

export function boundaryNudgePlaybackRange(
  segment: TimedEntity,
  edge: BoundaryEdge,
  nudgeSeconds: number,
): BoundaryPlaybackRange {
  return {
    start: edge === "start" ? segment.start : Math.max(segment.start, segment.end - nudgeSeconds * 2),
    stopAt: segment.end,
  };
}

export function nearestBoundaryTarget(
  segments: readonly (TimedEntity & { id: string })[],
  time: number,
  preferredSegmentId?: string | null,
): BoundaryTarget | null {
  const preferred = preferredSegmentId
    ? segments.find((segment) => segment.id === preferredSegmentId)
    : undefined;
  const candidates = preferred ? [preferred] : segments;
  let nearest: (BoundaryTarget & { distance: number }) | null = null;

  for (const segment of candidates) {
    for (const edge of ["start", "end"] as const) {
      const distance = Math.abs(segment[edge] - time);
      if (!nearest || distance < nearest.distance) {
        nearest = { segmentId: segment.id, edge, distance };
      }
    }
  }

  return nearest ? { segmentId: nearest.segmentId, edge: nearest.edge } : null;
}

function boundaryPolicyContext(
  range: TimeRange,
  edge: BoundaryEdge,
  policy: BoundaryPolicy,
  neighbors: BoundaryNeighbors,
): BoundaryPolicyContext {
  const minimumDuration = Number.isFinite(policy.minimumDuration)
    ? Math.max(0, policy.minimumDuration)
    : 0;
  const previousEnd = finiteOrNull(neighbors.previousEnd);
  const nextStart = finiteOrNull(neighbors.nextStart);
  return {
    range,
    edge,
    previousEnd,
    nextStart,
    minimum: edge === "start"
      ? previousEnd ?? -Infinity
      : range.start + minimumDuration,
    maximum: edge === "start"
      ? range.end - minimumDuration
      : nextStart ?? Infinity,
  };
}

function acceptedBoundaryTime(
  value: number | null,
  context: BoundaryPolicyContext,
  strict: boolean,
  clamp: boolean,
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (clamp && !strict) {
    if (context.maximum < context.minimum) return null;
    return Math.max(context.minimum, Math.min(context.maximum, value));
  }
  if (strict) {
    return value > context.minimum + TIME_RANGE_EPSILON && value < context.maximum - TIME_RANGE_EPSILON
      ? value
      : null;
  }
  return value >= context.minimum - TIME_RANGE_EPSILON && value <= context.maximum + TIME_RANGE_EPSILON
    ? value
    : null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

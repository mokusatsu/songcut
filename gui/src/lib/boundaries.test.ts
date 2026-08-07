import { describe, expect, it } from "vitest";
import {
  CUT_BOUNDARY_POLICY,
  boundaryNudgePlaybackRange,
  createCutBoundaryPolicy,
  nearestBoundaryTarget,
  nudgeBoundaryTime,
  resolveBoundaryRange,
  resolveBoundaryTime,
} from "./boundaries";
import { createSubtitleBoundaryPolicy, type RhythmGridPoint } from "./subtitles";
import type { Segment } from "../types";

const segments: Segment[] = [
  {
    id: "selected",
    start: 0,
    end: 10,
    start_timecode: "0:00",
    end_timecode: "0:10",
    duration: 10,
    confidence: 1,
    source: "test",
    flags: [],
    user_edited: false,
  },
  {
    id: "other",
    start: 10.1,
    end: 20,
    start_timecode: "0:10.1",
    end_timecode: "0:20",
    duration: 9.9,
    confidence: 1,
    source: "test",
    flags: [],
    user_edited: false,
  },
];

describe("nearestBoundaryTarget", () => {
  it("prefers the selected segment even when another segment boundary is closer", () => {
    expect(nearestBoundaryTarget(segments, 10.09, "selected")).toEqual({
      segmentId: "selected",
      edge: "end",
    });
  });

  it("uses the selected segment's nearest edge", () => {
    expect(nearestBoundaryTarget(segments, 9.9, "other")).toEqual({
      segmentId: "other",
      edge: "start",
    });
    expect(nearestBoundaryTarget(segments, 19.8, "other")).toEqual({
      segmentId: "other",
      edge: "end",
    });
  });

  it("falls back to the globally nearest boundary when the preferred id is unavailable", () => {
    expect(nearestBoundaryTarget(segments, 10.09, "missing")).toEqual({
      segmentId: "other",
      edge: "start",
    });
    expect(nearestBoundaryTarget(segments, 10.09)).toEqual({
      segmentId: "other",
      edge: "start",
    });
  });

  it("returns null when there are no segments", () => {
    expect(nearestBoundaryTarget([], 10, "selected")).toBeNull();
  });
});

describe("boundaryNudgePlaybackRange", () => {
  it("plays a start nudge from the new start through the segment end", () => {
    expect(boundaryNudgePlaybackRange({ start: 4.5, end: 10 }, "start", 0.5)).toEqual({
      start: 4.5,
      stopAt: 10,
    });
  });

  it("plays an end nudge from twice the nudge width before the new end", () => {
    expect(boundaryNudgePlaybackRange({ start: 4, end: 10.5 }, "end", 0.5)).toEqual({
      start: 9.5,
      stopAt: 10.5,
    });
  });

  it("clamps an end-nudge preview to the segment start", () => {
    expect(boundaryNudgePlaybackRange({ start: 9.8, end: 10 }, "end", 0.5)).toEqual({
      start: 9.8,
      stopAt: 10,
    });
  });

  it("treats fractional Cut nudge widths as seconds", () => {
    expect(boundaryNudgePlaybackRange({ start: 1, end: 3 }, "end", 0.125)).toEqual({
      start: 2.75,
      stopAt: 3,
    });
  });
});

describe("BoundaryPolicy", () => {
  it("keeps Cut boundaries in free decimal seconds", () => {
    expect(resolveBoundaryTime(
      { start: 1, end: 3 },
      "start",
      1.125,
      CUT_BOUNDARY_POLICY,
    )).toBe(1.125);
    expect(resolveBoundaryTime(
      { start: 1, end: 3 },
      "start",
      3,
      CUT_BOUNDARY_POLICY,
    )).toBe(2.9);
    expect(nudgeBoundaryTime(
      { start: 1, end: 3 },
      "end",
      -1,
      { ...CUT_BOUNDARY_POLICY, nudgeStep: 0.125 },
    )).toBe(2.875);
  });

  it("preserves Cut's intentional timeline and dialog minimum-duration difference", () => {
    const range = { start: 1, end: 3 };
    expect(resolveBoundaryTime(
      range,
      "end",
      1.001,
      createCutBoundaryPolicy("drag"),
      { nextStart: 10 },
    )).toBe(1.1);
    expect(resolveBoundaryTime(
      range,
      "end",
      1.001,
      createCutBoundaryPolicy("dialog"),
      { nextStart: 10 },
    )).toBe(1.001);
    expect(nudgeBoundaryTime(
      { start: 1, end: 1.1 },
      "end",
      -1,
      createCutBoundaryPolicy("nudge", { nudgeStep: 0.1 }),
      { previousEnd: 0, nextStart: 10 },
    )).toBe(1.1);
  });

  it("resolves both dialog edges through one policy and media bounds", () => {
    expect(resolveBoundaryRange(
      { start: 1.234, end: 1.235 },
      createCutBoundaryPolicy("dialog"),
      { previousEnd: 0, nextStart: 10 },
    )).toEqual({ start: 1.234, end: 1.235 });
    expect(resolveBoundaryRange(
      { start: 1, end: 10.001 },
      createCutBoundaryPolicy("dialog"),
      { previousEnd: 0, nextStart: 10 },
    )).toBeNull();
  });

  it("applies minimum-duration and neighbor constraints after a policy snap", () => {
    const policy = {
      minimumDuration: 0.1,
      strict: true,
      snap: (value: number, context: { minimum: number; maximum: number }) => {
        const candidate = Math.round(value * 4) / 4;
        return candidate > context.minimum && candidate < context.maximum ? candidate : null;
      },
    };
    expect(resolveBoundaryTime(
      { start: 2, end: 4 },
      "start",
      1.64,
      policy,
      { previousEnd: 1 },
    )).toBe(1.75);
    expect(resolveBoundaryTime(
      { start: 2, end: 4 },
      "end",
      5.2,
      policy,
      { nextStart: 5 },
    )).toBeNull();
  });

  it("keeps the existing single-epsilon Sub edge predicate for snap and nudge", () => {
    const nearEnd = 1 - 1.5e-6;
    const grid: RhythmGridPoint[] = [0, nearEnd, 1].map((time) => ({
      time,
      grid: "quarter-beat" as const,
      attraction_radius: 0,
      grid_penalty: 0,
    }));
    const policy = createSubtitleBoundaryPolicy(grid);
    expect(resolveBoundaryTime({ start: 0, end: 1 }, "start", nearEnd, policy)).toBe(nearEnd);
    expect(nudgeBoundaryTime({ start: 0, end: 1 }, "start", 1, policy)).toBe(nearEnd);
  });
});

import { describe, expect, it } from "vitest";
import { nearestBoundaryTarget } from "./boundaries";
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

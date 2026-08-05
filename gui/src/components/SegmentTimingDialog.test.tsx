import { describe, expect, it } from "vitest";

import { evaluateSegmentTiming } from "@/components/SegmentTimingDialog";
import { createCutBoundaryPolicy } from "@/lib/boundaries";
import { createSubtitleBoundaryPolicy, type RhythmGridPoint } from "@/lib/subtitles";

const grid: RhythmGridPoint[] = [0, 1, 1.5, 2, 2.5, 3, 4].map((time) => ({
  time,
  grid: "quarter-beat",
  attraction_radius: 0,
  grid_penalty: 0,
}));

describe("segment timing policy", () => {
  it("accepts a 0.001 second Cut dialog range without changing timeline precision", () => {
    const evaluation = evaluateSegmentTiming({
      startInput: "1.234",
      extentInput: "0.001",
      rangeMode: "duration",
      mode: "cut",
      policy: createCutBoundaryPolicy("dialog"),
      mediaDuration: 10,
      previousEnd: 0,
      nextStart: 10,
    });
    expect(evaluation.valid).toBe(true);
    expect(evaluation.start).toBe(1.234);
    expect(evaluation.end).toBeCloseTo(1.235, 6);
  });

  it("rejects a Cut dialog range shorter than 0.001 second", () => {
    const evaluation = evaluateSegmentTiming({
      startInput: "1.234",
      extentInput: "0.000",
      rangeMode: "duration",
      mode: "cut",
      policy: createCutBoundaryPolicy("dialog"),
      mediaDuration: 10,
      previousEnd: 0,
      nextStart: 10,
    });
    expect(evaluation.valid).toBe(false);
  });

  it("snaps Sub direct input to strict rhythm points inside its neighbors", () => {
    const evaluation = evaluateSegmentTiming({
      startInput: "1.400",
      extentInput: "1.400",
      rangeMode: "duration",
      mode: "sub",
      policy: createSubtitleBoundaryPolicy(grid),
      mediaDuration: 10,
      previousEnd: 1,
      nextStart: 4,
    });
    expect(evaluation.valid).toBe(true);
    expect(evaluation.proposedStart).toBe(1.4);
    expect(evaluation.proposedEnd).toBe(2.8);
    expect(evaluation.start).toBe(1.5);
    expect(evaluation.end).toBe(3);
  });

  it("allows the first Sub segment at zero when there is no previous neighbor", () => {
    const evaluation = evaluateSegmentTiming({
      startInput: "0.000",
      extentInput: "1.000",
      rangeMode: "duration",
      mode: "sub",
      policy: createSubtitleBoundaryPolicy(grid),
      mediaDuration: 10,
      nextStart: 4,
    });
    expect(evaluation.valid).toBe(true);
    expect(evaluation.start).toBe(0);
    expect(evaluation.end).toBe(1);
  });

  it("allows the last Sub segment to end at media duration without a next neighbor", () => {
    const evaluation = evaluateSegmentTiming({
      startInput: "3.000",
      extentInput: "1.000",
      rangeMode: "duration",
      mode: "sub",
      policy: createSubtitleBoundaryPolicy(grid),
      mediaDuration: 4,
      previousEnd: 2.5,
    });
    expect(evaluation.valid).toBe(true);
    expect(evaluation.start).toBe(3);
    expect(evaluation.end).toBe(4);
  });
});

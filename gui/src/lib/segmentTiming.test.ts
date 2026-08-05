import { describe, expect, it } from "vitest";
import {
  adjacentRhythmTime,
  cutTimeArrowStep,
  formatTimeInput,
  nearestRhythmTime,
  nearestRhythmTimeInRange,
  nudgedRhythmTime,
  parseTimeInput,
} from "@/lib/segmentTiming";

const grid = [0, 0.25, 0.5, 0.75, 1].map((time) => ({
  time,
  grid: "quarter-beat" as const,
  attraction_radius: 0,
  grid_penalty: 0,
}));

describe("segment timing input", () => {
  it("accepts decimal seconds and two- or three-part timecodes", () => {
    expect(parseTimeInput("65.250")).toBe(65.25);
    expect(parseTimeInput("1:05.250")).toBe(65.25);
    expect(parseTimeInput("1:01:05.250")).toBe(3665.25);
    expect(parseTimeInput("1:65.000")).toBeNull();
    expect(parseTimeInput("65:00.000")).toBe(3900);
    expect(parseTimeInput("1.5:00.000")).toBeNull();
    expect(formatTimeInput(65.25)).toBe("1:05.250");
  });

  it("uses the requested Cut keyboard increments", () => {
    expect(cutTimeArrowStep(false, false)).toBe(0.1);
    expect(cutTimeArrowStep(true, false)).toBe(0.001);
    expect(cutTimeArrowStep(false, true)).toBe(1);
    expect(cutTimeArrowStep(true, true)).toBe(1);
  });

  it("keeps Cut boundary movement in decimal seconds", () => {
    const start = 0.37;
    expect(formatTimeInput(start + cutTimeArrowStep(false, false))).toBe("0:00.470");
  });

  it("finds nearest and bounded adjacent quarter-beat positions", () => {
    expect(nearestRhythmTime(grid, 0.62)).toBe(0.5);
    expect(nearestRhythmTimeInRange(grid, 0.62, 0.25, 0.9)).toBe(0.5);
    expect(nearestRhythmTimeInRange(grid, 0.1, 0.25, 0.5)).toBeNull();
    expect(nudgedRhythmTime(grid, 0.5, 1)).toBe(0.75);
    expect(nudgedRhythmTime(grid, 0, -1)).toBe(0);
    expect(adjacentRhythmTime(grid, 0.5, 1, 0, 0.75)).toBe(0.75);
    expect(adjacentRhythmTime(grid, 0.5, -1, 0.25, 1)).toBe(0.25);
    expect(adjacentRhythmTime(grid, 0.75, 1, 0, 0.75)).toBeNull();
  });
});

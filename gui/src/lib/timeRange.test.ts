import { describe, expect, it } from "vitest";
import {
  boundaryTime,
  isValidTimeRange,
  rangeDuration,
  rangesOverlap,
  withBoundary,
} from "./timeRange";

describe("time range primitive", () => {
  it("works with both plain ranges and timed entities", () => {
    const range = { start: 1.25, end: 4.5 };
    expect(rangeDuration(range)).toBe(3.25);
    expect(boundaryTime(range, "start")).toBe(1.25);
    expect(boundaryTime(range, "end")).toBe(4.5);
    expect(withBoundary(range, "end", 5)).toEqual({ start: 1.25, end: 5 });
  });

  it("uses the shared epsilon for validity and overlap checks", () => {
    expect(isValidTimeRange({ start: 2, end: 2 }, 0)).toBe(true);
    expect(isValidTimeRange({ start: 2, end: 2 }, 0.001)).toBe(false);
    expect(rangesOverlap({ start: 0, end: 1 }, { start: 1, end: 2 })).toBe(false);
    expect(rangesOverlap({ start: 0, end: 1 }, { start: 0.5, end: 2 })).toBe(true);
  });
});

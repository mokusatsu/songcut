import { describe, expect, it } from "vitest";
import {
  timelineFocusScrollLeft,
  timelineFollowScrollLeft,
  timelineScrubAutoScroll,
  timelineWheelScrollLeft,
} from "@/lib/useTimelineViewport";

describe("timelineFollowScrollLeft", () => {
  it("keeps the shared follow policy identical for Cut and Sub timelines", () => {
    const input = {
      scrollLeft: 200,
      viewportWidth: 100,
      contentWidth: 1000,
      playheadX: 295,
      playing: true,
      editing: false,
    };

    for (const mode of ["cut", "sub"] as const) {
      expect({ mode, scrollLeft: timelineFollowScrollLeft(input) }).toEqual({ mode, scrollLeft: 225 });
    }
  });

  it("keeps a playing cursor inside the 10-90% safe region", () => {
    expect(
      timelineFollowScrollLeft({
        scrollLeft: 200,
        viewportWidth: 100,
        contentWidth: 1000,
        playheadX: 250,
        playing: true,
        editing: false,
      })
    ).toBe(200);
  });

  it("places a playing cursor at 70% after it crosses the right threshold", () => {
    expect(
      timelineFollowScrollLeft({
        scrollLeft: 200,
        viewportWidth: 100,
        contentWidth: 1000,
        playheadX: 295,
        playing: true,
        editing: false,
      })
    ).toBe(225);
  });

  it("places a playing cursor at 30% after it crosses the left threshold", () => {
    expect(
      timelineFollowScrollLeft({
        scrollLeft: 500,
        viewportWidth: 100,
        contentWidth: 1000,
        playheadX: 505,
        playing: true,
        editing: false,
      })
    ).toBe(475);
  });

  it("only moves a paused cursor when it is completely outside the viewport", () => {
    expect(
      timelineFollowScrollLeft({
        scrollLeft: 200,
        viewportWidth: 100,
        contentWidth: 1000,
        playheadX: 205,
        playing: false,
        editing: false,
      })
    ).toBe(200);
    expect(
      timelineFollowScrollLeft({
        scrollLeft: 200,
        viewportWidth: 100,
        contentWidth: 1000,
        playheadX: 350,
        playing: false,
        editing: false,
      })
    ).toBe(280);
  });

  it("does not follow while scrubbing or editing a boundary", () => {
    expect(
      timelineFollowScrollLeft({
        scrollLeft: 200,
        viewportWidth: 100,
        contentWidth: 1000,
        playheadX: 900,
        playing: true,
        editing: true,
      })
    ).toBe(200);
  });
});

describe("timelineFocusScrollLeft", () => {
  it("does not move a selected segment that is already fully visible", () => {
    expect(
      timelineFocusScrollLeft({
        scrollLeft: 350,
        viewportWidth: 200,
        contentWidth: 1000,
        segmentStartX: 400,
        segmentEndX: 500,
      })
    ).toBe(350);
  });

  it("centers a fitting segment only when it is not fully visible", () => {
    expect(
      timelineFocusScrollLeft({
        scrollLeft: 200,
        viewportWidth: 200,
        contentWidth: 1000,
        segmentStartX: 400,
        segmentEndX: 500,
      })
    ).toBe(350);
  });

  it("places the start of an oversized segment at a 10% margin", () => {
    expect(
      timelineFocusScrollLeft({
        scrollLeft: 350,
        viewportWidth: 200,
        contentWidth: 1000,
        segmentStartX: 400,
        segmentEndX: 700,
      })
    ).toBe(380);
  });

  it("focuses an offscreen fitting segment before paused-cursor following is evaluated", () => {
    const focused = timelineFocusScrollLeft({
      scrollLeft: 0,
      viewportWidth: 200,
      contentWidth: 1000,
      segmentStartX: 400,
      segmentEndX: 420,
    });
    expect(focused).toBe(310);
    expect(
      timelineFollowScrollLeft({
        scrollLeft: focused,
        viewportWidth: 200,
        contentWidth: 1000,
        playheadX: 400,
        playing: false,
        editing: false,
      })
    ).toBe(310);
  });
});

describe("timelineWheelScrollLeft", () => {
  it("uses the dominant wheel axis and normalizes line and page deltas", () => {
    expect(timelineWheelScrollLeft(100, 200, 1000, 5, 2, 0)).toBe(105);
    expect(timelineWheelScrollLeft(100, 200, 1000, 0, 2, 1)).toBe(148);
    expect(timelineWheelScrollLeft(100, 200, 1000, 0, 1, 2)).toBe(300);
  });

  it("clamps scrolling to the content boundaries", () => {
    expect(timelineWheelScrollLeft(790, 200, 1000, 0, 100, 0)).toBe(800);
    expect(timelineWheelScrollLeft(10, 200, 1000, 0, -100, 0)).toBe(0);
  });
});

describe("timelineScrubAutoScroll", () => {
  const baseInput = {
    viewportWidth: 400,
    contentWidth: 1200,
    viewportLeft: 100,
    viewportRight: 500,
    elapsedSeconds: 0.016,
  };

  it("does not request another scratch when the pointer is at the left content limit", () => {
    expect(
      timelineScrubAutoScroll({
        ...baseInput,
        scrollLeft: 0,
        clientX: 100,
      })
    ).toEqual({ scrollLeft: 0, didScroll: false });
  });

  it("moves only when an edge drag can actually advance the viewport", () => {
    const result = timelineScrubAutoScroll({
      ...baseInput,
      scrollLeft: 200,
      clientX: 499,
    });
    expect(result.didScroll).toBe(true);
    expect(result.scrollLeft).toBeGreaterThan(200);
    expect(result.scrollLeft).toBeLessThanOrEqual(800);
  });

  it("does not request another scratch after reaching the right content limit", () => {
    expect(
      timelineScrubAutoScroll({
        ...baseInput,
        scrollLeft: 800,
        clientX: 499,
      })
    ).toEqual({ scrollLeft: 800, didScroll: false });
  });

  it("keeps a normal drag out of the auto-scroll path", () => {
    expect(
      timelineScrubAutoScroll({
        ...baseInput,
        scrollLeft: 200,
        clientX: 300,
      })
    ).toEqual({ scrollLeft: 200, didScroll: false });
  });
});

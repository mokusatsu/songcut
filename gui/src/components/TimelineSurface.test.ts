import { describe, expect, it } from "vitest";

import {
  isTimelineWaveformTarget,
  renderTimelineSurfaceSlot,
  shouldRouteTimelineWheel,
  type TimelineSurfaceContext,
} from "@/components/TimelineSurface";

describe("TimelineSurface slots", () => {
  const context = {
    width: 720,
    viewportRef: { current: null },
    timeFromClientX: () => 0,
    scrubFromClientX: () => undefined,
    stopScrubAutoScroll: () => undefined,
    scrollByWheel: () => undefined,
  } as unknown as TimelineSurfaceContext;

  it("preserves static mode content", () => {
    expect(renderTimelineSurfaceSlot("mode-row", context)).toBe("mode-row");
  });

  it("resolves mode slots against the shared width and viewport context", () => {
    expect(renderTimelineSurfaceSlot(({ width }) => width, context)).toBe(720);
  });

  it("routes all wheel events for Cut but only waveform events for Sub", () => {
    expect(shouldRouteTimelineWheel("surface", false)).toBe(true);
    expect(shouldRouteTimelineWheel("surface", true)).toBe(true);
    expect(shouldRouteTimelineWheel("waveform", true)).toBe(true);
    expect(shouldRouteTimelineWheel("waveform", false)).toBe(false);
  });

  it("detects waveform descendants through a closest-like target", () => {
    const waveformTarget = {
      closest: (selector: string) => selector === ".timeline-waveform-surface" ? {} : null,
    } as unknown as EventTarget;
    const laneTarget = {
      closest: () => null,
    } as unknown as EventTarget;
    expect(isTimelineWaveformTarget(waveformTarget)).toBe(true);
    expect(isTimelineWaveformTarget(laneTarget)).toBe(false);
    expect(isTimelineWaveformTarget(null)).toBe(false);
  });
});

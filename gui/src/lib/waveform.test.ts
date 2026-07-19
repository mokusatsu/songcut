import { describe, expect, it } from "vitest";
import {
  buildWaveformPath,
  buildWaveformPathSpecs,
  buildWaveformPyramid,
  mergeWaveformPoints,
  normalizeWaveformDisplayMode,
  selectWaveformLevel
} from "@/lib/waveform";
import type { WaveformPoint } from "@/types";

function point(t: number, min: number, max: number, rms: number, sampleCount = 1): WaveformPoint {
  return { t, min, max, rms, sample_count: sampleCount };
}

describe("waveform pyramid", () => {
  it("preserves peaks and uses sample-weighted RMS and time", () => {
    const merged = mergeWaveformPoints(point(1, -0.2, 0.4, 0.25, 1), point(3, -0.8, 0.3, 0.5, 3));

    expect(merged.min).toBe(-0.8);
    expect(merged.max).toBe(0.4);
    expect(merged.sample_count).toBe(4);
    expect(merged.t).toBe(2.5);
    expect(merged.rms).toBeCloseTo(Math.sqrt((0.25 ** 2 + 0.5 ** 2 * 3) / 4));
  });

  it("carries an odd final point without losing it", () => {
    const last = point(5, -1, 1, 0.75, 2);
    const pyramid = buildWaveformPyramid([point(1, -0.1, 0.2, 0.1), point(3, -0.3, 0.4, 0.2), last]);

    expect(pyramid.map((level) => level.length)).toEqual([3, 2, 1]);
    expect(pyramid[1][1]).toBe(last);
    expect(pyramid.at(-1)?.[0].min).toBe(-1);
    expect(pyramid.at(-1)?.[0].max).toBe(1);
    expect(pyramid.at(-1)?.[0].sample_count).toBe(4);
  });

  it("keeps newly aggregated point objects below twice the base count", () => {
    const base = Array.from({ length: 21600 }, (_, index) => point(index + 0.5, -0.1, 0.1, 0.05, 4000));
    const pyramid = buildWaveformPyramid(base);
    const uniquePoints = new Set(pyramid.flat());

    expect(uniquePoints.size).toBeLessThan(base.length * 2);
    expect(pyramid.at(-1)).toHaveLength(1);
  });
});

describe("waveform LOD", () => {
  it("selects the expected levels for a three-hour timeline", () => {
    const base = Array.from({ length: 10800 }, (_, index) => point(index + 0.5, -0.1, 0.1, 0.05));
    const pyramid = buildWaveformPyramid(base);

    expect(selectWaveformLevel(pyramid, 10800, 900)).toBe(4);
    expect(selectWaveformLevel(pyramid, 10800, 1800)).toBe(3);
    expect(selectWaveformLevel(pyramid, 10800, 3600)).toBe(2);
    expect(selectWaveformLevel(pyramid, 10800, 7200)).toBe(1);
    expect(selectWaveformLevel(pyramid, 10800, 14400)).toBe(0);
    expect(selectWaveformLevel(pyramid, 10800, 28800)).toBe(0);
  });

  it("keeps capped long-form pyramid and path generation within the target budgets", () => {
    const base = Array.from({ length: 21600 }, (_, index) => point(index * 4 + 2, -0.1, 0.2, 0.05, 16000));
    const pyramidStarted = performance.now();
    const pyramid = buildWaveformPyramid(base);
    const pyramidMilliseconds = performance.now() - pyramidStarted;

    const selectedLevel = selectWaveformLevel(pyramid, 24 * 3600, 28800);
    const pathStarted = performance.now();
    const paths = buildWaveformPathSpecs(pyramid[selectedLevel], 24 * 3600, 28800, "peak-rms");
    const pathMilliseconds = performance.now() - pathStarted;

    expect(selectedLevel).toBe(0);
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.d.length > 0)).toBe(true);
    expect(pyramidMilliseconds).toBeLessThan(250);
    expect(pathMilliseconds).toBeLessThan(100);
  });
});

describe("waveform paths and display settings", () => {
  const points = [point(5, -0.1, 0.2, 0.05)];

  it("builds one SVG subpath per point", () => {
    expect(buildWaveformPath(points, 10, 100, "rms")).toBe("M50 -12V98");
    expect(buildWaveformPath(points, 10, 100, "peak")).toBe("M50 -177V153");
  });

  it("builds one active path for single modes and two for the combined mode", () => {
    expect(buildWaveformPathSpecs(points, 10, 100, "rms").map((spec) => spec.kind)).toEqual(["rms"]);
    expect(buildWaveformPathSpecs(points, 10, 100, "peak").map((spec) => spec.kind)).toEqual(["peak"]);
    expect(buildWaveformPathSpecs(points, 10, 100, "peak-rms").map((spec) => spec.kind)).toEqual(["peak", "rms"]);
    expect(buildWaveformPathSpecs(points, 10, 100, "peak-rms")[0].opacity).toBe(0.45);
  });

  it("falls back to RMS for unknown persisted values", () => {
    expect(normalizeWaveformDisplayMode("peak")).toBe("peak");
    expect(normalizeWaveformDisplayMode("unexpected")).toBe("rms");
    expect(normalizeWaveformDisplayMode(null)).toBe("rms");
  });
});

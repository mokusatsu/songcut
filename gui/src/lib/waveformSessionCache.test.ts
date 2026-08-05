import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAVEFORM_CHANNELS,
  DEFAULT_WAVEFORM_GENERATOR,
  DEFAULT_WAVEFORM_SAMPLE_RATE,
  createWaveformSessionCache,
  selectWaveformHydration,
} from "@/lib/waveformSessionCache";
import type { WaveformMetadata, WaveformPoint } from "@/types";

describe("waveform session cache", () => {
  it("populates and returns a cloned hit for the same fingerprint and duration", () => {
    const cache = createWaveformSessionCache();
    const points = samplePoints();
    expect(cache.put({ fingerprint: "ABC123", points, metadata: metadata() })).toBe(true);

    const hit = cache.get({ fingerprint: "abc123", duration: 12 });
    expect(hit?.points).toEqual(points);
    expect(hit?.metadata.generator).toBe(DEFAULT_WAVEFORM_GENERATOR);
    expect(cache.size()).toBe(1);

    if (hit) hit.points[0].min = -99;
    expect(cache.get({ fingerprint: "abc123", duration: 12 })?.points[0].min).toBe(-1);
  });

  it("misses for a different fingerprint without sharing another source's waveform", () => {
    const cache = createWaveformSessionCache();
    expect(cache.put({ fingerprint: "source-a", points: samplePoints(), metadata: metadata() })).toBe(true);

    expect(cache.get({ fingerprint: "source-b", duration: 12 })).toBeNull();
    expect(cache.size()).toBe(1);
  });

  it("invalidates a fingerprint when its duration no longer matches", () => {
    const cache = createWaveformSessionCache();
    expect(cache.put({ fingerprint: "source-a", points: samplePoints(), metadata: metadata() })).toBe(true);

    expect(cache.get({ fingerprint: "source-a", duration: 13 })).toBeNull();
    expect(cache.size()).toBe(0);
    expect(cache.get({ fingerprint: "source-a", duration: 12 })).toBeNull();
  });

  it("rejects incompatible generator and encoding entries", () => {
    const generatorCache = createWaveformSessionCache({ generator: "other-generator" });
    expect(
      generatorCache.put({
        fingerprint: "source-a",
        points: samplePoints(),
        metadata: metadata({ generator: "other-generator" }),
      }),
    ).toBe(true);
    expect(generatorCache.get({ fingerprint: "source-a", duration: 12, generator: DEFAULT_WAVEFORM_GENERATOR })).toBeNull();

    const encodingCache = createWaveformSessionCache({ encoding: "other-encoding" });
    expect(
      encodingCache.put({
        fingerprint: "source-a",
        points: samplePoints(),
        metadata: metadata(),
        encoding: "other-encoding",
      }),
    ).toBe(true);
    expect(encodingCache.get({ fingerprint: "source-a", duration: 12, encoding: "f32le-4-u32le-1-v1" })).toBeNull();
  });

  it("does not populate from invalid point metadata", () => {
    const cache = createWaveformSessionCache();
    expect(cache.put({ fingerprint: "source-a", points: samplePoints(), metadata: metadata({ point_count: 1 }) })).toBe(false);
    expect(cache.size()).toBe(0);
  });

  it("prefers an opened document, then reuses the cache on a mode switch, then generates on a miss", () => {
    const cache = createWaveformSessionCache();
    const points = samplePoints();
    const document = { points, metadata: metadata(), encoding: "f32le-4-u32le-1-v1" };

    expect(selectWaveformHydration(cache, { fingerprint: "source-a", duration: 12, document }).source).toBe("document");
    expect(selectWaveformHydration(cache, { fingerprint: "source-a", duration: 12, document: null }).source).toBe("session-cache");
    expect(selectWaveformHydration(cache, { fingerprint: "source-b", duration: 12, document: null })).toMatchObject({
      source: "generate",
      points: [],
      metadata: null,
    });
  });

  it("keeps a valid document snapshot first even when it cannot populate the current generator cache", () => {
    const cache = createWaveformSessionCache();
    const decision = selectWaveformHydration(cache, {
      fingerprint: "source-a",
      duration: 12,
      document: { points: samplePoints(), metadata: metadata({ generator: "legacy-generator" }) },
    });

    expect(decision.source).toBe("document");
    expect(cache.size()).toBe(0);
  });
});

function samplePoints(): WaveformPoint[] {
  return [
    { t: 0.1, min: -1, max: 1, rms: 0.5, sample_count: 4 },
    { t: 0.2, min: -0.8, max: 0.8, rms: 0.4, sample_count: 4 },
  ];
}

function metadata(overrides: Partial<WaveformMetadata> = {}): WaveformMetadata {
  return {
    source_path: "C:/video.mp4",
    duration: 12,
    sample_rate: DEFAULT_WAVEFORM_SAMPLE_RATE,
    channels: DEFAULT_WAVEFORM_CHANNELS,
    generator: DEFAULT_WAVEFORM_GENERATOR,
    point_count: 2,
    ...overrides,
  };
}

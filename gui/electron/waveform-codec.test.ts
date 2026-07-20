import { describe, expect, it } from "vitest";

import {
  WAVEFORM_BINARY_ENCODING,
  WAVEFORM_BINARY_RECORD_BYTES,
  decodeWaveformPoints,
  encodeWaveformPoints,
} from "./waveform-codec.js";

describe("waveform binary codec", () => {
  it("round-trips fixed-width little-endian waveform records", () => {
    const points = [
      { t: 0.123456, min: -0.87654, max: 0.76543, rms: 0.345678, sample_count: 17 },
      { t: 12_345.678, min: -1, max: 1, rms: 0.999999, sample_count: 4_000 },
    ];

    const encoded = encodeWaveformPoints(points);
    const decoded = decodeWaveformPoints(encoded, points.length);

    expect(WAVEFORM_BINARY_ENCODING).toBe("f32le-4-u32le-1-v1");
    expect(encoded).toHaveLength(Math.ceil((points.length * WAVEFORM_BINARY_RECORD_BYTES) / 3) * 4);
    expect(decoded.map((point) => point.sample_count)).toEqual([17, 4_000]);
    decoded.forEach((point, index) => {
      expect(point.t).toBeCloseTo(points[index].t, 3);
      expect(point.min).toBeCloseTo(points[index].min, 5);
      expect(point.max).toBeCloseTo(points[index].max, 5);
      expect(point.rms).toBeCloseTo(points[index].rms, 5);
    });
  });

  it("is substantially smaller than JSON point objects", () => {
    const points = Array.from({ length: 2_400 }, (_, index) => ({
      t: index / 10,
      min: -0.5,
      max: 0.5,
      rms: 0.25,
      sample_count: 4_000,
    }));

    const encoded = encodeWaveformPoints(points);
    expect(encoded.length).toBe(64_000);
    expect(encoded.length).toBeLessThan(JSON.stringify(points).length / 2);
  });

  it("rejects malformed Base64 or a mismatched point count", () => {
    expect(() => decodeWaveformPoints("not base64", 1)).toThrow(/Base64/i);
    expect(() => decodeWaveformPoints(encodeWaveformPoints([{ t: 0, min: 0, max: 0, rms: 0, sample_count: 1 }]), 2)).toThrow(
      /length/i,
    );
  });
});

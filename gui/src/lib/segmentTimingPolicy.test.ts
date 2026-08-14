import { describe, expect, it } from "vitest";

import { createCutBoundaryPolicy } from "@/lib/boundaries";
import { createSegmentStyleDraft, evaluateSegmentTiming } from "@/lib/segmentTiming";
import {
  DEFAULT_SUBTITLE_STYLE,
  createSubtitleBoundaryPolicy,
  type RhythmGridPoint,
} from "@/lib/subtitles";
import { DEFAULT_SUBTITLE_EFFECT, type SubtitleEffectCatalog } from "@/lib/subtitleEffects";

const effectCatalog = {
  package: "ass-lyric-effects",
  version: "3.0.0",
  schema_version: "1.0",
  stable_id_contract: {},
  multiline_context_contract: {},
  effects: ["cut", "fad", "glow"].map((effect_id) => ({
    effect_id,
    stable_effect_id: true,
    name_en: effect_id,
    name_ja: effect_id,
    description_en: effect_id,
    description_ja: effect_id,
    parameters: {},
  })),
} satisfies SubtitleEffectCatalog;

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

describe("Sub segment style inspector draft", () => {
  const target = { id: "segment", start: 1, end: 2 };

  it("starts an inherited segment from the current timeline settings", () => {
    expect(createSegmentStyleDraft(
      target,
      { ...DEFAULT_SUBTITLE_STYLE, font_size: 72 },
      { ...DEFAULT_SUBTITLE_EFFECT, name: "fad" },
      effectCatalog,
    )).toMatchObject({
      mode: "inherit",
      style: { font_size: 72 },
      effect: { name: "fad" },
    });
  });

  it("restores a persisted custom draft independently from the timeline", () => {
    expect(createSegmentStyleDraft(
      {
        ...target,
        style_override: { ...DEFAULT_SUBTITLE_STYLE, font_size: 36 },
        effect_override: { ...DEFAULT_SUBTITLE_EFFECT, name: "glow" },
      },
      { ...DEFAULT_SUBTITLE_STYLE, font_size: 120 },
      DEFAULT_SUBTITLE_EFFECT,
      effectCatalog,
    )).toMatchObject({
      mode: "custom",
      style: { font_size: 36 },
      effect: { name: "glow" },
    });
  });
});

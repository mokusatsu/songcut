import { describe, expect, it } from "vitest";
import {
  SUBTITLE_EFFECTS,
  defaultSubtitleEffectParams,
  normalizeSubtitleEffect,
} from "./subtitleEffects";

describe("subtitle effect catalogue", () => {
  it("exposes all 23 effects from ass-effects23", () => {
    expect(SUBTITLE_EFFECTS).toHaveLength(23);
    expect(SUBTITLE_EFFECTS[0].name).toBe("cut");
    expect(SUBTITLE_EFFECTS.at(-1)?.name).toBe("dissolve");
  });

  it("resets effect-specific parameters to the selected effect defaults", () => {
    expect(defaultSubtitleEffectParams("bounce")).toEqual({
      peak: 128,
      valley: 88,
      rebound: 108,
    });
  });

  it("normalizes persisted settings and removes parameters from another effect", () => {
    expect(normalizeSubtitleEffect({
      name: "zoom",
      start_duration_ms: 225.4,
      end_duration_ms: -1,
      params: { min_scale: 25, stale: 99 },
    })).toEqual({
      name: "zoom",
      start_duration_ms: 225,
      end_duration_ms: 0,
      params: { min_scale: 25 },
    });
  });
});

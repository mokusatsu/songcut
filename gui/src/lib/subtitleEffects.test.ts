import { describe, expect, it, vi } from "vitest";
import {
  defaultSubtitleEffectParams,
  normalizeSubtitleEffect,
  parseSubtitleEffectCatalog,
  type SubtitleEffectCatalog,
} from "./subtitleEffects";
import { getSubtitleEffectCatalog } from "./api";

function numberParameter(defaultValue: number, min: number, max: number) {
  return {
    kind: "number" as const,
    default: defaultValue,
    min,
    max,
    step: 0.1,
    choices: [],
    choice_labels_en: {},
    choice_labels_ja: {},
    label_en: "Value",
    label_ja: "値",
    description_en: "Value description",
    description_ja: "値の説明",
  };
}

function paletteParameter(defaultValue: string[]) {
  return {
    kind: "palette" as const,
    default: defaultValue,
    min: null,
    max: null,
    step: null,
    choices: [],
    choice_labels_en: {},
    choice_labels_ja: {},
    label_en: "Palette",
    label_ja: "パレット",
    description_en: "Palette description",
    description_ja: "パレットの説明",
  };
}

const catalog = {
  package: "ass-lyric-effects",
  version: "3.0.0",
  schema_version: "1.0",
  stable_id_contract: {},
  multiline_context_contract: {},
  effects: [
    {
      effect_id: "cut",
      stable_effect_id: true,
      name_en: "Cut",
      name_ja: "カット",
      description_en: "No effect",
      description_ja: "効果なし",
      parameters: {},
    },
    {
      effect_id: "zoom",
      stable_effect_id: true,
      name_en: "Zoom",
      name_ja: "ズーム",
      description_en: "Zoom",
      description_ja: "ズーム",
      parameters: { min_scale: numberParameter(0, 0, 99) },
    },
    {
      effect_id: "bounce",
      stable_effect_id: true,
      name_en: "Bounce",
      name_ja: "バウンス",
      description_en: "Bounce",
      description_ja: "バウンス",
      parameters: {
        peak: numberParameter(128, 105, 220),
        valley: numberParameter(88, 40, 99),
        rebound: numberParameter(108, 101, 160),
      },
    },
    {
      effect_id: "color_wave",
      stable_effect_id: true,
      name_en: "Color wave",
      name_ja: "カラーウェーブ",
      description_en: "Color wave",
      description_ja: "カラーウェーブ",
      parameters: {
        palette: paletteParameter(["&H00112233&", "&H00445566&", "&H00778899&", "&H00AABBCC&"]),
      },
    },
  ],
} as SubtitleEffectCatalog;

describe("backend-owned subtitle effect catalog", () => {
  it("uses dynamic stable IDs and schema defaults", () => {
    expect(defaultSubtitleEffectParams("bounce", catalog)).toEqual({
      peak: 128,
      valley: 88,
      rebound: 108,
    });
  });

  it("normalizes valid values and removes stale parameters", () => {
    expect(() => normalizeSubtitleEffect({
      name: "zoom",
      start_duration_ms: 225.4,
      end_duration_ms: -1,
      params: { min_scale: 125, stale: 99 },
    }, catalog)).toThrow(/Unknown subtitle effect parameter/);
    expect(normalizeSubtitleEffect({
      name: "zoom",
      start_duration_ms: 225.4,
      end_duration_ms: -1,
      params: { min_scale: 25 },
    }, catalog)).toEqual({
      name: "zoom",
      start_duration_ms: 225,
      end_duration_ms: 0,
      params: { min_scale: 25 },
    });
  });

  it("uses 750ms for omitted start and end durations", () => {
    expect(normalizeSubtitleEffect({
      name: "zoom",
      params: { min_scale: 25 },
    }, catalog)).toEqual({
      name: "zoom",
      start_duration_ms: 750,
      end_duration_ms: 750,
      params: { min_scale: 25 },
    });
  });

  it("preserves the ordered string array supplied for a palette parameter", () => {
    const palette = ["&H00010203&", "&H00040506&", "&H00070809&", "&H000A0B0C&"];
    const normalized = normalizeSubtitleEffect({
      name: "color_wave",
      params: { palette },
    }, catalog);

    expect(normalized.params.palette).toEqual(palette);
    expect(normalized.params.palette).not.toBe(palette);
  });

  it("rejects unknown effects instead of falling back to cut", () => {
    expect(() => normalizeSubtitleEffect({ name: "removed", params: {} }, catalog)).toThrow(
      /Unknown subtitle effect_id/,
    );
  });

  it("parses the JSON catalog contract", () => {
    const parsed = parseSubtitleEffectCatalog(catalog);
    expect(parsed.effects.map((effect) => effect.effect_id)).toEqual(["cut", "zoom", "bounce", "color_wave"]);
  });

  it("requests the backend catalog endpoint", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => catalog }));
    vi.stubGlobal("fetch", fetchMock);
    await getSubtitleEffectCatalog("http://127.0.0.1:8000");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/subtitle-effects/catalog");
  });
});

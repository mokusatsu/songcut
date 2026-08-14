import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  SubtitleStyleEditor,
  replacePaletteColor,
} from "@/components/SubtitleStyleEditor";
import { SubtitleEffectCatalogProvider } from "@/lib/subtitleEffectCatalog";
import type {
  SubtitleEffectCatalog,
  SubtitleEffectParameterSchema,
  SubtitleEffectSettings,
} from "@/lib/subtitleEffects";
import { DEFAULT_SUBTITLE_STYLE } from "@/lib/subtitles";
import { initializeRendererI18n } from "@/i18n";

function colorParameter(label: string): SubtitleEffectParameterSchema {
  return {
    kind: "color",
    default: "&H00112233&",
    min: null,
    max: null,
    step: null,
    choices: [],
    choice_labels_en: {},
    choice_labels_ja: {},
    label_en: label,
    label_ja: label,
    description_en: "",
    description_ja: "",
  };
}

function paletteParameter(label: string): SubtitleEffectParameterSchema {
  return {
    kind: "palette",
    default: ["&H00112233&", "&H00445566&", "&H00778899&", "&H00AABBCC&"],
    min: null,
    max: null,
    step: null,
    choices: [],
    choice_labels_en: {},
    choice_labels_ja: {},
    label_en: label,
    label_ja: label,
    description_en: "",
    description_ja: "",
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
      description_en: "",
      description_ja: "",
      parameters: {},
    },
    {
      effect_id: "color_wave",
      stable_effect_id: true,
      name_en: "Color wave",
      name_ja: "カラーウェーブ",
      description_en: "",
      description_ja: "",
      parameters: { palette: paletteParameter("Wave palette") },
    },
    {
      effect_id: "aurora_bands",
      stable_effect_id: true,
      name_en: "Aurora bands",
      name_ja: "オーロラバンド",
      description_en: "",
      description_ja: "",
      parameters: { palette: paletteParameter("Aurora palette") },
    },
    {
      effect_id: "color_pingpong",
      stable_effect_id: true,
      name_en: "Color pingpong",
      name_ja: "カラーピンポン",
      description_en: "",
      description_ja: "",
      parameters: {
        color_a: colorParameter("Color A"),
        color_b: colorParameter("Color B"),
      },
    },
  ],
} as SubtitleEffectCatalog;

function effect(name: string, params: SubtitleEffectSettings["params"]): SubtitleEffectSettings {
  return { name, start_duration_ms: 750, end_duration_ms: 750, params };
}

function renderEditor(value: SubtitleEffectSettings) {
  return renderToStaticMarkup(
    <SubtitleEffectCatalogProvider state={{ status: "ready", catalog, error: null }}>
      <SubtitleStyleEditor
        style={DEFAULT_SUBTITLE_STYLE}
        effect={value}
        fonts={[]}
        fontListError={null}
        onChange={() => undefined}
        onEffectChange={() => undefined}
      />
    </SubtitleEffectCatalogProvider>,
  );
}

function count(markup: string, token: string) {
  return markup.split(token).length - 1;
}

beforeAll(async () => {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
  await initializeRendererI18n("en");
});

describe("SubtitleStyleEditor palette parameters", () => {
  it("renders each color_wave and aurora_bands palette entry as an individual color picker", () => {
    for (const value of [
      effect("color_wave", { palette: ["&H00112233&", "&H00445566&", "&H00778899&", "&H00AABBCC&"] }),
      effect("aurora_bands", { palette: ["&H00AABBCC&", "&H00778899&", "&H00445566&", "&H00112233&"] }),
    ]) {
      const markup = renderEditor(value);
      expect(markup).toContain('class="subtitle-effect-palette-field"');
      expect(count(markup, "data-palette-index=")).toBe(4);
      expect(count(markup, 'type="color"')).toBe(7);
      expect(markup).not.toContain("<textarea");
    }
  });

  it("replaces only the changed palette entry without changing order or length", () => {
    const palette = ["&H00112233&", "&H00445566&", "&H00778899&", "&H00AABBCC&"];
    expect(replacePaletteColor(palette, 2, "&H00DDEEFF&")).toEqual([
      "&H00112233&",
      "&H00445566&",
      "&H00DDEEFF&",
      "&H00AABBCC&",
    ]);
    expect(palette).toEqual(["&H00112233&", "&H00445566&", "&H00778899&", "&H00AABBCC&"]);
  });

  it("keeps separate color controls for the existing color_pingpong parameters", () => {
    const markup = renderEditor(effect("color_pingpong", {
      color_a: "&H00112233&",
      color_b: "&H00445566&",
    }));
    expect(markup).toContain('aria-label="Color A"');
    expect(markup).toContain('aria-label="Color B"');
    expect(count(markup, 'type="color"')).toBe(5);
  });
});

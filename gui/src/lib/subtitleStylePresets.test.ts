import { describe, expect, it } from "vitest";
import { DEFAULT_SUBTITLE_STYLE } from "@/lib/subtitles";
import {
  SUBTITLE_STYLE_PRESETS_STORAGE_KEY,
  parseSubtitleStylePresets,
  readSubtitleStylePresets,
  upsertSubtitleStylePreset,
  writeSubtitleStylePresets,
} from "@/lib/subtitleStylePresets";

describe("subtitle style presets", () => {
  it("round-trips normalized presets through app-wide storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const presets = upsertSubtitleStylePreset(
      [],
      "  Main lyrics  ",
      { ...DEFAULT_SUBTITLE_STYLE, font_size: 500 },
      () => "preset-1"
    );

    writeSubtitleStylePresets(presets, storage);

    expect(values.has(SUBTITLE_STYLE_PRESETS_STORAGE_KEY)).toBe(true);
    expect(readSubtitleStylePresets(storage)).toEqual([
      {
        id: "preset-1",
        name: "Main lyrics",
        style: { ...DEFAULT_SUBTITLE_STYLE, font_size: 400 },
      },
    ]);
  });

  it("updates a preset with the same name instead of duplicating it", () => {
    const first = upsertSubtitleStylePreset(
      [],
      "Title",
      DEFAULT_SUBTITLE_STYLE,
      () => "preset-1"
    );
    const updated = upsertSubtitleStylePreset(
      first,
      "title",
      { ...DEFAULT_SUBTITLE_STYLE, bold: true },
      () => "preset-2"
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ id: "preset-1", name: "title", style: { bold: true } });
  });

  it("ignores malformed persisted data", () => {
    expect(parseSubtitleStylePresets("{")).toEqual([]);
    expect(parseSubtitleStylePresets(JSON.stringify({ version: 2, presets: [] }))).toEqual([]);
  });
});

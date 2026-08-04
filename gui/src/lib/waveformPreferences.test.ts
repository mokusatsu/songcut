import { describe, expect, it } from "vitest";

import {
  DEFAULT_WAVEFORM_DISPLAY_MODES,
  DEFAULT_CUT_WAVEFORM_AMPLITUDE_PROFILE,
  LEGACY_WAVEFORM_DISPLAY_MODE_STORAGE_KEY,
  CUT_WAVEFORM_AMPLITUDE_PROFILE_STORAGE_KEY,
  WAVEFORM_DISPLAY_MODE_STORAGE_KEYS,
  readWaveformDisplayModes,
  readCutWaveformAmplitudeProfile,
  writeCutWaveformAmplitudeProfile,
  writeWaveformDisplayMode,
} from "@/lib/waveformPreferences";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    values,
  };
}

describe("waveform display preferences", () => {
  it("uses independent Cut and Sub defaults", () => {
    expect(readWaveformDisplayModes(storage())).toEqual(DEFAULT_WAVEFORM_DISPLAY_MODES);
  });

  it("migrates the legacy value only into Cut", () => {
    const result = readWaveformDisplayModes(
      storage({ [LEGACY_WAVEFORM_DISPLAY_MODE_STORAGE_KEY]: "peak-rms" })
    );
    expect(result).toEqual({ cut: "peak-rms", sub: "symmetric-peak" });
  });

  it("prefers mode-specific values and falls back independently", () => {
    const result = readWaveformDisplayModes(
      storage({
        [LEGACY_WAVEFORM_DISPLAY_MODE_STORAGE_KEY]: "peak-rms",
        [WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.cut]: "peak",
        [WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.sub]: "unexpected",
      })
    );
    expect(result).toEqual({ cut: "peak", sub: "symmetric-peak" });

    const invalidCut = readWaveformDisplayModes(
      storage({
        [LEGACY_WAVEFORM_DISPLAY_MODE_STORAGE_KEY]: "peak-rms",
        [WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.cut]: "unexpected",
        [WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.sub]: "rms",
      })
    );
    expect(invalidCut).toEqual({ cut: "rms", sub: "rms" });
  });

  it("writes only the selected mode", () => {
    const target = storage({ [WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.cut]: "peak" });
    writeWaveformDisplayMode(target, "sub", "rms");
    expect(target.values.get(WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.sub)).toBe("rms");
    expect(target.values.get(WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.cut)).toBe("peak");
  });
});

describe("Cut waveform amplitude preference", () => {
  it("defaults invalid and missing values to the legacy x1100 contrast range", () => {
    expect(readCutWaveformAmplitudeProfile(storage())).toBe(DEFAULT_CUT_WAVEFORM_AMPLITUDE_PROFILE);
    expect(
      readCutWaveformAmplitudeProfile(
        storage({ [CUT_WAVEFORM_AMPLITUDE_PROFILE_STORAGE_KEY]: "unexpected" })
      )
    ).toBe("singing-mc-contrast");
    expect(
      readCutWaveformAmplitudeProfile(
        storage({ [CUT_WAVEFORM_AMPLITUDE_PROFILE_STORAGE_KEY]: "adaptive" })
      )
    ).toBe("adaptive");
  });

  it("persists the singing and MC contrast profile independently", () => {
    const target = storage({ [WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.cut]: "peak" });
    writeCutWaveformAmplitudeProfile(target, "singing-mc-contrast");
    expect(target.values.get(CUT_WAVEFORM_AMPLITUDE_PROFILE_STORAGE_KEY)).toBe("singing-mc-contrast");
    expect(target.values.get(WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.cut)).toBe("peak");
  });
});

import { describe, expect, it } from "vitest";

import {
  normalizeScratchAudioProxyEnabled,
  selectScratchPreviewSource,
  scratchProxyStatusLabel,
  shouldCreateScratchProxy
} from "@/lib/scratchProxy";

describe("scratch audio proxy settings", () => {
  it("defaults missing and invalid values to enabled", () => {
    expect(normalizeScratchAudioProxyEnabled(null)).toBe(true);
    expect(normalizeScratchAudioProxyEnabled(undefined)).toBe(true);
    expect(normalizeScratchAudioProxyEnabled("invalid")).toBe(true);
  });

  it("restores explicit boolean values", () => {
    expect(normalizeScratchAudioProxyEnabled("true")).toBe(true);
    expect(normalizeScratchAudioProxyEnabled("false")).toBe(false);
    expect(normalizeScratchAudioProxyEnabled(true)).toBe(true);
    expect(normalizeScratchAudioProxyEnabled(false)).toBe(false);
  });

  it("creates proxies only for Opus while enabled", () => {
    expect(shouldCreateScratchProxy(true, "opus")).toBe(true);
    expect(shouldCreateScratchProxy(true, "OPUS")).toBe(true);
    expect(shouldCreateScratchProxy(true, "aac")).toBe(false);
    expect(shouldCreateScratchProxy(false, "opus")).toBe(false);
  });

  it("uses original audio before readiness and whenever proxy use is disabled", () => {
    expect(selectScratchPreviewSource(true, false, true)).toBe("original");
    expect(selectScratchPreviewSource(true, true, true)).toBe("proxy");
    expect(selectScratchPreviewSource(false, true, true)).toBe("original");
    expect(selectScratchPreviewSource(true, true, false)).toBe("original");
  });

  it("labels each fallback and ready state", () => {
    expect(scratchProxyStatusLabel("original")).toContain("Original");
    expect(scratchProxyStatusLabel("preparing")).toContain("Preparing");
    expect(scratchProxyStatusLabel("ready")).toContain("AAC proxy");
    expect(scratchProxyStatusLabel("failed")).toContain("failed");
    expect(scratchProxyStatusLabel("disabled")).toContain("Disabled");
  });
});

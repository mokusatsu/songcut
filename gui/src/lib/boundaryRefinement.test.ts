import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BOUNDARY_REFINEMENT_STORAGE_KEY,
  DEFAULT_BOUNDARY_REFINEMENT_SETTINGS,
  normalizeBoundaryRefinementSettings,
  readBoundaryRefinementSettings,
  writeBoundaryRefinementSettings,
} from "./boundaryRefinement";

describe("boundary refinement settings", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
  });

  it("defaults to enabled and falls back after corrupt storage", () => {
    expect(readBoundaryRefinementSettings()).toEqual(DEFAULT_BOUNDARY_REFINEMENT_SETTINGS);
    storage.set(BOUNDARY_REFINEMENT_STORAGE_KEY, "{");
    expect(readBoundaryRefinementSettings()).toEqual(DEFAULT_BOUNDARY_REFINEMENT_SETTINGS);
  });

  it("clamps ranges and preserves the hysteresis ordering", () => {
    const normalized = normalizeBoundaryRefinementSettings({
      enabled: false,
      search_radius_seconds: 999,
      rms_window_ms: 73,
      low_occupancy: 0.5,
      high_occupancy: 0.5,
    });
    expect(normalized.enabled).toBe(false);
    expect(normalized.search_radius_seconds).toBe(120);
    expect(normalized.rms_window_ms).toBe(70);
    expect(normalized.low_occupancy).toBeLessThan(normalized.high_occupancy);
  });

  it("round trips all values through the versioned key", () => {
    writeBoundaryRefinementSettings({ ...DEFAULT_BOUNDARY_REFINEMENT_SETTINGS, post_roll_seconds: 0.7 });
    expect(JSON.parse(storage.get(BOUNDARY_REFINEMENT_STORAGE_KEY) ?? "{}").post_roll_seconds).toBe(0.7);
    expect(readBoundaryRefinementSettings().post_roll_seconds).toBe(0.7);
  });
});

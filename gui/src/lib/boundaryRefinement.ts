export type BoundaryRefinementSettings = {
  enabled: boolean;
  search_radius_seconds: number;
  rms_window_ms: number;
  occupancy_window_seconds: number;
  high_occupancy: number;
  low_occupancy: number;
  start_persistence_seconds: number;
  end_persistence_seconds: number;
  contrast_window_seconds: number;
  pre_roll_seconds: number;
  post_roll_seconds: number;
};

export const BOUNDARY_REFINEMENT_STORAGE_KEY = "songcut:boundary-refinement:v1";

export const DEFAULT_BOUNDARY_REFINEMENT_SETTINGS: BoundaryRefinementSettings = {
  enabled: true,
  search_radius_seconds: 30,
  rms_window_ms: 80,
  occupancy_window_seconds: 2,
  high_occupancy: 0.8,
  low_occupancy: 0.35,
  start_persistence_seconds: 2,
  end_persistence_seconds: 3,
  contrast_window_seconds: 5,
  pre_roll_seconds: 0.5,
  post_roll_seconds: 1,
};

const limits: Record<Exclude<keyof BoundaryRefinementSettings, "enabled">, [number, number]> = {
  search_radius_seconds: [5, 120],
  rms_window_ms: [50, 100],
  occupancy_window_seconds: [0.5, 10],
  high_occupancy: [0.5, 1],
  low_occupancy: [0, 0.5],
  start_persistence_seconds: [0.5, 10],
  end_persistence_seconds: [0.5, 15],
  contrast_window_seconds: [1, 15],
  pre_roll_seconds: [0.3, 1],
  post_roll_seconds: [0.3, 1],
};

export function normalizeBoundaryRefinementSettings(value: unknown): BoundaryRefinementSettings {
  const source = value && typeof value === "object" ? (value as Partial<BoundaryRefinementSettings>) : {};
  const result = { ...DEFAULT_BOUNDARY_REFINEMENT_SETTINGS };
  result.enabled = typeof source.enabled === "boolean" ? source.enabled : result.enabled;
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const raw = source[key];
    const [minimum, maximum] = limits[key];
    if (typeof raw === "number" && Number.isFinite(raw)) result[key] = Math.min(maximum, Math.max(minimum, raw));
  }
  result.rms_window_ms = Math.round(result.rms_window_ms / 10) * 10;
  if (result.low_occupancy >= result.high_occupancy) {
    result.low_occupancy = Math.max(0, Math.min(0.5, result.high_occupancy - 0.05));
  }
  return result;
}

export function readBoundaryRefinementSettings(): BoundaryRefinementSettings {
  try {
    const raw = window.localStorage.getItem(BOUNDARY_REFINEMENT_STORAGE_KEY);
    return raw ? normalizeBoundaryRefinementSettings(JSON.parse(raw)) : { ...DEFAULT_BOUNDARY_REFINEMENT_SETTINGS };
  } catch {
    return { ...DEFAULT_BOUNDARY_REFINEMENT_SETTINGS };
  }
}

export function writeBoundaryRefinementSettings(settings: BoundaryRefinementSettings) {
  window.localStorage.setItem(
    BOUNDARY_REFINEMENT_STORAGE_KEY,
    JSON.stringify(normalizeBoundaryRefinementSettings(settings))
  );
}

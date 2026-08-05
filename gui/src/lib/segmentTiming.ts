import type { RhythmGridPoint } from "@/lib/subtitles";

const EPSILON = 1e-6;

export function parseTimeInput(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!text.includes(":")) {
    const seconds = Number(text);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }
  const parts = text.split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;
  if (!/^\d+(?:\.\d+)?$/.test(parts.at(-1)!)) return null;
  if (parts.slice(0, -1).some((part) => !/^\d+$/.test(part))) return null;
  const values = parts.map(Number);
  const seconds = values.at(-1)!;
  const minutes = values.at(-2)!;
  const hours = parts.length === 3 ? values[0] : 0;
  if (
    seconds >= 60 ||
    (parts.length === 3 && minutes >= 60) ||
    values.some((part) => !Number.isFinite(part))
  ) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatTimeInput(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMilliseconds = Math.round(safe * 1000);
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const second = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minute = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);
  const suffix = `${String(second).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
  return hour > 0
    ? `${hour}:${String(minute).padStart(2, "0")}:${suffix}`
    : `${minute}:${suffix}`;
}

export function cutTimeArrowStep(shiftKey: boolean, ctrlKey: boolean): number {
  if (ctrlKey) return 1;
  if (shiftKey) return 0.001;
  return 0.1;
}

export function rhythmGridTimes(grid: readonly RhythmGridPoint[]): number[] {
  return [...new Set(grid.map((point) => point.time).filter((time) => Number.isFinite(time) && time >= 0))]
    .sort((left, right) => left - right);
}

export function nearestRhythmTime(grid: readonly RhythmGridPoint[], value: number): number | null {
  const times = rhythmGridTimes(grid);
  if (!times.length || !Number.isFinite(value)) return null;
  return times.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  );
}

/** Finds the nearest rhythm point strictly inside a candidate boundary range. */
export function nearestRhythmTimeInRange(
  grid: readonly RhythmGridPoint[],
  value: number,
  minimum: number,
  maximum: number,
): number | null {
  const times = rhythmGridTimes(grid).filter(
    (time) => time > minimum + EPSILON && time < maximum - EPSILON,
  );
  if (!times.length || !Number.isFinite(value)) return null;
  return times.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  );
}

export function adjacentRhythmTime(
  grid: readonly RhythmGridPoint[],
  value: number,
  direction: -1 | 1,
  minimum: number,
  maximum: number,
): number | null {
  const valid = rhythmGridTimes(grid).filter((time) => time >= minimum - EPSILON && time <= maximum + EPSILON);
  if (direction > 0) return valid.find((time) => time > value + EPSILON) ?? null;
  return [...valid].reverse().find((time) => time < value - EPSILON) ?? null;
}

/** Moves one index from the nearest grid point, matching the subtitle nudge contract. */
export function nudgedRhythmTime(
  grid: readonly RhythmGridPoint[],
  value: number,
  direction: -1 | 1,
): number | null {
  const times = rhythmGridTimes(grid);
  if (!times.length || !Number.isFinite(value)) return null;
  let nearestIndex = 0;
  for (let index = 1; index < times.length; index += 1) {
    if (Math.abs(times[index] - value) < Math.abs(times[nearestIndex] - value)) nearestIndex = index;
  }
  return times[Math.max(0, Math.min(times.length - 1, nearestIndex + direction))] ?? null;
}

export function isOnRhythmGrid(grid: readonly RhythmGridPoint[], value: number): boolean {
  const nearest = nearestRhythmTime(grid, value);
  return nearest !== null && Math.abs(nearest - value) <= 0.0005;
}

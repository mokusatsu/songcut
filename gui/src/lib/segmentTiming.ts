import {
  resolveBoundaryRange,
  type BoundaryPolicy,
} from "@/lib/boundaries";
import type { RhythmGridPoint, SubtitleStyle } from "@/lib/subtitles";
import { normalizeSubtitleStyle } from "@/lib/subtitles";
import {
  normalizeSubtitleEffect,
  type SubtitleEffectCatalog,
  type SubtitleEffectSettings,
} from "@/lib/subtitleEffects";
import { TIME_RANGE_EPSILON } from "@/lib/timeRange";
import { tr } from "@/i18n";

const EPSILON = 1e-6;

export type SegmentTimingTarget = {
  id: string;
  start: number;
  end: number;
  style_override?: SubtitleStyle;
  effect_override?: SubtitleEffectSettings;
};

export type SegmentStyleDraftState = {
  mode: "inherit" | "custom";
  style: SubtitleStyle;
  effect: SubtitleEffectSettings;
};

export type SegmentRangeMode = "duration" | "end";

/** `parseTimeInput`の外部表現を検証し、アプリ内部で扱う状態へ復元する。 */
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

/** `formatTimeInput`の値を現在のlocaleと表示規則に沿った文字列へ整形する。 */
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

/** `cutTimeArrowStep`でtimeline入力をCut刻みまたはrhythm grid上の時刻へ変換する。 */
export function cutTimeArrowStep(shiftKey: boolean, ctrlKey: boolean): number {
  if (ctrlKey) return 1;
  if (shiftKey) return 0.001;
  return 0.1;
}

/** `rhythmGridTimes`でtimeline入力をCut刻みまたはrhythm grid上の時刻へ変換する。 */
export function rhythmGridTimes(grid: readonly RhythmGridPoint[]): number[] {
  return [...new Set(grid.map((point) => point.time).filter((time) => Number.isFinite(time) && time >= 0))]
    .sort((left, right) => left - right);
}

/** `nearestRhythmTime`の候補と条件から、利用すべき値または操作を決定する。 */
export function nearestRhythmTime(grid: readonly RhythmGridPoint[], value: number): number | null {
  const times = rhythmGridTimes(grid);
  if (!times.length || !Number.isFinite(value)) return null;
  return times.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  );
}

/** Finds the nearest rhythm point strictly inside a candidate boundary range. */
/** `nearestRhythmTimeInRange`の候補と条件から、利用すべき値または操作を決定する。 */
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

/** `adjacentRhythmTime`でtimeline入力をCut刻みまたはrhythm grid上の時刻へ変換する。 */
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
/** `nudgedRhythmTime`で指定された変更を不変更新として状態へ反映する。 */
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

/** `isOnRhythmGrid`の入力が要求された条件やschemaを満たすか検証する。 */
export function isOnRhythmGrid(grid: readonly RhythmGridPoint[], value: number): boolean {
  const nearest = nearestRhythmTime(grid, value);
  return nearest !== null && Math.abs(nearest - value) <= 0.0005;
}

/** 継承／独自モードと、即時編集に使う正規化済みStyle／Effectを作る。 */
export function createSegmentStyleDraft(
  segment: SegmentTimingTarget,
  inheritedStyle: SubtitleStyle | undefined,
  inheritedEffect: SubtitleEffectSettings | undefined,
  catalog: SubtitleEffectCatalog,
): SegmentStyleDraftState {
  const custom = Boolean(segment.style_override && segment.effect_override);
  return {
    mode: custom ? "custom" : "inherit",
    style: normalizeSubtitleStyle(custom ? segment.style_override : inheritedStyle),
    effect: normalizeSubtitleEffect(custom ? segment.effect_override : inheritedEffect, catalog),
  };
}

/** 時刻入力を既存BoundaryPolicyで検証し、確定可能な範囲を返す。 */
export function evaluateSegmentTiming(input: {
  startInput: string;
  extentInput: string;
  rangeMode: SegmentRangeMode;
  mode: "cut" | "sub";
  policy: BoundaryPolicy;
  mediaDuration: number;
  previousEnd?: number;
  nextStart?: number;
}) {
  const proposedStart = parseTimeInput(input.startInput);
  const extent = parseTimeInput(input.extentInput);
  const startError = proposedStart === null ? tr("segmentTiming.invalidTime") : null;
  const extentError = extent === null ? tr("segmentTiming.invalidTime") : null;
  const proposedEnd = proposedStart === null || extent === null
    ? null
    : input.rangeMode === "duration"
      ? proposedStart + extent
      : extent;
  let rangeError: string | null = null;
  let resolved: { start: number; end: number } | null = null;
  if (proposedStart !== null && proposedEnd !== null) {
    if (proposedEnd - proposedStart < input.policy.minimumDuration - TIME_RANGE_EPSILON) {
      rangeError = tr("segmentTiming.positiveDuration");
    } else if (proposedStart < 0 || proposedEnd > input.mediaDuration + EPSILON) {
      rangeError = tr("segmentTiming.outOfMedia");
    } else if (input.mode === "sub" && input.previousEnd !== undefined && proposedStart < input.previousEnd - EPSILON) {
      rangeError = tr("segmentTiming.previousOverlap");
    } else if (input.mode === "sub" && input.nextStart !== undefined && proposedEnd > input.nextStart + EPSILON) {
      rangeError = tr("segmentTiming.nextOverlap");
    } else {
      resolved = resolveBoundaryRange(
        { start: proposedStart, end: proposedEnd },
        input.policy,
        { previousEnd: input.previousEnd, nextStart: input.nextStart },
      );
      if (!resolved) {
        if (input.previousEnd !== undefined && proposedStart <= input.previousEnd + EPSILON) {
          rangeError = tr("segmentTiming.previousOverlap");
        } else if (input.nextStart !== undefined && proposedEnd >= input.nextStart - EPSILON) {
          rangeError = tr("segmentTiming.nextOverlap");
        } else {
          rangeError = tr("segmentTiming.invalidTime");
        }
      }
    }
  }
  return {
    start: resolved?.start ?? null,
    end: resolved?.end ?? null,
    proposedStart,
    proposedEnd,
    startError,
    extentError,
    rangeError,
    valid: startError === null && extentError === null && rangeError === null,
  };
}

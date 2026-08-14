import type { WaveformDisplayMode, WaveformPoint } from "@/types";

export const DEFAULT_WAVEFORM_DISPLAY_MODE: WaveformDisplayMode = "rms";
export const WAVEFORM_DISPLAY_MODES = ["rms", "peak", "peak-rms", "symmetric-peak"] as const;

const WAVEFORM_HEIGHT = 86;
const WAVEFORM_CENTER_Y = WAVEFORM_HEIGHT / 2;
const WAVEFORM_MIN_HALF_HEIGHT = 2;
const WAVEFORM_MAX_HALF_HEIGHT = WAVEFORM_CENTER_Y - 3;
const CUT_LEGACY_GAIN = 1100;
const WAVEFORM_TARGET_HALF_HEIGHT = WAVEFORM_CENTER_Y * 0.7;
const WAVEFORM_REFERENCE_PERCENTILE = 0.95;
const WAVEFORM_MIN_GAIN = 40;
const WAVEFORM_MAX_GAIN = 400;

export type WaveformPyramid = WaveformPoint[][];
export type WaveformPathKind = "rms" | "peak" | "symmetric-peak";
export type WaveformAmplitudeProfile = "cut-legacy" | "adaptive";
export type CutWaveformAmplitudeProfile = "adaptive" | "singing-mc-contrast";
export type WaveformPathSpec = {
  kind: WaveformPathKind;
  d: string;
  opacity: number;
};
export type WaveformAmplitudeScale = {
  profile: WaveformAmplitudeProfile;
  peakGain: number;
  rmsGain: number;
};

/** 全曲waveformを指定範囲へ切り出し、範囲先頭を0秒とする局所waveformへ変換する。 */
export function cropWaveformToRange(
  waveform: readonly WaveformPoint[],
  rangeStart: number,
  rangeEnd: number,
): WaveformPoint[] {
  if (
    waveform.length === 0
    || !Number.isFinite(rangeStart)
    || !Number.isFinite(rangeEnd)
    || rangeEnd <= rangeStart
  ) {
    return [];
  }
  const points = waveform
    .filter(isFiniteWaveformPoint)
    .map((point) => ({ ...point }))
    .sort((left, right) => left.t - right.t);
  if (points.length === 0 || rangeEnd < points[0].t || rangeStart > points[points.length - 1].t) {
    return [];
  }

  const result: WaveformPoint[] = [];
  const startPoint = waveformPointAtTime(points, rangeStart);
  if (startPoint) result.push({ ...startPoint, t: 0 });
  for (const point of points) {
    if (point.t <= rangeStart || point.t >= rangeEnd) continue;
    result.push({ ...point, t: point.t - rangeStart });
  }
  const endPoint = waveformPointAtTime(points, rangeEnd);
  if (endPoint) {
    const localEnd = rangeEnd - rangeStart;
    const previous = result[result.length - 1];
    if (!previous || Math.abs(previous.t - localEnd) > 1e-9) {
      result.push({ ...endPoint, t: localEnd });
    }
  }
  return result;
}

/** progressive waveform chunkを一度結合してから範囲切り出しし、局所chunkとして返す。 */
export function cropWaveformChunksToRange(
  chunks: readonly (readonly WaveformPoint[])[],
  rangeStart: number,
  rangeEnd: number,
): WaveformPoint[][] {
  const cropped = cropWaveformToRange(chunks.flat(), rangeStart, rangeEnd);
  return cropped.length > 0 ? [cropped] : [];
}

function isFiniteWaveformPoint(point: WaveformPoint) {
  return Number.isFinite(point.t)
    && Number.isFinite(point.min)
    && Number.isFinite(point.max)
    && Number.isFinite(point.rms)
    && Number.isFinite(point.sample_count);
}

function waveformPointAtTime(points: readonly WaveformPoint[], time: number): WaveformPoint | null {
  if (points.length === 0) return null;
  if (time <= points[0].t) return { ...points[0], t: time };
  const last = points[points.length - 1];
  if (time >= last.t) return { ...last, t: time };
  let rightIndex = 1;
  while (rightIndex < points.length && points[rightIndex].t < time) rightIndex += 1;
  const right = points[rightIndex];
  const left = points[rightIndex - 1];
  if (Math.abs(right.t - time) <= 1e-9) return { ...right, t: time };
  const ratio = (time - left.t) / (right.t - left.t);
  return {
    t: time,
    min: left.min + (right.min - left.min) * ratio,
    max: left.max + (right.max - left.max) * ratio,
    rms: left.rms + (right.rms - left.rms) * ratio,
    sample_count: Math.max(0, Math.round(left.sample_count + (right.sample_count - left.sample_count) * ratio)),
  };
}

/** `normalizeWaveformDisplayMode`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
export function normalizeWaveformDisplayMode(
  value: unknown,
  fallback: WaveformDisplayMode = DEFAULT_WAVEFORM_DISPLAY_MODE
): WaveformDisplayMode {
  return typeof value === "string" && WAVEFORM_DISPLAY_MODES.includes(value as WaveformDisplayMode)
    ? (value as WaveformDisplayMode)
    : fallback;
}

/** `buildWaveformPyramid`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function buildWaveformPyramid(waveform: readonly WaveformPoint[]): WaveformPyramid {
  if (waveform.length === 0) return [];

  const levels: WaveformPyramid = [[...waveform]];
  while (levels[levels.length - 1].length > 1) {
    const previous = levels[levels.length - 1];
    const next: WaveformPoint[] = [];
    for (let index = 0; index < previous.length; index += 2) {
      const left = previous[index];
      const right = previous[index + 1];
      next.push(right ? mergeWaveformPoints(left, right) : left);
    }
    levels.push(next);
  }
  return levels;
}

/** `mergeWaveformPoints`で複数のwaveform点列を重複なく時系列へ統合する。 */
export function mergeWaveformPoints(left: WaveformPoint, right: WaveformPoint): WaveformPoint {
  const sampleCount = left.sample_count + right.sample_count;
  const rmsEnergy = left.rms * left.rms * left.sample_count + right.rms * right.rms * right.sample_count;
  return {
    t: sampleCount > 0 ? (left.t * left.sample_count + right.t * right.sample_count) / sampleCount : (left.t + right.t) / 2,
    min: Math.min(left.min, right.min),
    max: Math.max(left.max, right.max),
    rms: sampleCount > 0 ? Math.sqrt(rmsEnergy / sampleCount) : 0,
    sample_count: sampleCount
  };
}

/** `selectWaveformLevel`の候補と条件から、利用すべき値または操作を決定する。 */
export function selectWaveformLevel(
  pyramid: readonly (readonly WaveformPoint[])[],
  duration: number,
  timelineWidth: number
): number {
  if (pyramid.length === 0 || pyramid[0].length === 0 || duration <= 0 || timelineWidth <= 0) return 0;

  const secondsPerPixel = duration / timelineWidth;
  const levelZeroSeconds = duration / pyramid[0].length;
  for (let level = 0; level < pyramid.length; level += 1) {
    if (levelZeroSeconds * 2 ** level >= secondsPerPixel) return level;
  }
  return pyramid.length - 1;
}

/** `buildWaveformPath`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function buildWaveformPath(
  points: readonly WaveformPoint[],
  duration: number,
  width: number,
  kind: WaveformPathKind,
  scale: WaveformAmplitudeScale = calculateWaveformAmplitudeScale(points)
): string {
  if (points.length === 0 || duration <= 0 || width <= 0) return "";

  const commands = new Array<string>(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const x = (point.t / duration) * width;
    const peak = Math.max(Math.abs(point.min), Math.abs(point.max));
    let yTop: number;
    let yBottom: number;
    if (kind === "rms") {
      const halfHeight = clampHalfHeight(Math.abs(point.rms) * scale.rmsGain);
      yTop = WAVEFORM_CENTER_Y - halfHeight;
      yBottom = WAVEFORM_CENTER_Y + halfHeight;
    } else if (kind === "symmetric-peak") {
      const halfHeight = clampHalfHeight(peak * scale.peakGain);
      yTop = WAVEFORM_CENTER_Y - halfHeight;
      yBottom = WAVEFORM_CENTER_Y + halfHeight;
    } else {
      yTop = WAVEFORM_CENTER_Y - clampSignedAmplitude(point.max * scale.peakGain);
      yBottom = WAVEFORM_CENTER_Y - clampSignedAmplitude(point.min * scale.peakGain);
      if (yBottom - yTop < WAVEFORM_MIN_HALF_HEIGHT * 2) {
        const middle = (yTop + yBottom) / 2;
        yTop = middle - WAVEFORM_MIN_HALF_HEIGHT;
        yBottom = middle + WAVEFORM_MIN_HALF_HEIGHT;
      }
      yTop = Math.max(WAVEFORM_CENTER_Y - WAVEFORM_MAX_HALF_HEIGHT, yTop);
      yBottom = Math.min(WAVEFORM_CENTER_Y + WAVEFORM_MAX_HALF_HEIGHT, yBottom);
    }
    commands[index] = `M${formatPathNumber(x)} ${formatPathNumber(yTop)}V${formatPathNumber(yBottom)}`;
  }
  return commands.join("");
}

/** `buildWaveformPathSpecs`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function buildWaveformPathSpecs(
  points: readonly WaveformPoint[],
  duration: number,
  width: number,
  mode: WaveformDisplayMode,
  scale: WaveformAmplitudeScale = calculateWaveformAmplitudeScale(points)
): WaveformPathSpec[] {
  if (mode === "rms") {
    return [{ kind: "rms", d: buildWaveformPath(points, duration, width, "rms", scale), opacity: 1 }];
  }
  if (mode === "peak") {
    return [{ kind: "peak", d: buildWaveformPath(points, duration, width, "peak", scale), opacity: 1 }];
  }
  if (mode === "symmetric-peak") {
    return [
      {
        kind: "symmetric-peak",
        d: buildWaveformPath(points, duration, width, "symmetric-peak", scale),
        opacity: 1,
      },
    ];
  }
  return [
    { kind: "peak", d: buildWaveformPath(points, duration, width, "peak", scale), opacity: 0.45 },
    { kind: "rms", d: buildWaveformPath(points, duration, width, "rms", scale), opacity: 1 }
  ];
}

/** `calculateWaveformAmplitudeScale`で表示profileとsample分布からwaveformの振幅scaleを算出する。 */
export function calculateWaveformAmplitudeScale(
  points: readonly WaveformPoint[],
  profile: WaveformAmplitudeProfile = "adaptive"
): WaveformAmplitudeScale {
  if (profile !== "adaptive") {
    return { profile, peakGain: CUT_LEGACY_GAIN, rmsGain: CUT_LEGACY_GAIN };
  }
  if (points.length === 0) {
    return { profile, peakGain: WAVEFORM_MIN_GAIN, rmsGain: WAVEFORM_MIN_GAIN };
  }
  const peaks = new Array<number>(points.length);
  const rmsValues = new Array<number>(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    peaks[index] = Math.max(Math.abs(point.min), Math.abs(point.max));
    rmsValues[index] = Math.abs(point.rms);
  }
  return {
    profile,
    peakGain: gainForReference(percentileInPlace(peaks, WAVEFORM_REFERENCE_PERCENTILE)),
    rmsGain: gainForReference(percentileInPlace(rmsValues, WAVEFORM_REFERENCE_PERCENTILE)),
  };
}

function gainForReference(reference: number) {
  if (!Number.isFinite(reference) || reference <= 0) return WAVEFORM_MAX_GAIN;
  return Math.max(
    WAVEFORM_MIN_GAIN,
    Math.min(WAVEFORM_MAX_GAIN, WAVEFORM_TARGET_HALF_HEIGHT / reference)
  );
}

function percentileInPlace(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const target = Math.max(0, Math.min(values.length - 1, Math.floor((values.length - 1) * ratio)));
  let left = 0;
  let right = values.length - 1;
  while (left <= right) {
    const pivot = values[left + Math.floor((right - left) / 2)];
    let lower = left;
    let cursor = left;
    let upper = right;
    while (cursor <= upper) {
      if (values[cursor] < pivot) {
        [values[lower], values[cursor]] = [values[cursor], values[lower]];
        lower += 1;
        cursor += 1;
      } else if (values[cursor] > pivot) {
        [values[cursor], values[upper]] = [values[upper], values[cursor]];
        upper -= 1;
      } else {
        cursor += 1;
      }
    }
    if (target < lower) {
      right = lower - 1;
    } else if (target > upper) {
      left = upper + 1;
    } else {
      return values[target];
    }
  }
  return values[target];
}

function clampHalfHeight(value: number) {
  return Math.min(WAVEFORM_MAX_HALF_HEIGHT, Math.max(WAVEFORM_MIN_HALF_HEIGHT, value));
}

function clampSignedAmplitude(value: number) {
  return Math.max(-WAVEFORM_MAX_HALF_HEIGHT, Math.min(WAVEFORM_MAX_HALF_HEIGHT, value));
}

function formatPathNumber(value: number) {
  return String(Math.round(value * 1000) / 1000);
}

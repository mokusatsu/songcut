import type { WaveformDisplayMode, WaveformPoint } from "@/types";

export const DEFAULT_WAVEFORM_DISPLAY_MODE: WaveformDisplayMode = "rms";
export const WAVEFORM_DISPLAY_MODES = ["rms", "peak", "peak-rms"] as const;

const WAVEFORM_CENTER_Y = 43;
const WAVEFORM_GAIN = 1100;
const WAVEFORM_MIN_HALF_HEIGHT = 2;

export type WaveformPyramid = WaveformPoint[][];
export type WaveformPathKind = "rms" | "peak";
export type WaveformPathSpec = {
  kind: WaveformPathKind;
  d: string;
  opacity: number;
};

export function normalizeWaveformDisplayMode(value: unknown): WaveformDisplayMode {
  return typeof value === "string" && WAVEFORM_DISPLAY_MODES.includes(value as WaveformDisplayMode)
    ? (value as WaveformDisplayMode)
    : DEFAULT_WAVEFORM_DISPLAY_MODE;
}

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

export function buildWaveformPath(
  points: readonly WaveformPoint[],
  duration: number,
  width: number,
  kind: WaveformPathKind
): string {
  if (points.length === 0 || duration <= 0 || width <= 0) return "";

  const commands = new Array<string>(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const x = (point.t / duration) * width;
    let yTop: number;
    let yBottom: number;
    if (kind === "rms") {
      const halfHeight = Math.max(WAVEFORM_MIN_HALF_HEIGHT, Math.abs(point.rms) * WAVEFORM_GAIN);
      yTop = WAVEFORM_CENTER_Y - halfHeight;
      yBottom = WAVEFORM_CENTER_Y + halfHeight;
    } else {
      yTop = WAVEFORM_CENTER_Y - point.max * WAVEFORM_GAIN;
      yBottom = WAVEFORM_CENTER_Y - point.min * WAVEFORM_GAIN;
      if (yBottom - yTop < WAVEFORM_MIN_HALF_HEIGHT * 2) {
        const middle = (yTop + yBottom) / 2;
        yTop = middle - WAVEFORM_MIN_HALF_HEIGHT;
        yBottom = middle + WAVEFORM_MIN_HALF_HEIGHT;
      }
    }
    commands[index] = `M${formatPathNumber(x)} ${formatPathNumber(yTop)}V${formatPathNumber(yBottom)}`;
  }
  return commands.join("");
}

export function buildWaveformPathSpecs(
  points: readonly WaveformPoint[],
  duration: number,
  width: number,
  mode: WaveformDisplayMode
): WaveformPathSpec[] {
  if (mode === "rms") {
    return [{ kind: "rms", d: buildWaveformPath(points, duration, width, "rms"), opacity: 1 }];
  }
  if (mode === "peak") {
    return [{ kind: "peak", d: buildWaveformPath(points, duration, width, "peak"), opacity: 1 }];
  }
  return [
    { kind: "peak", d: buildWaveformPath(points, duration, width, "peak"), opacity: 0.45 },
    { kind: "rms", d: buildWaveformPath(points, duration, width, "rms"), opacity: 1 }
  ];
}

function formatPathNumber(value: number) {
  return String(Math.round(value * 1000) / 1000);
}

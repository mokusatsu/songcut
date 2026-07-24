import { clamp } from "@/lib/time";
import {
  DEFAULT_SUBTITLE_EFFECT,
  normalizeSubtitleEffect,
  type SubtitleEffectSettings,
} from "@/lib/subtitleEffects";

export type AppMode = "cut" | "sub";
export type SubtitleSegmentSource = "lyrics" | "title" | "manual";

export type SubtitleStyle = {
  font_name: string;
  font_size: number;
  primary_color: string;
  outline_color: string;
  background_color: string;
  bold: boolean;
  italic: boolean;
  outline: number;
  shadow: number;
  alignment: number;
  margin_l: number;
  margin_r: number;
  margin_v: number;
};

export type LyricsSegment = {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: SubtitleSegmentSource;
  low_confidence_outlier: boolean;
  user_edited: boolean;
  render_cache?: SubtitleRenderCache;
};

export type SubtitleRenderCache = {
  signature: string;
  png_base64: string;
  width: number;
  height: number;
};

export type LyricsLane = {
  id: string;
  name: string;
  style: SubtitleStyle;
  effect: SubtitleEffectSettings;
  segments: LyricsSegment[];
};

export type RhythmGridPoint = {
  time: number;
  grid: "beat" | "half-beat" | "quarter-beat";
  attraction_radius: number;
  grid_penalty: number;
};

export type ConfidenceStatistics = {
  count: number;
  minimum: number;
  maximum: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
  lower_outlier_bound: number;
  low_outlier_indexes: number[];
};

export type LyricsAnalysisLine = {
  index: number;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: string;
  matched_characters: number;
  exact_characters: number;
  total_characters: number;
  low_confidence_outlier: boolean;
};

export type LyricsAnalysisResult = {
  title: string | null;
  duration: number;
  device_used: string;
  whisper_text: string;
  tempo_bpm: number;
  beat_times: number[];
  rhythm_grid: RhythmGridPoint[];
  beat_warning: string | null;
  confidence_statistics: ConfidenceStatistics;
  lines: LyricsAnalysisLine[];
  elapsed_seconds: number;
};

export type SubtitleProjectState = {
  lanes: LyricsLane[];
  active_lane_id: string;
  selected_segment_id: string | null;
  tempo_bpm: number;
  beat_times: number[];
  rhythm_grid: RhythmGridPoint[];
  beat_warning: string | null;
  confidence_statistics: ConfidenceStatistics | null;
};

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  font_name: "Yu Gothic UI",
  font_size: 90,
  primary_color: "#FFFFFF",
  outline_color: "#000000",
  background_color: "#00000080",
  bold: false,
  italic: false,
  outline: 2,
  shadow: 0,
  alignment: 2,
  margin_l: 60,
  margin_r: 60,
  margin_v: 54,
};

export const SUBTITLE_STYLE_LIMITS = {
  font_size: { min: 1, max: 400 },
  outline: { min: 0, max: 30 },
  shadow: { min: 0, max: 30 },
  margin: { min: 0, max: 4000 },
} as const;

export function normalizeSubtitleStyle(value: unknown): SubtitleStyle {
  const candidate = value && typeof value === "object"
    ? value as Partial<SubtitleStyle>
    : {};
  return {
    ...DEFAULT_SUBTITLE_STYLE,
    ...candidate,
    font_name: typeof candidate.font_name === "string" && candidate.font_name.trim()
      ? candidate.font_name
      : DEFAULT_SUBTITLE_STYLE.font_name,
    primary_color: typeof candidate.primary_color === "string"
      ? candidate.primary_color
      : DEFAULT_SUBTITLE_STYLE.primary_color,
    outline_color: typeof candidate.outline_color === "string"
      ? candidate.outline_color
      : DEFAULT_SUBTITLE_STYLE.outline_color,
    background_color: typeof candidate.background_color === "string"
      ? candidate.background_color
      : DEFAULT_SUBTITLE_STYLE.background_color,
    bold: typeof candidate.bold === "boolean" ? candidate.bold : DEFAULT_SUBTITLE_STYLE.bold,
    italic: typeof candidate.italic === "boolean" ? candidate.italic : DEFAULT_SUBTITLE_STYLE.italic,
    font_size: normalizedStyleNumber(
      candidate.font_size,
      DEFAULT_SUBTITLE_STYLE.font_size,
      SUBTITLE_STYLE_LIMITS.font_size.min,
      SUBTITLE_STYLE_LIMITS.font_size.max,
    ),
    outline: normalizedStyleNumber(
      candidate.outline,
      DEFAULT_SUBTITLE_STYLE.outline,
      SUBTITLE_STYLE_LIMITS.outline.min,
      SUBTITLE_STYLE_LIMITS.outline.max,
    ),
    shadow: normalizedStyleNumber(
      candidate.shadow,
      DEFAULT_SUBTITLE_STYLE.shadow,
      SUBTITLE_STYLE_LIMITS.shadow.min,
      SUBTITLE_STYLE_LIMITS.shadow.max,
    ),
    alignment: normalizeAlignment(Number(candidate.alignment ?? DEFAULT_SUBTITLE_STYLE.alignment)),
    margin_l: normalizedStyleInteger(
      candidate.margin_l,
      DEFAULT_SUBTITLE_STYLE.margin_l,
      SUBTITLE_STYLE_LIMITS.margin.min,
      SUBTITLE_STYLE_LIMITS.margin.max,
    ),
    margin_r: normalizedStyleInteger(
      candidate.margin_r,
      DEFAULT_SUBTITLE_STYLE.margin_r,
      SUBTITLE_STYLE_LIMITS.margin.min,
      SUBTITLE_STYLE_LIMITS.margin.max,
    ),
    margin_v: normalizedStyleInteger(
      candidate.margin_v,
      DEFAULT_SUBTITLE_STYLE.margin_v,
      SUBTITLE_STYLE_LIMITS.margin.min,
      SUBTITLE_STYLE_LIMITS.margin.max,
    ),
  };
}

export function createLyricsLane(alignment = 2, name?: string): LyricsLane {
  return {
    id: crypto.randomUUID(),
    name: name || "Lyrics",
    style: normalizeSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, alignment }),
    effect: { ...DEFAULT_SUBTITLE_EFFECT, params: {} },
    segments: [],
  };
}

export function createDefaultSubtitleState(): SubtitleProjectState {
  const lane = createLyricsLane(2, "Lyrics 1");
  return {
    lanes: [lane],
    active_lane_id: lane.id,
    selected_segment_id: null,
    tempo_bpm: 0,
    beat_times: [],
    rhythm_grid: [],
    beat_warning: null,
    confidence_statistics: null,
  };
}

export function analysisLinesToSegments(result: LyricsAnalysisResult): LyricsSegment[] {
  return result.lines.map((line) => ({
    id: `lyrics-${crypto.randomUUID()}`,
    text: line.text,
    start: line.start,
    end: line.end,
    confidence: line.confidence,
    source: "lyrics",
    low_confidence_outlier: line.low_confidence_outlier,
    user_edited: false,
  }));
}

export function addFourBeatSegment(
  lane: LyricsLane,
  selectedSegmentId: string | null,
  grid: readonly RhythmGridPoint[],
): LyricsSegment | null {
  const times = normalizedGridTimes(grid);
  if (times.length < 2) return null;
  const ordered = chronologicalSegments(lane.segments);
  const selectedIndex = selectedSegmentId
    ? ordered.findIndex((segment) => segment.id === selectedSegmentId)
    : -1;
  const left = selectedIndex >= 0 ? ordered[selectedIndex].end : ordered.at(-1)?.end ?? times[0];
  const right = selectedIndex >= 0 ? ordered[selectedIndex + 1]?.start ?? times.at(-1)! : times.at(-1)!;
  const startIndex = times.findIndex((time) => time >= left - 1e-6);
  if (startIndex < 0 || times[startIndex] >= right - 1e-6) return null;
  const maximumEndIndex = findLastIndex(times, (time) => time <= right + 1e-6);
  const endIndex = Math.min(startIndex + 16, maximumEndIndex);
  if (endIndex <= startIndex) return null;
  const start = times[startIndex];
  const end = times[endIndex];
  if (ordered.some((segment) => rangesOverlap(start, end, segment.start, segment.end))) return null;
  return {
    id: `manual-${crypto.randomUUID()}`,
    text: "New subtitle",
    start,
    end,
    confidence: 1,
    source: "manual",
    low_confidence_outlier: false,
    user_edited: true,
  };
}

export function updateSegmentBoundary(
  lane: LyricsLane,
  segmentId: string,
  edge: "start" | "end",
  proposedTime: number,
  grid: readonly RhythmGridPoint[],
): LyricsLane {
  const times = normalizedGridTimes(grid);
  const ordered = chronologicalSegments(lane.segments);
  const index = ordered.findIndex((segment) => segment.id === segmentId);
  if (index < 0 || times.length < 2) return lane;
  const segment = ordered[index];
  const previousEnd = ordered[index - 1]?.end ?? -Infinity;
  const nextStart = ordered[index + 1]?.start ?? Infinity;
  const valid = times.filter((time) =>
    edge === "start"
      ? time > previousEnd + 1e-6 && time < segment.end - 1e-6
      : time > segment.start + 1e-6 && time < nextStart - 1e-6
  );
  if (!valid.length) return lane;
  const snapped = nearestTime(valid, proposedTime);
  return {
    ...lane,
    segments: lane.segments.map((item) =>
      item.id === segmentId ? { ...item, [edge]: snapped, user_edited: true } : item
    ),
  };
}

export function nudgeSegmentBoundary(
  lane: LyricsLane,
  segmentId: string,
  edge: "start" | "end",
  direction: -1 | 1,
  grid: readonly RhythmGridPoint[],
): LyricsLane {
  const segment = lane.segments.find((item) => item.id === segmentId);
  if (!segment) return lane;
  const times = normalizedGridTimes(grid);
  const current = edge === "start" ? segment.start : segment.end;
  const index = nearestTimeIndex(times, current);
  if (index < 0) return lane;
  const target = times[clamp(index + direction, 0, times.length - 1)];
  return updateSegmentBoundary(lane, segmentId, edge, target, grid);
}

export function labelStackLevels(segments: readonly LyricsSegment[], maximumLevels = 6) {
  const ordered = chronologicalSegments(segments);
  const levelCount = Math.max(1, maximumLevels);
  const positiveGaps = ordered
    .slice(1)
    .map((segment, index) => segment.start - ordered[index].end)
    .filter((gap) => gap > 1e-6)
    .sort((left, right) => left - right);
  const medianGap = median(positiveGaps);
  const resetThreshold = positiveGaps.length ? medianGap * 2 : Infinity;
  const rawLevels: number[] = [];
  let level = 0;
  ordered.forEach((segment, index) => {
    if (index > 0) {
      const gap = segment.start - ordered[index - 1].end;
      level = gap > resetThreshold ? 0 : (level + 1) % levelCount;
    }
    rawLevels.push(level);
  });
  const correctedLevels = [...rawLevels];
  for (let index = 1; index < rawLevels.length; index += 1) {
    if (rawLevels[index - 1] !== 0 || rawLevels[index] !== 0) continue;
    const precedingLevel = index >= 2 ? correctedLevels[index - 2] : 0;
    correctedLevels[index - 1] = Math.min(levelCount - 1, precedingLevel + 1);
  }
  const levels = new Map<string, number>();
  ordered.forEach((segment, index) => levels.set(segment.id, correctedLevels[index]));
  return levels;
}

export function activeSegmentsAt(lanes: readonly LyricsLane[], time: number) {
  return lanes.flatMap((lane) =>
    lane.segments
      .filter((segment) => time >= segment.start && time < segment.end)
      .map((segment) => ({ lane, segment }))
  );
}

export function subtitleRenderSignature(
  text: string,
  style: SubtitleStyle,
  width: number,
  height: number
) {
  return JSON.stringify({
    renderer: "ffmpeg-ass-static-v1",
    text,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    style: {
      font_name: style.font_name,
      font_size: style.font_size,
      primary_color: style.primary_color,
      outline_color: style.outline_color,
      background_color: style.background_color,
      bold: style.bold,
      italic: style.italic,
      outline: style.outline,
      shadow: style.shadow,
      alignment: style.alignment,
      margin_l: style.margin_l,
      margin_r: style.margin_r,
      margin_v: style.margin_v,
    },
  });
}

export function normalizeAlignment(value: number) {
  return Number.isFinite(value)
    ? clamp(Math.round(value), 1, 9)
    : DEFAULT_SUBTITLE_STYLE.alignment;
}

export function validateSubtitleState(value: unknown): SubtitleProjectState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SubtitleProjectState>;
  if (!Array.isArray(candidate.lanes) || candidate.lanes.length < 1 || candidate.lanes.length > 3) return null;
  if (!candidate.lanes.every(isLyricsLane)) return null;
  const activeLaneId = candidate.lanes.some((lane) => lane.id === candidate.active_lane_id)
    ? candidate.active_lane_id!
    : candidate.lanes[0].id;
  return {
    lanes: candidate.lanes.map((lane) => ({
      ...lane,
      style: normalizeSubtitleStyle(lane.style),
      effect: normalizeSubtitleEffect(lane.effect),
      segments: chronologicalSegments(lane.segments),
    })),
    active_lane_id: activeLaneId,
    selected_segment_id:
      typeof candidate.selected_segment_id === "string" ? candidate.selected_segment_id : null,
    tempo_bpm: Number.isFinite(candidate.tempo_bpm) ? Number(candidate.tempo_bpm) : 0,
    beat_times: finiteNumbers(candidate.beat_times),
    rhythm_grid: Array.isArray(candidate.rhythm_grid)
      ? candidate.rhythm_grid.filter(isRhythmGridPoint)
      : [],
    beat_warning: typeof candidate.beat_warning === "string" ? candidate.beat_warning : null,
    confidence_statistics:
      candidate.confidence_statistics && typeof candidate.confidence_statistics === "object"
        ? candidate.confidence_statistics
        : null,
  };
}

function isLyricsLane(value: unknown): value is LyricsLane {
  if (!value || typeof value !== "object") return false;
  const lane = value as Partial<LyricsLane>;
  return (
    typeof lane.id === "string" &&
    typeof lane.name === "string" &&
    Boolean(lane.style) &&
    Array.isArray(lane.segments) &&
    lane.segments.every(isLyricsSegment)
  );
}

function isLyricsSegment(value: unknown): value is LyricsSegment {
  if (!value || typeof value !== "object") return false;
  const segment = value as Partial<LyricsSegment>;
  return (
    typeof segment.id === "string" &&
    typeof segment.text === "string" &&
    Number.isFinite(segment.start) &&
    Number.isFinite(segment.end) &&
    Number(segment.end) > Number(segment.start)
  );
}

function isRhythmGridPoint(value: unknown): value is RhythmGridPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<RhythmGridPoint>;
  return (
    Number.isFinite(point.time) &&
    (point.grid === "beat" || point.grid === "half-beat" || point.grid === "quarter-beat")
  );
}

function chronologicalSegments<T extends { start: number; end: number }>(segments: readonly T[]) {
  return [...segments].sort((left, right) => left.start - right.start || left.end - right.end);
}

function normalizedGridTimes(grid: readonly RhythmGridPoint[]) {
  return [...new Set(grid.map((point) => point.time).filter(Number.isFinite))]
    .sort((left, right) => left - right);
}

function normalizedStyleNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, minimum, maximum) : fallback;
}

function normalizedStyleInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Math.round(normalizedStyleNumber(value, fallback, minimum, maximum));
}

function nearestTime(times: readonly number[], target: number) {
  return times.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best
  );
}

function nearestTimeIndex(times: readonly number[], target: number) {
  if (!times.length) return -1;
  let best = 0;
  for (let index = 1; index < times.length; index += 1) {
    if (Math.abs(times[index] - target) < Math.abs(times[best] - target)) best = index;
  }
  return best;
}

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return index;
  }
  return -1;
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd - 1e-6 && rightStart < leftEnd - 1e-6;
}

function median(values: readonly number[]) {
  if (!values.length) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

function finiteNumbers(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => Number.isFinite(item)) : [];
}

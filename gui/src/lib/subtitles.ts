import { clamp } from "@/lib/time";
import {
  nudgeBoundaryTime,
  resolveBoundaryTime,
  type BoundaryPolicy,
  type BoundaryPolicyContext,
} from "@/lib/boundaries";
import {
  nearestRhythmTime,
  nearestRhythmTimeInRange,
  nudgedRhythmTime,
} from "@/lib/segmentTiming";
import { rangesOverlap } from "@/lib/timeRange";
import {
  DEFAULT_SUBTITLE_EFFECT,
  normalizeSubtitleEffect,
  type SubtitleEffectCatalog,
  type SubtitleEffectSettings,
} from "@/lib/subtitleEffects";

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
  style_override?: SubtitleStyle;
  effect_override?: SubtitleEffectSettings;
  render_cache?: SubtitleRenderCache;
  /** Standard Align が生成またはユーザーが編集した表示素列。 */
  display_elements?: DisplayElement[];
  /** 行本文を確定した回数。欠落は未解析の旧 schema を表す。 */
  line_revision?: number;
  /** 表示素の解析／編集 revision。欠落は未解析の旧 schema を表す。 */
  display_element_revision?: number;
  /** 表示素を保護するため、利用者の歌詞行境界編集を制限するか。 */
  display_element_boundary_locked?: boolean;
  /** 行の開始境界を解析結果から固定しているか。 */
  start_locked?: boolean;
  /** 行の終了境界を解析結果から固定しているか。 */
  end_locked?: boolean;
  /** 表示素解析の品質診断。backend の拡張診断を保持する。 */
  alignment_diagnostics?: AlignmentDiagnostics;
  /** 現在の表示素列を生成した時点の歌詞本文。本文LCS照合に使う。 */
  display_element_text?: string;
  /** この行だけ局所再解析が必要か。 */
  needs_reanalysis?: boolean;
};

/** MMS token と原文範囲を保持する、保存可能な表示素の型。 */
export type DisplayElement = {
  index?: number;
  stable_id: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: DisplayElementSource;
  source_start: number;
  source_end: number;
  pronunciation: string;
  token_start: number;
  token_end: number;
  origin_key: string;
  manual_start: boolean;
  manual_end: boolean;
  manual_structure: boolean;
  parent_revision: number;
  conflict: DisplayElementConflict | null;
  orphaned_manual: boolean;
  /** backend が将来追加する診断・対応情報を失わずに保持する。 */
  [key: string]: unknown;
};

/** 表示素の生成元。未知の値を保存時に通さず、既知の source を明示する。 */
export type DisplayElementSource =
  | "blank"
  | "mms-ctc"
  | "mms-ctc-interpolated"
  | "line-proportional"
  | "manual";

/** 表示素と手動編集の競合状態。 */
export type DisplayElementConflict =
  | "boundary_conflict"
  | "text_conflict"
  | "orphaned_manual"
  | "stale"
  | "manual_conflict";

/** backend が返す診断値を JSON の有限 scalar に限定して保持する。 */
export type AlignmentDiagnosticValue = string | number | boolean | null;
export type AlignmentDiagnostics =
  | string[]
  | Record<string, AlignmentDiagnosticValue>;

/** 再解析で共有する vocals artifact の識別情報（path／binary は保存しない）。 */
export type LyricsAnalysisArtifact = {
  cache_key: string;
  cache_format?: string;
  cache_version?: string | number;
  source_fingerprint: {
    algorithm: string;
    value: string;
  };
  demucs_model?: string;
  preprocess_version?: string;
  sample_rate?: number;
  channels?: number;
  expires_at?: string | number;
  [key: string]: unknown;
};

export type SubtitleRenderCache = {
  signature: string;
  png_base64: string;
  width: number;
  height: number;
};

export type SubtitleRenderRequestItem = {
  segment_id: string;
  signature: string;
  text: string;
  style: SubtitleStyle;
};

export type SubtitleRenderRequest = {
  width: number;
  height: number;
  items: SubtitleRenderRequestItem[];
};

export type LyricsLane = {
  id: string;
  name: string;
  style: SubtitleStyle;
  effect: SubtitleEffectSettings;
  segments: LyricsSegment[];
};

export type ResolvedSubtitleSegmentStyle = {
  style: SubtitleStyle;
  effect: SubtitleEffectSettings;
  mode: "inherit" | "custom";
};

export type RhythmGridPoint = {
  time: number;
  grid: "beat" | "half-beat" | "quarter-beat";
  attraction_radius: number;
  grid_penalty: number;
};

export type SubtitleSegmentAddPosition = "start" | "before" | "after" | "playback";

export type SubtitleSegmentAddRequest = {
  targetLaneId: string;
  position: SubtitleSegmentAddPosition;
  anchorSegmentId: string | null;
  playbackTime: number;
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
  display_elements?: DisplayElement[];
  line_revision?: number;
  display_element_revision?: number;
  start_locked?: boolean;
  end_locked?: boolean;
  alignment_diagnostics?: AlignmentDiagnostics;
  display_element_text?: string;
  needs_reanalysis?: boolean;
  [key: string]: unknown;
};

export type LyricsAnalysisResult = {
  title: string | null;
  duration: number;
  device_used: string;
  algorithm: "songcut-standard" | "uta-align";
  whisper_text: string;
  tempo_bpm: number;
  beat_times: number[];
  rhythm_grid: RhythmGridPoint[];
  beat_warning: string | null;
  confidence_statistics: ConfidenceStatistics;
  lines: LyricsAnalysisLine[];
  elapsed_seconds: number;
  uta_align_diagnostics?: Record<string, unknown>;
  mms_diagnostics?: Record<string, unknown>;
  analysis_artifact?: LyricsAnalysisArtifact;
  [key: string]: unknown;
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
  analysis_artifact?: LyricsAnalysisArtifact;
  /** 行局所再解析をStandard Alignのprojectだけに限定する識別子。 */
  analysis_algorithm?: "songcut-standard" | "uta-align";
};

/** `selectedSubtitleSegment`の候補と条件から、利用すべき値または操作を決定する。 */
export function selectedSubtitleSegment(state: SubtitleProjectState) {
  for (const lane of state.lanes) {
    const segment = lane.segments.find((item) => item.id === state.selected_segment_id);
    if (segment) return { laneId: lane.id, segment };
  }
  return null;
}

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

/** `normalizeSubtitleStyle`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
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

/** セグメントの個別設定またはレーン既定値から、描画・出力に使う実効Style／Effectを返す。 */
export function resolveSubtitleSegmentStyle(
  lane: Pick<LyricsLane, "style" | "effect">,
  segment: Pick<LyricsSegment, "style_override" | "effect_override">,
  catalog: SubtitleEffectCatalog,
): ResolvedSubtitleSegmentStyle {
  if (Boolean(segment.style_override) !== Boolean(segment.effect_override)) {
    throw new Error("Subtitle segment style/effect overrides must be supplied together.");
  }
  if (segment.style_override && segment.effect_override) {
    return {
      style: normalizeSubtitleStyle(segment.style_override),
      effect: normalizeSubtitleEffect(segment.effect_override, catalog),
      mode: "custom",
    };
  }
  return {
    style: normalizeSubtitleStyle(lane.style),
    effect: normalizeSubtitleEffect(lane.effect, catalog),
    mode: "inherit",
  };
}

/** セグメントを継承または独自モードへ切り替え、個別Style／Effectを対で設定する。 */
export function withSubtitleSegmentStyle(
  segment: LyricsSegment,
  style: SubtitleStyle | undefined,
  effect: SubtitleEffectSettings | undefined,
  catalog: SubtitleEffectCatalog,
): LyricsSegment {
  if (!style || !effect) {
    const { style_override: _style, effect_override: _effect, ...inherited } = segment;
    return inherited;
  }
  return {
    ...segment,
    style_override: normalizeSubtitleStyle(style),
    effect_override: normalizeSubtitleEffect(effect, catalog),
  };
}

/** `createLyricsLane`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function createLyricsLane(alignment = 2, name?: string): LyricsLane {
  return {
    id: crypto.randomUUID(),
    name: name || "Lyrics",
    style: normalizeSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, alignment }),
    effect: { ...DEFAULT_SUBTITLE_EFFECT, params: {} },
    segments: [],
  };
}

/** `createDefaultSubtitleState`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
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

/** 歌詞解析の各lineを、編集可能な字幕segmentとrender前の初期状態へ変換する。 */
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
    ...(line.display_elements?.length
      ? { display_elements: line.display_elements.map((element) => ({ ...element })) }
      : {}),
    ...(line.line_revision !== undefined ? { line_revision: line.line_revision } : {}),
    ...(line.display_element_revision !== undefined
      ? { display_element_revision: line.display_element_revision }
      : {}),
    ...(line.start_locked !== undefined ? { start_locked: line.start_locked } : {}),
    ...(line.end_locked !== undefined ? { end_locked: line.end_locked } : {}),
    ...(line.alignment_diagnostics !== undefined
      ? { alignment_diagnostics: cloneAlignmentDiagnostics(line.alignment_diagnostics) }
      : {}),
    ...(line.display_element_text !== undefined
      ? { display_element_text: line.display_element_text }
      : line.display_elements?.length ? { display_element_text: line.text } : {}),
    ...(line.needs_reanalysis !== undefined ? { needs_reanalysis: line.needs_reanalysis } : {}),
  }));
}

/** グリッド上の空き区間から、既存の4拍追加規則に沿った新規segmentを作る。 */
function addSegmentInGap(
  lane: LyricsLane,
  grid: readonly RhythmGridPoint[],
  leftBoundary: number,
  rightBoundary: number,
  preferEnd: boolean,
): LyricsSegment | null {
  const times = normalizedGridTimes(grid);
  if (times.length < 2 || !Number.isFinite(leftBoundary) || !Number.isFinite(rightBoundary)) return null;
  const startIndex = times.findIndex((time) => time >= leftBoundary - 1e-6);
  const maximumEndIndex = findLastIndex(times, (time) => time <= rightBoundary + 1e-6);
  if (startIndex < 0 || maximumEndIndex <= startIndex) return null;

  const endIndex = maximumEndIndex;
  const candidateStartIndex = preferEnd
    ? Math.max(startIndex, endIndex - 16)
    : startIndex;
  const candidateEndIndex = Math.min(candidateStartIndex + 16, endIndex);
  if (candidateEndIndex <= candidateStartIndex) return null;

  const start = times[candidateStartIndex];
  const end = times[candidateEndIndex];
  if (lane.segments.some((segment) => rangesOverlap({ start, end }, segment))) return null;
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

/** `addSubtitleSegmentAtPosition`の指定位置へ、追加先laneの境界を割り当てる。 */
export function addSubtitleSegmentAtPosition(
  lane: LyricsLane,
  position: SubtitleSegmentAddPosition,
  grid: readonly RhythmGridPoint[],
  options: {
    anchor?: Pick<LyricsSegment, "id" | "start" | "end"> | null;
    playbackTime?: number;
  } = {},
): LyricsSegment | null {
  const times = normalizedGridTimes(grid);
  if (times.length < 2) return null;
  const ordered = chronologicalSegments(lane.segments);
  const lastTime = times.at(-1)!;

  if (position === "start") {
    const right = ordered[0]?.start ?? lastTime;
    return addSegmentInGap(lane, grid, times[0], right, false);
  }

  if (position === "before") {
    const anchor = options.anchor;
    if (!anchor) return null;
    const rightIndex = findLastIndex(times, (time) => time <= anchor.start + 1e-6);
    if (rightIndex < 1) return null;
    const right = times[rightIndex];
    const left = [...ordered]
      .reverse()
      .find((segment) => segment.end <= right + 1e-6)?.end ?? times[0];
    return addSegmentInGap(lane, grid, left, right, true);
  }

  if (position === "after") {
    const anchor = options.anchor;
    if (!anchor) return null;
    const left = anchor.end;
    const right = ordered.find((segment) => segment.start >= left - 1e-6)?.start ?? lastTime;
    return addSegmentInGap(lane, grid, left, right, false);
  }

  const playbackTime = options.playbackTime;
  const start = playbackTime === undefined ? null : nearestRhythmTime(grid, playbackTime);
  if (start === null) return null;
  const right = ordered.find((segment) => segment.start >= start - 1e-6)?.start ?? lastTime;
  return addSegmentInGap(lane, grid, start, right, false);
}

/** `addFourBeatSegment`の既存呼出し向けに、active lane末尾または選択直後へ追加する。 */
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
  return addSegmentInGap(lane, grid, left, right, false);
}

/** `updateSegmentBoundary`で指定された変更を不変更新として状態へ反映する。 */
export function updateSegmentBoundary(
  lane: LyricsLane,
  segmentId: string,
  edge: "start" | "end",
  proposedTime: number,
  grid: readonly RhythmGridPoint[],
): LyricsLane {
  const ordered = chronologicalSegments(lane.segments);
  const index = ordered.findIndex((segment) => segment.id === segmentId);
  if (index < 0 || normalizedGridTimes(grid).length < 2) return lane;
  const segment = ordered[index];
  const snapped = resolveBoundaryTime(
    segment,
    edge,
    proposedTime,
    createSubtitleBoundaryPolicy(grid),
    {
      previousEnd: ordered[index - 1]?.end,
      nextStart: ordered[index + 1]?.start,
    },
  );
  if (snapped === null) return lane;
  return {
    ...lane,
    segments: lane.segments.map((item) =>
      item.id === segmentId ? { ...item, [edge]: snapped, user_edited: true } : item
    ),
  };
}

/** `nudgeSegmentBoundary`で指定された変更を不変更新として状態へ反映する。 */
export function nudgeSegmentBoundary(
  lane: LyricsLane,
  segmentId: string,
  edge: "start" | "end",
  direction: -1 | 1,
  grid: readonly RhythmGridPoint[],
): LyricsLane {
  const ordered = chronologicalSegments(lane.segments);
  const index = ordered.findIndex((item) => item.id === segmentId);
  if (index < 0 || normalizedGridTimes(grid).length < 2) return lane;
  const segment = ordered[index];
  const target = nudgeBoundaryTime(
    segment,
    edge,
    direction,
    createSubtitleBoundaryPolicy(grid),
    {
      previousEnd: ordered[index - 1]?.end,
      nextStart: ordered[index + 1]?.start,
    },
  );
  if (target === null) return lane;
  return {
    ...lane,
    segments: lane.segments.map((item) =>
      item.id === segmentId ? { ...item, [edge]: target, user_edited: true } : item
    ),
  };
}

/** Sub boundaries snap to the rhythm grid and remain strictly inside neighbors. */
/** `createSubtitleBoundaryPolicy`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function createSubtitleBoundaryPolicy(
  grid: readonly RhythmGridPoint[],
): BoundaryPolicy {
  return {
    // The strict resolver and rhythm-range helper each apply the existing
    // single-epsilon edge predicate. Keeping this at zero avoids subtracting
    // the epsilon twice from the opposite boundary.
    minimumDuration: 0,
    strict: true,
    snap: (value: number, context: BoundaryPolicyContext) =>
      nearestRhythmTimeInRange(grid, value, context.minimum, context.maximum),
    nudge: (value: number, direction: -1 | 1) => nudgedRhythmTime(grid, value, direction),
  };
}

export const createSubBoundaryPolicy = createSubtitleBoundaryPolicy;

/** `labelStackLevels`の値を現在のlocaleと表示規則に沿った文字列へ整形する。 */
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

/** `activeSegmentsAt`で字幕・数値候補を時刻または統計条件に沿って抽出・整列する。 */
export function activeSegmentsAt(lanes: readonly LyricsLane[], time: number) {
  return lanes.flatMap((lane) =>
    lane.segments
      .filter((segment) => time >= segment.start && time < segment.end)
      .map((segment) => ({ lane, segment }))
  );
}

/** `subtitleRenderSignature`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
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

/** `normalizeAlignment`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
export function normalizeAlignment(value: number) {
  return Number.isFinite(value)
    ? clamp(Math.round(value), 1, 9)
    : DEFAULT_SUBTITLE_STYLE.alignment;
}

/** `validateSubtitleState`の入力が要求された条件やschemaを満たすか検証する。 */
export function validateSubtitleState(
  value: unknown,
  catalog?: SubtitleEffectCatalog,
): SubtitleProjectState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SubtitleProjectState>;
  if (!Array.isArray(candidate.lanes) || candidate.lanes.length < 1 || candidate.lanes.length > 3) return null;
  if (!candidate.lanes.every(isLyricsLane)) return null;
  const displayElementIds = new Set<string>();
  for (const lane of candidate.lanes) {
    for (const segment of lane.segments) {
      for (const element of segment.display_elements ?? []) {
        if (displayElementIds.has(element.stable_id)) return null;
        displayElementIds.add(element.stable_id);
      }
    }
  }
  if (candidate.analysis_artifact !== undefined && !isLyricsAnalysisArtifact(candidate.analysis_artifact)) {
    return null;
  }
  if (candidate.analysis_algorithm !== undefined
    && candidate.analysis_algorithm !== "songcut-standard"
    && candidate.analysis_algorithm !== "uta-align") return null;
  const activeLaneId = candidate.lanes.some((lane) => lane.id === candidate.active_lane_id)
    ? candidate.active_lane_id!
    : candidate.lanes[0].id;
  return {
    lanes: candidate.lanes.map((lane) => ({
      ...lane,
      style: normalizeSubtitleStyle(lane.style),
      effect: catalog
        ? normalizeSubtitleEffect(lane.effect ?? DEFAULT_SUBTITLE_EFFECT, catalog)
        : cloneSubtitleEffect(lane.effect),
      segments: chronologicalSegments(lane.segments).map((segment) => normalizeLyricsSegment(segment, catalog)),
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
    ...(candidate.analysis_artifact
      ? { analysis_artifact: cloneLyricsAnalysisArtifact(candidate.analysis_artifact) }
      : {}),
    ...(candidate.analysis_algorithm ? { analysis_algorithm: candidate.analysis_algorithm } : {}),
  };
}

/** `isLyricsLane`の入力が要求された条件やschemaを満たすか検証する。 */
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

/** `isLyricsSegment`の入力が要求された条件やschemaを満たすか検証する。 */
function isLyricsSegment(value: unknown): value is LyricsSegment {
  if (!value || typeof value !== "object") return false;
  const segment = value as Partial<LyricsSegment>;
  const hasStyleOverride = Boolean(segment.style_override);
  const hasEffectOverride = Boolean(segment.effect_override);
  return (
    typeof segment.id === "string" &&
    typeof segment.text === "string" &&
    Number.isFinite(segment.start) &&
    Number.isFinite(segment.end) &&
    Number(segment.end) > Number(segment.start) &&
    hasStyleOverride === hasEffectOverride &&
    (!hasStyleOverride || (
      typeof segment.style_override === "object" &&
      typeof segment.effect_override === "object"
    )) &&
    (segment.display_elements === undefined || isDisplayElementPartition(
      segment.display_elements,
      Number(segment.start),
      Number(segment.end),
    )) &&
    (segment.line_revision === undefined || isNonNegativeInteger(segment.line_revision)) &&
    (segment.display_element_revision === undefined || isNonNegativeInteger(segment.display_element_revision)) &&
    (segment.display_element_boundary_locked === undefined
      || typeof segment.display_element_boundary_locked === "boolean") &&
    (segment.start_locked === undefined || typeof segment.start_locked === "boolean") &&
    (segment.end_locked === undefined || typeof segment.end_locked === "boolean") &&
    (segment.alignment_diagnostics === undefined || isAlignmentDiagnostics(segment.alignment_diagnostics)) &&
    (segment.display_element_text === undefined || typeof segment.display_element_text === "string") &&
    (segment.needs_reanalysis === undefined || typeof segment.needs_reanalysis === "boolean")
  );
}

/** 表示素が行全体を正時間の連続 partition として覆うことを確認する。 */
function isDisplayElementPartition(value: unknown, lineStart: number, lineEnd: number): value is DisplayElement[] {
  if (!Array.isArray(value) || !value.length) return false;
  let cursor = lineStart;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isDisplayElement(item)) return false;
    if (ids.has(item.stable_id)) return false;
    ids.add(item.stable_id);
    if (item.start < cursor - 1e-6 || Math.abs(item.start - cursor) > 1e-6 || item.end <= item.start) {
      return false;
    }
    cursor = item.end;
  }
  return Math.abs(cursor - lineEnd) <= 1e-6;
}

/** 表示素の必須値・enum・有限値を確認する。 */
function isDisplayElement(value: unknown): value is DisplayElement {
  if (!value || typeof value !== "object") return false;
  const element = value as Partial<DisplayElement>;
  return (
    typeof element.stable_id === "string" && Boolean(element.stable_id.trim()) &&
    typeof element.text === "string" &&
    Number.isFinite(element.start) && Number.isFinite(element.end) &&
    Number.isFinite(element.confidence) &&
    displayElementSources.has(element.source as DisplayElementSource) &&
    isNonNegativeInteger(element.source_start) &&
    isNonNegativeInteger(element.source_end) &&
    Number(element.source_end) >= Number(element.source_start) &&
    typeof element.pronunciation === "string" &&
    isNonNegativeInteger(element.token_start) &&
    isNonNegativeInteger(element.token_end) &&
    Number(element.token_end) >= Number(element.token_start) &&
    typeof element.origin_key === "string" &&
    typeof element.manual_start === "boolean" &&
    typeof element.manual_end === "boolean" &&
    typeof element.manual_structure === "boolean" &&
    isNonNegativeInteger(element.parent_revision) &&
    (element.conflict === null || displayElementConflicts.has(element.conflict as DisplayElementConflict)) &&
    typeof element.orphaned_manual === "boolean"
  );
}

/** alignment diagnostics の形式が JSON scalar の範囲に収まることを確認する。 */
function isAlignmentDiagnostics(value: unknown): value is AlignmentDiagnostics {
  if (Array.isArray(value)) return value.every((item) => typeof item === "string");
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every((item) =>
    item === null || typeof item === "string" || typeof item === "boolean" ||
    (typeof item === "number" && Number.isFinite(item))
  );
}

/** vocals artifact の識別情報が path／binary を含まない有効な値か確認する。 */
function isLyricsAnalysisArtifact(value: unknown): value is LyricsAnalysisArtifact {
  if (!value || typeof value !== "object") return false;
  const artifact = value as Partial<LyricsAnalysisArtifact>;
  const fingerprint = artifact.source_fingerprint;
  return (
    !Object.keys(artifact).some((key) => artifactForbiddenKeys.has(key)) &&
    typeof artifact.cache_key === "string" && Boolean(artifact.cache_key.trim()) &&
    (artifact.cache_format === undefined || typeof artifact.cache_format === "string") &&
    (artifact.cache_version === undefined ||
      typeof artifact.cache_version === "string" ||
      (typeof artifact.cache_version === "number" && Number.isFinite(artifact.cache_version))) &&
    Boolean(fingerprint) && typeof fingerprint === "object" &&
    typeof fingerprint.algorithm === "string" && Boolean(fingerprint.algorithm.trim()) &&
    typeof fingerprint.value === "string" && /^[a-f0-9]{64}$/i.test(fingerprint.value) &&
    (artifact.demucs_model === undefined || typeof artifact.demucs_model === "string") &&
    (artifact.preprocess_version === undefined || typeof artifact.preprocess_version === "string") &&
    (artifact.sample_rate === undefined || isPositiveInteger(artifact.sample_rate)) &&
    (artifact.channels === undefined || isPositiveInteger(artifact.channels)) &&
    (artifact.expires_at === undefined ||
      (typeof artifact.expires_at === "number" && Number.isFinite(artifact.expires_at)) ||
      (typeof artifact.expires_at === "string" && !Number.isNaN(Date.parse(artifact.expires_at))))
  );
}

/** 表示素・診断を参照共有しないための軽量な clone。 */
function cloneAlignmentDiagnostics(value: AlignmentDiagnostics): AlignmentDiagnostics {
  return Array.isArray(value) ? [...value] : { ...value };
}

/** artifact を保存／hydrate 境界で独立値にする。 */
function cloneLyricsAnalysisArtifact(value: LyricsAnalysisArtifact): LyricsAnalysisArtifact {
  return {
    ...value,
    source_fingerprint: { ...value.source_fingerprint },
  };
}

/** revisionや原文offsetに使う0以上の有限整数だけを受理する。 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** cache version等に使う1以上の有限整数だけを受理する。 */
function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

const displayElementSources = new Set<DisplayElementSource>([
  "blank",
  "mms-ctc",
  "mms-ctc-interpolated",
  "line-proportional",
  "manual",
]);

const displayElementConflicts = new Set<DisplayElementConflict>([
  "boundary_conflict",
  "text_conflict",
  "orphaned_manual",
  "stale",
  "manual_conflict",
]);

const artifactForbiddenKeys = new Set([
  "path",
  "file_path",
  "artifact_path",
  "vocals_path",
  "session_id",
  "binary",
  "bytes",
  "data_base64",
]);

/** projectから読み込んだセグメントの個別Style／Effectを現在の制約へ正規化する。 */
function normalizeLyricsSegment(segment: LyricsSegment, catalog?: SubtitleEffectCatalog): LyricsSegment {
  if (!segment.style_override || !segment.effect_override) {
    const { style_override: _style, effect_override: _effect, ...inherited } = segment;
    return inherited;
  }
  return {
    ...segment,
    style_override: normalizeSubtitleStyle(segment.style_override),
    effect_override: catalog
      ? normalizeSubtitleEffect(segment.effect_override, catalog)
      : cloneSubtitleEffect(segment.effect_override),
  };
}

/** `normalizeSubtitleState`でbackend catalog準備後のproject stateを正規化する。 */
export function normalizeSubtitleState(
  value: unknown,
  catalog: SubtitleEffectCatalog,
): SubtitleProjectState {
  const normalized = validateSubtitleState(value, catalog);
  if (!normalized) throw new Error("Invalid subtitle project state.");
  return normalized;
}

/** `cloneSubtitleEffect`でcatalog到着前のraw effect値を配列込みで保持する。 */
function cloneSubtitleEffect(effect: SubtitleEffectSettings | undefined): SubtitleEffectSettings {
  const source = effect ?? DEFAULT_SUBTITLE_EFFECT;
  return {
    ...source,
    params: Object.fromEntries(
      Object.entries(source.params).map(([name, value]) => [name, Array.isArray(value) ? [...value] : value]),
    ),
  };
}

/** `isRhythmGridPoint`の入力が要求された条件やschemaを満たすか検証する。 */
function isRhythmGridPoint(value: unknown): value is RhythmGridPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<RhythmGridPoint>;
  return (
    Number.isFinite(point.time) &&
    (point.grid === "beat" || point.grid === "half-beat" || point.grid === "quarter-beat")
  );
}

/** `chronologicalSegments`で字幕・数値候補を時刻または統計条件に沿って抽出・整列する。 */
function chronologicalSegments<T extends { start: number; end: number }>(segments: readonly T[]) {
  return [...segments].sort((left, right) => left.start - right.start || left.end - right.end);
}

/** `normalizedGridTimes`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
function normalizedGridTimes(grid: readonly RhythmGridPoint[]) {
  return [...new Set(grid.map((point) => point.time).filter(Number.isFinite))]
    .sort((left, right) => left - right);
}

/** `normalizedStyleNumber`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
function normalizedStyleNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, minimum, maximum) : fallback;
}

/** `normalizedStyleInteger`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
function normalizedStyleInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Math.round(normalizedStyleNumber(value, fallback, minimum, maximum));
}

/** `findLastIndex`の候補と条件から、利用すべき値または操作を決定する。 */
function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return index;
  }
  return -1;
}

/** `median`で字幕・数値候補を時刻または統計条件に沿って抽出・整列する。 */
function median(values: readonly number[]) {
  if (!values.length) return 0;
  const middle = Math.floor(values.length / 2);
  return values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

/** `finiteNumbers`で字幕・数値候補を時刻または統計条件に沿って抽出・整列する。 */
function finiteNumbers(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => Number.isFinite(item)) : [];
}

import {
  WAVEFORM_BINARY_ENCODING,
  WAVEFORM_BINARY_MAX_POINTS,
  decodeWaveformPoints,
  type PackedWaveformPoint,
} from "./waveform-codec.js";

export const PROJECT_FORMAT = "songcut-project" as const;
export const PROJECT_SCHEMA_VERSION = 3 as const;
export const MAX_PROJECT_BYTES = 64 * 1024 * 1024;

export type InferenceDevice = "auto" | "npu" | "gpu" | "cpu";
export type WhisperModelKey = "tiny" | "base" | "small" | "whisper-large-v3-turbo-int8-ov";

export type ProjectTranscript = {
  segment_id: string;
  text: string;
  language: string | null;
  chunks: { start: number; end: number; text: string }[];
  backend: string;
  device_used: string;
  model_id: string;
  model_key?: WhisperModelKey;
  language_requested?: string;
  device_requested?: InferenceDevice;
  error?: string | null;
};

export type ProjectBoundarySideDiagnostic = {
  side: "start" | "end";
  coarse: number;
  search_start: number;
  search_end: number;
  otsu_threshold_db: number | null;
  low_cluster_median_db: number | null;
  high_cluster_median_db: number | null;
  transition_candidates: number[];
  selected_candidate: number | null;
  contrast_point: number | null;
  contrast_db: number | null;
  roll_seconds: number;
  automatic: number;
  delta_seconds: number;
  success: boolean;
  reason: string | null;
};

export type ProjectBoundarySegmentDiagnostic = {
  version: string;
  coarse_start: number;
  coarse_end: number;
  automatic_start: number;
  automatic_end: number;
  start: ProjectBoundarySideDiagnostic;
  end: ProjectBoundarySideDiagnostic;
};

export type ProjectBoundaryRefinementSummary = {
  version: string;
  settings: Record<string, boolean | number>;
  segment_count: number;
  applied_segments: number;
  refined_boundaries: number;
  skipped_reason: string | null;
};

export type ProjectSegment = {
  id: string;
  title?: string;
  filename_stem?: string;
  start: number;
  end: number;
  start_timecode: string;
  end_timecode: string;
  duration: number;
  confidence: number;
  source: string;
  match_source?: string;
  guide_line_number?: number;
  guide_line?: string;
  distance_seconds?: number | null;
  matched_segment_id?: string | null;
  boundary_refined?: boolean;
  boundary_refinement?: ProjectBoundarySegmentDiagnostic;
  flags: string[];
  user_edited: boolean;
  checked?: boolean;
  transcript?: ProjectTranscript;
};

export type ProjectExportCandidate = {
  id: string;
  segment_id: string;
  title: string;
  filename_stem: string;
  start: number;
  end: number;
  duration: number;
  match_source: string;
  checked: boolean;
};

export type ProjectWaveformPoint = PackedWaveformPoint;

export type ProjectWaveformSnapshot = {
  schema_version: 2;
  generator: string;
  source_fingerprint: string;
  duration_seconds: number;
  sample_rate: number;
  channels: number;
  completed_at: string;
  encoding: typeof WAVEFORM_BINARY_ENCODING;
  point_count: number;
  data_base64: string;
};

export type WhisperSettings = {
  enabled: boolean;
  model: WhisperModelKey;
  language: string;
  device: InferenceDevice;
  demucsDevice?: InferenceDevice;
  mmsDevice?: "auto" | "gpu" | "cpu";
  lyricsAlignmentAlgorithm?: "songcut-standard" | "uta-align";
};

export type ProjectSubtitleStyle = {
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

export type ProjectSubtitleEffect = {
  name: string;
  start_duration_ms: number;
  end_duration_ms: number;
  params: Record<string, string | number | boolean | string[]>;
};

/** Standard Align が生成し、Sub の行内に保存する表示素。 */
export type ProjectDisplayElement = {
  index?: number;
  stable_id: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: "blank" | "mms-ctc" | "mms-ctc-interpolated" | "line-proportional" | "manual";
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
  conflict: "boundary_conflict" | "text_conflict" | "orphaned_manual" | "stale" | "manual_conflict" | null;
  orphaned_manual: boolean;
  [key: string]: unknown;
};

/** 歌詞行の Standard Align 診断値。backend の追加 scalar を保持する。 */
export type ProjectAlignmentDiagnostics = string[] | Record<string, string | number | boolean | null>;

/** 再解析で共有する vocals artifact の識別情報（実体 path／binary は保持しない）。 */
export type ProjectLyricsAnalysisArtifact = {
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

export type ProjectLyricsSegment = {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: "lyrics" | "title" | "manual";
  low_confidence_outlier: boolean;
  user_edited: boolean;
  style_override?: ProjectSubtitleStyle;
  effect_override?: ProjectSubtitleEffect;
  render_cache?: {
    signature: string;
    png_base64: string;
    width: number;
    height: number;
  };
  display_elements?: ProjectDisplayElement[];
  line_revision?: number;
  display_element_revision?: number;
  display_element_boundary_locked?: boolean;
  start_locked?: boolean;
  end_locked?: boolean;
  alignment_diagnostics?: ProjectAlignmentDiagnostics;
  display_element_text?: string;
  needs_reanalysis?: boolean;
};

export type ProjectLyricsLane = {
  id: string;
  name: string;
  style: ProjectSubtitleStyle;
  effect?: ProjectSubtitleEffect;
  segments: ProjectLyricsSegment[];
};

export type ProjectSubtitleState = {
  lanes: ProjectLyricsLane[];
  active_lane_id: string;
  selected_segment_id: string | null;
  tempo_bpm: number;
  beat_times: number[];
  rhythm_grid: Array<{
    time: number;
    grid: "beat" | "half-beat" | "quarter-beat";
    attraction_radius: number;
    grid_penalty: number;
  }>;
  beat_warning: string | null;
  confidence_statistics: Record<string, unknown> | null;
  analysis_artifact?: ProjectLyricsAnalysisArtifact;
  analysis_algorithm?: "songcut-standard" | "uta-align";
};

export type CutOperationKind = "analysis" | "transcription" | "export";
export type SubOperationKind = "lyrics-analysis" | "subtitle-export";
export type ProjectOperationKind = CutOperationKind | SubOperationKind;

type ProjectOperationBase<K extends ProjectOperationKind> = {
  kind: K;
  status: "running" | "interrupted";
};

export type TranscriptionProjectOperation = ProjectOperationBase<"transcription"> & {
  settings?: WhisperSettings;
  pending_segment_ids?: string[];
};

type ProjectOperationForKind<K extends ProjectOperationKind> = K extends "transcription"
  ? TranscriptionProjectOperation
  : ProjectOperationBase<K>;

export type ProjectOperationRecord = ProjectOperationForKind<ProjectOperationKind>;

export type ProjectOperation = ProjectOperationRecord | null;
export type CutProjectOperation = Extract<ProjectOperationRecord, { kind: CutOperationKind }> | null;
export type SubProjectOperation = Extract<ProjectOperationRecord, { kind: SubOperationKind }> | null;

export type ProjectDocumentV1 = {
  format: typeof PROJECT_FORMAT;
  schema_version: typeof PROJECT_SCHEMA_VERSION;
  project_id: string;
  revision: number;
  created_at: string;
  updated_at: string;
  mode?: "cut" | "sub";
  source: {
    absolute_path: string;
    relative_path: string;
    filename: string;
    size_bytes: number;
    mtime_ms: number;
    duration_seconds: number;
    fingerprint: {
      algorithm: "sha256-head-tail-1m-v1";
      value: string;
    };
  };
  guide_text: string;
  settings: {
    analysis_device: InferenceDevice;
    whisper: WhisperSettings;
    export?: {
      filename_template: string;
    };
  };
  waveform_snapshot: ProjectWaveformSnapshot | null;
  analysis_snapshot: {
    timestamp_source: string;
    backend: string;
    device_requested: string;
    device_used: string;
    model_versions: Record<string, string>;
    elapsed_seconds: number;
    frame_scores: { t: number; score: number; rms: number }[];
    raw_segments: ProjectSegment[];
    boundary_refinement?: ProjectBoundaryRefinementSummary;
  } | null;
  segments: ProjectSegment[];
  export_candidates: ProjectExportCandidate[];
  view_state: {
    selected_segment_id: string | null;
    current_time: number;
    zoom_index: number;
  };
  operation: ProjectOperation;
  subtitle?: ProjectSubtitleState;
};

/**
 * Mode-specific views of the v3 document.  `mode` remains optional for Cut so
 * sidecars written before the mode field was introduced continue to type-check
 * and round-trip unchanged.  Runtime validation below enforces the stronger
 * field and operation invariants at the document boundary.
 */
export type CutProjectDocumentV3 = ProjectDocumentV1 & {
  mode?: "cut";
  subtitle?: never;
  operation: CutProjectOperation;
};

export type SubProjectDocumentV3 = ProjectDocumentV1 & {
  mode: "sub";
  subtitle: ProjectSubtitleState;
  operation: SubProjectOperation;
};

export type ModeProjectDocument = CutProjectDocumentV3 | SubProjectDocumentV3;

export type SourceIdentity = {
  path: string;
  filename: string;
  size_bytes: number;
  mtime_ms: number;
  fingerprint: {
    algorithm: "sha256-head-tail-1m-v1";
    value: string;
  };
};

export type ProjectOpenResult = {
  projectPath: string;
  document: ProjectDocumentV1;
  recoveredFrom: "target" | "temporary" | "backup";
};

export type ProjectSaveResult = {
  projectPath: string;
  revision: number;
  savedAt: string;
};

export type RecoverySnapshot = {
  format: "songcut-recovery";
  schema_version: 1;
  session_id: string;
  project_path: string;
  saved_at: string;
  document: ProjectDocumentV1;
};

const inferenceDevices = new Set<InferenceDevice>(["auto", "npu", "gpu", "cpu"]);
const whisperModels = new Set<WhisperModelKey>([
  "tiny",
  "base",
  "small",
  "whisper-large-v3-turbo-int8-ov",
]);
const cutOperationKinds = new Set<CutOperationKind>(["analysis", "transcription", "export"]);
const subOperationKinds = new Set<SubOperationKind>(["lyrics-analysis", "subtitle-export"]);
const displayElementSources = new Set<ProjectDisplayElement["source"]>([
  "blank",
  "mms-ctc",
  "mms-ctc-interpolated",
  "line-proportional",
  "manual",
]);
const displayElementConflicts = new Set<Exclude<ProjectDisplayElement["conflict"], null>>([
  "boundary_conflict",
  "text_conflict",
  "orphaned_manual",
  "stale",
  "manual_conflict",
]);

/** 動画pathとmodeから、衝突しないCut/Sub sidecarの保存pathを決定する。 */
export function sidecarPathForVideo(videoPath: string, mode: "cut" | "sub" = "cut") {
  return mode === "sub" ? `${videoPath}.sub.songcut` : `${videoPath}.songcut`;
}

/** `isProjectOperationKindForMode`の入力が要求された条件やschemaを満たすか検証する。 */
export function isProjectOperationKindForMode(mode: "cut" | "sub", kind: string): boolean {
  return mode === "sub" ? subOperationKinds.has(kind as SubOperationKind) : cutOperationKinds.has(kind as CutOperationKind);
}

/** `parseProjectText`の外部表現を検証し、アプリ内部で扱う状態へ復元する。 */
export function parseProjectText(text: string): ProjectDocumentV1 {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid project JSON: ${String(error)}`);
  }
  assertProjectDocument(value);
  return value;
}

/** `assertProjectDocument`の入力が要求された条件やschemaを満たすか検証する。 */
export function assertProjectDocument(value: unknown): asserts value is ModeProjectDocument {
  const root = objectValue(value, "project");
  if (root.format !== PROJECT_FORMAT) throw new Error("Not a songcut project.");
  if (root.schema_version !== PROJECT_SCHEMA_VERSION) {
    if (typeof root.schema_version === "number" && root.schema_version > PROJECT_SCHEMA_VERSION) {
      throw new Error("This project was created by a newer version of songcut.");
    }
    throw new Error(`Unsupported songcut project schema: ${String(root.schema_version)}`);
  }
  stringValue(root.project_id, "project_id");
  nonNegativeInteger(root.revision, "revision");
  dateValue(root.created_at, "created_at");
  dateValue(root.updated_at, "updated_at");
  if (root.mode !== undefined && root.mode !== "cut" && root.mode !== "sub") {
    throw new Error("Invalid project mode.");
  }

  const source = objectValue(root.source, "source");
  stringValue(source.absolute_path, "source.absolute_path");
  stringValue(source.relative_path, "source.relative_path");
  stringValue(source.filename, "source.filename");
  nonNegativeFinite(source.size_bytes, "source.size_bytes");
  nonNegativeFinite(source.mtime_ms, "source.mtime_ms");
  nonNegativeFinite(source.duration_seconds, "source.duration_seconds");
  const fingerprint = objectValue(source.fingerprint, "source.fingerprint");
  if (fingerprint.algorithm !== "sha256-head-tail-1m-v1") throw new Error("Unsupported source fingerprint.");
  const fingerprintValue = stringValue(fingerprint.value, "source.fingerprint.value");
  if (!/^[a-f0-9]{64}$/i.test(fingerprintValue)) throw new Error("Invalid source fingerprint value.");

  stringValue(root.guide_text, "guide_text", true);
  const settings = objectValue(root.settings, "settings");
  inferenceDevice(settings.analysis_device, "settings.analysis_device");
  whisperSettings(settings.whisper, "settings.whisper");
  if (settings.export !== undefined) {
    const exportSettings = objectValue(settings.export, "settings.export");
    stringValue(exportSettings.filename_template, "settings.export.filename_template", true);
  }

  if (root.waveform_snapshot !== null) {
    const waveform = objectValue(root.waveform_snapshot, "waveform_snapshot");
    if (waveform.schema_version !== 2) throw new Error("Unsupported waveform snapshot schema.");
    stringValue(waveform.generator, "waveform_snapshot.generator");
    const waveformFingerprint = stringValue(waveform.source_fingerprint, "waveform_snapshot.source_fingerprint");
    if (!/^[a-f0-9]{64}$/i.test(waveformFingerprint)) throw new Error("Invalid waveform source fingerprint.");
    nonNegativeFinite(waveform.duration_seconds, "waveform_snapshot.duration_seconds");
    nonNegativeInteger(waveform.sample_rate, "waveform_snapshot.sample_rate");
    nonNegativeInteger(waveform.channels, "waveform_snapshot.channels");
    dateValue(waveform.completed_at, "waveform_snapshot.completed_at");
    if (waveform.encoding !== WAVEFORM_BINARY_ENCODING) throw new Error("Unsupported waveform binary encoding.");
    const pointCount = nonNegativeInteger(waveform.point_count, "waveform_snapshot.point_count");
    if (pointCount > WAVEFORM_BINARY_MAX_POINTS) throw new Error("Waveform exceeds the supported point limit.");
    const dataBase64 = stringValue(waveform.data_base64, "waveform_snapshot.data_base64", true);
    decodeWaveformPoints(dataBase64, pointCount);
  }

  if (root.analysis_snapshot !== null) {
    const snapshot = objectValue(root.analysis_snapshot, "analysis_snapshot");
    stringValue(snapshot.timestamp_source, "analysis_snapshot.timestamp_source", true);
    stringValue(snapshot.backend, "analysis_snapshot.backend", true);
    stringValue(snapshot.device_requested, "analysis_snapshot.device_requested", true);
    stringValue(snapshot.device_used, "analysis_snapshot.device_used", true);
    objectValue(snapshot.model_versions, "analysis_snapshot.model_versions");
    nonNegativeFinite(snapshot.elapsed_seconds, "analysis_snapshot.elapsed_seconds");
    arrayValue(snapshot.frame_scores, "analysis_snapshot.frame_scores").forEach((point, index) => {
      const row = objectValue(point, `analysis_snapshot.frame_scores[${index}]`);
      nonNegativeFinite(row.t, `analysis_snapshot.frame_scores[${index}].t`);
      finiteValue(row.score, `analysis_snapshot.frame_scores[${index}].score`);
      finiteValue(row.rms, `analysis_snapshot.frame_scores[${index}].rms`);
    });
    validateSegments(snapshot.raw_segments, "analysis_snapshot.raw_segments", true);
    if (snapshot.boundary_refinement !== undefined) validateBoundaryRefinementSummary(snapshot.boundary_refinement, "analysis_snapshot.boundary_refinement");
  }

  validateSegments(root.segments, "segments", false);
  const segmentIds = new Set((root.segments as ProjectSegment[]).map((segment) => segment.id));
  arrayValue(root.export_candidates, "export_candidates").forEach((candidate, index) => {
    const row = objectValue(candidate, `export_candidates[${index}]`);
    stringValue(row.id, `export_candidates[${index}].id`);
    const segmentId = stringValue(row.segment_id, `export_candidates[${index}].segment_id`);
    if (!segmentIds.has(segmentId)) throw new Error(`Unknown export candidate segment: ${segmentId}`);
    stringValue(row.title, `export_candidates[${index}].title`, true);
    stringValue(row.filename_stem, `export_candidates[${index}].filename_stem`, true);
    const start = nonNegativeFinite(row.start, `export_candidates[${index}].start`);
    const end = nonNegativeFinite(row.end, `export_candidates[${index}].end`);
    if (end <= start) throw new Error(`Invalid export candidate range: ${segmentId}`);
    nonNegativeFinite(row.duration, `export_candidates[${index}].duration`);
    stringValue(row.match_source, `export_candidates[${index}].match_source`, true);
    booleanValue(row.checked, `export_candidates[${index}].checked`);
  });

  const view = objectValue(root.view_state, "view_state");
  if (view.selected_segment_id !== null) stringValue(view.selected_segment_id, "view_state.selected_segment_id");
  nonNegativeFinite(view.current_time, "view_state.current_time");
  nonNegativeInteger(view.zoom_index, "view_state.zoom_index");
  validateOperation(root.operation);
  if (root.subtitle !== undefined) validateSubtitleState(root.subtitle, "subtitle");
  validateModeInvariants(root);
}

/**
 * Return a strict mode-discriminated view for internal callers.  Legacy v3
 * Cut documents omit `mode`; this helper supplies the semantic default on a
 * shallow copy while parse/load continue returning the original object shape
 * for byte-compatible round trips.
 */
/** `normalizeProjectDocument`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
export function normalizeProjectDocument(value: unknown): ModeProjectDocument {
  assertProjectDocument(value);
  if (value.mode === undefined) return { ...value, mode: "cut" } as CutProjectDocumentV3;
  return value;
}

/**
 * Validate mode-specific fields after the common v3 shape has been checked.
 * A missing mode is the historical Cut representation, so it is intentionally
 * normalized semantically without mutating the parsed object.
 */
function validateModeInvariants(root: Record<string, unknown>) {
  const mode = root.mode === "sub" ? "sub" : "cut";
  const operation = root.operation === null ? null : objectValue(root.operation, "operation");
  if (mode === "cut") {
    if (root.subtitle !== undefined) throw new Error("Cut project must not contain subtitle state.");
    if (operation && !isProjectOperationKindForMode(mode, String(operation.kind))) {
      throw new Error(`Operation kind ${JSON.stringify(String(operation.kind))} is incompatible with cut project.`);
    }
    return;
  }

  if (root.subtitle === undefined) throw new Error("Sub project is missing subtitle state.");
  if (root.analysis_snapshot !== null) {
    throw new Error("Sub project must not contain analysis_snapshot.");
  }
  if (!Array.isArray(root.export_candidates) || root.export_candidates.length > 0) {
    throw new Error("Sub project must not contain Cut export_candidates.");
  }
  if (!Array.isArray(root.segments) || root.segments.length > 0) {
    throw new Error("Sub project must not contain Cut segments.");
  }
  if (operation && !isProjectOperationKindForMode(mode, String(operation.kind))) {
    throw new Error(`Operation kind ${JSON.stringify(String(operation.kind))} is incompatible with sub project.`);
  }
}

/** `assertRecoverySnapshot`の入力が要求された条件やschemaを満たすか検証する。 */
export function assertRecoverySnapshot(value: unknown): asserts value is RecoverySnapshot {
  const root = objectValue(value, "recovery");
  if (root.format !== "songcut-recovery" || root.schema_version !== 1) throw new Error("Invalid recovery snapshot.");
  stringValue(root.session_id, "session_id");
  stringValue(root.project_path, "project_path");
  dateValue(root.saved_at, "saved_at");
  assertProjectDocument(root.document);
}

function validateSegments(value: unknown, label: string, requireSorted: boolean) {
  let priorStart = -1;
  const ids = new Set<string>();
  arrayValue(value, label).forEach((segment, index) => {
    const row = objectValue(segment, `${label}[${index}]`);
    const id = stringValue(row.id, `${label}[${index}].id`);
    if (ids.has(id)) throw new Error(`Duplicate segment id: ${id}`);
    ids.add(id);
    const start = nonNegativeFinite(row.start, `${label}[${index}].start`);
    const end = nonNegativeFinite(row.end, `${label}[${index}].end`);
    if (end <= start) throw new Error(`Invalid segment range: ${id}`);
    if (requireSorted && start < priorStart) throw new Error(`${label} must be sorted by start time.`);
    priorStart = start;
    stringValue(row.start_timecode, `${label}[${index}].start_timecode`, true);
    stringValue(row.end_timecode, `${label}[${index}].end_timecode`, true);
    nonNegativeFinite(row.duration, `${label}[${index}].duration`);
    finiteValue(row.confidence, `${label}[${index}].confidence`);
    stringValue(row.source, `${label}[${index}].source`, true);
    if (row.match_source !== undefined) {
      stringValue(row.match_source, `${label}[${index}].match_source`, true);
    }
    if (row.guide_line_number !== undefined) {
      const lineNumber = nonNegativeFinite(row.guide_line_number, `${label}[${index}].guide_line_number`);
      if (!Number.isInteger(lineNumber) || lineNumber < 1) {
        throw new Error(`${label}[${index}].guide_line_number must be a positive integer.`);
      }
    }
    if (row.guide_line !== undefined) {
      stringValue(row.guide_line, `${label}[${index}].guide_line`, true);
    }
    if (row.distance_seconds !== undefined && row.distance_seconds !== null) {
      nonNegativeFinite(row.distance_seconds, `${label}[${index}].distance_seconds`);
    }
    if (row.matched_segment_id !== undefined && row.matched_segment_id !== null) {
      stringValue(row.matched_segment_id, `${label}[${index}].matched_segment_id`);
    }
    if (row.boundary_refined !== undefined) booleanValue(row.boundary_refined, `${label}[${index}].boundary_refined`);
    if (row.boundary_refinement !== undefined) validateBoundarySegmentDiagnostic(row.boundary_refinement, `${label}[${index}].boundary_refinement`);
    arrayValue(row.flags, `${label}[${index}].flags`).forEach((flag, flagIndex) =>
      stringValue(flag, `${label}[${index}].flags[${flagIndex}]`, true)
    );
    booleanValue(row.user_edited, `${label}[${index}].user_edited`);
    if (row.checked !== undefined) booleanValue(row.checked, `${label}[${index}].checked`);
    if (row.title !== undefined) stringValue(row.title, `${label}[${index}].title`, true);
    if (row.filename_stem !== undefined) stringValue(row.filename_stem, `${label}[${index}].filename_stem`, true);
    if (row.transcript !== undefined) validateTranscript(row.transcript, `${label}[${index}].transcript`, id);
  });
}

function validateSubtitleState(value: unknown, label: string) {
  const row = objectValue(value, label);
  const lanes = arrayValue(row.lanes, `${label}.lanes`);
  if (lanes.length < 1 || lanes.length > 3) throw new Error(`${label}.lanes must contain 1 through 3 lanes.`);
  const laneIds = new Set<string>();
  const segmentIds = new Set<string>();
  const displayElementIds = new Set<string>();
  lanes.forEach((value, laneIndex) => {
    const lane = objectValue(value, `${label}.lanes[${laneIndex}]`);
    const laneId = stringValue(lane.id, `${label}.lanes[${laneIndex}].id`);
    if (laneIds.has(laneId)) throw new Error(`Duplicate subtitle lane id: ${laneId}`);
    laneIds.add(laneId);
    stringValue(lane.name, `${label}.lanes[${laneIndex}].name`, true);
    validateSubtitleStyle(lane.style, `${label}.lanes[${laneIndex}].style`);
    if (lane.effect !== undefined) validateSubtitleEffect(lane.effect, `${label}.lanes[${laneIndex}].effect`);
    let previousEnd = -1;
    arrayValue(lane.segments, `${label}.lanes[${laneIndex}].segments`).forEach((value, segmentIndex) => {
      const segmentLabel = `${label}.lanes[${laneIndex}].segments[${segmentIndex}]`;
      const segment = objectValue(value, segmentLabel);
      const id = stringValue(segment.id, `${segmentLabel}.id`);
      if (segmentIds.has(id)) throw new Error(`Duplicate subtitle segment id: ${id}`);
      segmentIds.add(id);
      stringValue(segment.text, `${segmentLabel}.text`, true);
      const start = nonNegativeFinite(segment.start, `${segmentLabel}.start`);
      const end = nonNegativeFinite(segment.end, `${segmentLabel}.end`);
      if (end <= start) throw new Error(`Invalid subtitle segment range: ${id}`);
      if (start < previousEnd - 1e-6) throw new Error(`Overlapping subtitle segments in lane: ${laneId}`);
      previousEnd = end;
      finiteValue(segment.confidence, `${segmentLabel}.confidence`);
      if (segment.source !== "lyrics" && segment.source !== "title" && segment.source !== "manual") {
        throw new Error(`Invalid ${segmentLabel}.source.`);
      }
      booleanValue(segment.low_confidence_outlier, `${segmentLabel}.low_confidence_outlier`);
      booleanValue(segment.user_edited, `${segmentLabel}.user_edited`);
      const hasStyleOverride = segment.style_override !== undefined;
      const hasEffectOverride = segment.effect_override !== undefined;
      if (hasStyleOverride !== hasEffectOverride) {
        throw new Error(`${segmentLabel} must provide both style_override and effect_override.`);
      }
      if (hasStyleOverride) {
        validateSubtitleStyle(segment.style_override, `${segmentLabel}.style_override`);
        validateSubtitleEffect(segment.effect_override, `${segmentLabel}.effect_override`);
      }
      if (segment.display_elements !== undefined) {
        validateDisplayElements(
          segment.display_elements,
          start,
          end,
          `${segmentLabel}.display_elements`,
          displayElementIds,
        );
      }
      if (segment.line_revision !== undefined) {
        nonNegativeInteger(segment.line_revision, `${segmentLabel}.line_revision`);
      }
      if (segment.display_element_revision !== undefined) {
        nonNegativeInteger(segment.display_element_revision, `${segmentLabel}.display_element_revision`);
      }
      if (segment.display_element_boundary_locked !== undefined) {
        booleanValue(segment.display_element_boundary_locked, `${segmentLabel}.display_element_boundary_locked`);
      }
      if (segment.start_locked !== undefined) booleanValue(segment.start_locked, `${segmentLabel}.start_locked`);
      if (segment.end_locked !== undefined) booleanValue(segment.end_locked, `${segmentLabel}.end_locked`);
      if (segment.alignment_diagnostics !== undefined) {
        validateAlignmentDiagnostics(segment.alignment_diagnostics, `${segmentLabel}.alignment_diagnostics`);
      }
      if (segment.display_element_text !== undefined) {
        stringValue(segment.display_element_text, `${segmentLabel}.display_element_text`, true);
      }
      if (segment.needs_reanalysis !== undefined) booleanValue(segment.needs_reanalysis, `${segmentLabel}.needs_reanalysis`);
      if (segment.render_cache !== undefined) {
        const cache = objectValue(segment.render_cache, `${segmentLabel}.render_cache`);
        stringValue(cache.signature, `${segmentLabel}.render_cache.signature`);
        stringValue(cache.png_base64, `${segmentLabel}.render_cache.png_base64`);
        const width = nonNegativeInteger(cache.width, `${segmentLabel}.render_cache.width`);
        const height = nonNegativeInteger(cache.height, `${segmentLabel}.render_cache.height`);
        if (width < 1 || height < 1) throw new Error(`${segmentLabel}.render_cache dimensions must be positive.`);
      }
    });
  });
  const activeLaneId = stringValue(row.active_lane_id, `${label}.active_lane_id`);
  if (!laneIds.has(activeLaneId)) throw new Error(`Unknown active subtitle lane: ${activeLaneId}`);
  if (row.selected_segment_id !== null) {
    const selectedId = stringValue(row.selected_segment_id, `${label}.selected_segment_id`);
    if (!segmentIds.has(selectedId)) throw new Error(`Unknown selected subtitle segment: ${selectedId}`);
  }
  nonNegativeFinite(row.tempo_bpm, `${label}.tempo_bpm`);
  arrayValue(row.beat_times, `${label}.beat_times`).forEach((time, index) =>
    nonNegativeFinite(time, `${label}.beat_times[${index}]`)
  );
  let priorGridTime = -1;
  arrayValue(row.rhythm_grid, `${label}.rhythm_grid`).forEach((value, index) => {
    const point = objectValue(value, `${label}.rhythm_grid[${index}]`);
    const time = nonNegativeFinite(point.time, `${label}.rhythm_grid[${index}].time`);
    if (time < priorGridTime) throw new Error(`${label}.rhythm_grid must be sorted.`);
    priorGridTime = time;
    if (point.grid !== "beat" && point.grid !== "half-beat" && point.grid !== "quarter-beat") {
      throw new Error(`Invalid ${label}.rhythm_grid[${index}].grid.`);
    }
    nonNegativeFinite(point.attraction_radius, `${label}.rhythm_grid[${index}].attraction_radius`);
    nonNegativeFinite(point.grid_penalty, `${label}.rhythm_grid[${index}].grid_penalty`);
  });
  if (row.beat_warning !== null) stringValue(row.beat_warning, `${label}.beat_warning`, true);
  if (row.confidence_statistics !== null) objectValue(row.confidence_statistics, `${label}.confidence_statistics`);
  if (row.analysis_artifact !== undefined) validateLyricsAnalysisArtifact(row.analysis_artifact, `${label}.analysis_artifact`);
  if (row.analysis_algorithm !== undefined
    && row.analysis_algorithm !== "songcut-standard"
    && row.analysis_algorithm !== "uta-align") {
    throw new Error(`Invalid ${label}.analysis_algorithm.`);
  }
}

function validateDisplayElements(
  value: unknown,
  lineStart: number,
  lineEnd: number,
  label: string,
  allIds: Set<string>,
) {
  const elements = arrayValue(value, label);
  if (!elements.length) throw new Error(`${label} must contain at least one display element.`);
  let cursor = lineStart;
  const localIds = new Set<string>();
  elements.forEach((value, index) => {
    const itemLabel = `${label}[${index}]`;
    const row = objectValue(value, itemLabel);
    const stableId = stringValue(row.stable_id, `${itemLabel}.stable_id`);
    if (localIds.has(stableId) || allIds.has(stableId)) throw new Error(`Duplicate display element id: ${stableId}`);
    localIds.add(stableId);
    allIds.add(stableId);
    if (row.index !== undefined) nonNegativeInteger(row.index, `${itemLabel}.index`);
    stringValue(row.text, `${itemLabel}.text`, true);
    const start = nonNegativeFinite(row.start, `${itemLabel}.start`);
    const end = nonNegativeFinite(row.end, `${itemLabel}.end`);
    if (end <= start) throw new Error(`Invalid display element range: ${stableId}`);
    if (Math.abs(start - cursor) > 1e-6) {
      throw new Error(`${label} must form a gap-free partition of its line.`);
    }
    cursor = end;
    finiteValue(row.confidence, `${itemLabel}.confidence`);
    if (!displayElementSources.has(row.source as ProjectDisplayElement["source"])) {
      throw new Error(`Invalid ${itemLabel}.source.`);
    }
    const sourceStart = nonNegativeInteger(row.source_start, `${itemLabel}.source_start`);
    const sourceEnd = nonNegativeInteger(row.source_end, `${itemLabel}.source_end`);
    if (sourceEnd < sourceStart) throw new Error(`Invalid ${itemLabel} source range.`);
    stringValue(row.pronunciation, `${itemLabel}.pronunciation`, true);
    const tokenStart = nonNegativeInteger(row.token_start, `${itemLabel}.token_start`);
    const tokenEnd = nonNegativeInteger(row.token_end, `${itemLabel}.token_end`);
    if (tokenEnd < tokenStart) throw new Error(`Invalid ${itemLabel} token range.`);
    stringValue(row.origin_key, `${itemLabel}.origin_key`, true);
    booleanValue(row.manual_start, `${itemLabel}.manual_start`);
    booleanValue(row.manual_end, `${itemLabel}.manual_end`);
    booleanValue(row.manual_structure, `${itemLabel}.manual_structure`);
    nonNegativeInteger(row.parent_revision, `${itemLabel}.parent_revision`);
    if (row.conflict !== null && !displayElementConflicts.has(
      row.conflict as Exclude<ProjectDisplayElement["conflict"], null>
    )) {
      throw new Error(`Invalid ${itemLabel}.conflict.`);
    }
    if (row.conflict !== null) stringValue(row.conflict, `${itemLabel}.conflict`);
    booleanValue(row.orphaned_manual, `${itemLabel}.orphaned_manual`);
  });
  if (Math.abs(cursor - lineEnd) > 1e-6) {
    throw new Error(`${label} must end at its line end.`);
  }
}

function validateAlignmentDiagnostics(value: unknown, label: string) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => stringValue(item, `${label}[${index}]`, true));
    return;
  }
  const row = objectValue(value, label);
  Object.entries(row).forEach(([key, item]) => {
    if (
      item !== null && typeof item !== "string" && typeof item !== "boolean" &&
      !(typeof item === "number" && Number.isFinite(item))
    ) {
      throw new Error(`${label}.${key} must be a finite JSON scalar.`);
    }
  });
}

function validateLyricsAnalysisArtifact(value: unknown, label: string) {
  const row = objectValue(value, label);
  for (const key of Object.keys(row)) {
    if (artifactForbiddenKeys.has(key)) {
      throw new Error(`${label}.${key} is not a persisted artifact identifier.`);
    }
  }
  stringValue(row.cache_key, `${label}.cache_key`);
  if (row.cache_format !== undefined) stringValue(row.cache_format, `${label}.cache_format`);
  if (row.cache_version !== undefined) {
    if (typeof row.cache_version === "number") finiteValue(row.cache_version, `${label}.cache_version`);
    else stringValue(row.cache_version, `${label}.cache_version`);
  }
  const fingerprint = objectValue(row.source_fingerprint, `${label}.source_fingerprint`);
  stringValue(fingerprint.algorithm, `${label}.source_fingerprint.algorithm`);
  const fingerprintValue = stringValue(fingerprint.value, `${label}.source_fingerprint.value`);
  if (!/^[a-f0-9]{64}$/i.test(fingerprintValue)) {
    throw new Error(`Invalid ${label}.source_fingerprint.value.`);
  }
  if (row.demucs_model !== undefined) stringValue(row.demucs_model, `${label}.demucs_model`);
  if (row.preprocess_version !== undefined) stringValue(row.preprocess_version, `${label}.preprocess_version`);
  if (row.sample_rate !== undefined) {
    const sampleRate = nonNegativeInteger(row.sample_rate, `${label}.sample_rate`);
    if (sampleRate < 1) throw new Error(`${label}.sample_rate must be positive.`);
  }
  if (row.channels !== undefined) {
    const channels = nonNegativeInteger(row.channels, `${label}.channels`);
    if (channels < 1) throw new Error(`${label}.channels must be positive.`);
  }
  if (row.expires_at !== undefined) {
    if (typeof row.expires_at === "number") {
      nonNegativeFinite(row.expires_at, `${label}.expires_at`);
    } else if (typeof row.expires_at === "string") {
      if (Number.isNaN(Date.parse(row.expires_at))) throw new Error(`${label}.expires_at must be an ISO date.`);
    } else {
      throw new Error(`${label}.expires_at must be an ISO date or epoch.`);
    }
  }
}

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

function validateSubtitleEffect(value: unknown, label: string) {
  const row = objectValue(value, label);
  stringValue(row.name, `${label}.name`);
  nonNegativeInteger(row.start_duration_ms, `${label}.start_duration_ms`);
  nonNegativeInteger(row.end_duration_ms, `${label}.end_duration_ms`);
  const params = objectValue(row.params, `${label}.params`);
  Object.entries(params).forEach(([name, parameter]) => {
    const scalar =
      typeof parameter === "string" ||
      typeof parameter === "boolean" ||
      (typeof parameter === "number" && Number.isFinite(parameter));
    const stringArray =
      Array.isArray(parameter) && parameter.every((item) => typeof item === "string");
    if (!scalar && !stringArray) {
      throw new Error(
        `${label}.params.${name} must be a finite number, string, boolean, or string array.`,
      );
    }
  });
}

function validateSubtitleStyle(value: unknown, label: string) {
  const row = objectValue(value, label);
  stringValue(row.font_name, `${label}.font_name`);
  nonNegativeFinite(row.font_size, `${label}.font_size`);
  stringValue(row.primary_color, `${label}.primary_color`);
  stringValue(row.outline_color, `${label}.outline_color`);
  stringValue(row.background_color, `${label}.background_color`);
  booleanValue(row.bold, `${label}.bold`);
  booleanValue(row.italic, `${label}.italic`);
  nonNegativeFinite(row.outline, `${label}.outline`);
  nonNegativeFinite(row.shadow, `${label}.shadow`);
  const alignment = nonNegativeInteger(row.alignment, `${label}.alignment`);
  if (alignment < 1 || alignment > 9) throw new Error(`${label}.alignment must be from 1 through 9.`);
  nonNegativeInteger(row.margin_l, `${label}.margin_l`);
  nonNegativeInteger(row.margin_r, `${label}.margin_r`);
  nonNegativeInteger(row.margin_v, `${label}.margin_v`);
}

function validateTranscript(value: unknown, label: string, segmentId: string) {
  const row = objectValue(value, label);
  if (stringValue(row.segment_id, `${label}.segment_id`) !== segmentId) throw new Error(`${label} has the wrong segment id.`);
  stringValue(row.text, `${label}.text`, true);
  if (row.language !== null) stringValue(row.language, `${label}.language`, true);
  stringValue(row.backend, `${label}.backend`, true);
  stringValue(row.device_used, `${label}.device_used`, true);
  stringValue(row.model_id, `${label}.model_id`, true);
  if (row.model_key !== undefined && !whisperModels.has(row.model_key as WhisperModelKey)) {
    throw new Error(`Invalid ${label}.model_key.`);
  }
  if (row.language_requested !== undefined) stringValue(row.language_requested, `${label}.language_requested`);
  if (row.device_requested !== undefined) inferenceDevice(row.device_requested, `${label}.device_requested`);
  if (row.error !== undefined && row.error !== null) stringValue(row.error, `${label}.error`, true);
  arrayValue(row.chunks, `${label}.chunks`).forEach((chunk, index) => {
    const item = objectValue(chunk, `${label}.chunks[${index}]`);
    const start = nonNegativeFinite(item.start, `${label}.chunks[${index}].start`);
    const end = nonNegativeFinite(item.end, `${label}.chunks[${index}].end`);
    if (end < start) throw new Error(`Invalid transcript chunk in ${label}.`);
    stringValue(item.text, `${label}.chunks[${index}].text`, true);
  });
}

function validateBoundaryRefinementSummary(value: unknown, label: string) {
  const row = objectValue(value, label);
  stringValue(row.version, `${label}.version`);
  const settings = objectValue(row.settings, `${label}.settings`);
  Object.entries(settings).forEach(([key, setting]) => {
    if (typeof setting !== "boolean") finiteValue(setting, `${label}.settings.${key}`);
  });
  nonNegativeInteger(row.segment_count, `${label}.segment_count`);
  nonNegativeInteger(row.applied_segments, `${label}.applied_segments`);
  nonNegativeInteger(row.refined_boundaries, `${label}.refined_boundaries`);
  if (row.skipped_reason !== null) stringValue(row.skipped_reason, `${label}.skipped_reason`);
}

function validateBoundarySegmentDiagnostic(value: unknown, label: string) {
  const row = objectValue(value, label);
  stringValue(row.version, `${label}.version`);
  for (const key of ["coarse_start", "coarse_end", "automatic_start", "automatic_end"] as const) {
    nonNegativeFinite(row[key], `${label}.${key}`);
  }
  validateBoundarySideDiagnostic(row.start, `${label}.start`, "start");
  validateBoundarySideDiagnostic(row.end, `${label}.end`, "end");
}

function validateBoundarySideDiagnostic(value: unknown, label: string, expectedSide: "start" | "end") {
  const row = objectValue(value, label);
  if (row.side !== expectedSide) throw new Error(`${label}.side must be ${expectedSide}.`);
  for (const key of ["coarse", "search_start", "search_end", "roll_seconds", "automatic"] as const) {
    nonNegativeFinite(row[key], `${label}.${key}`);
  }
  for (const key of ["otsu_threshold_db", "low_cluster_median_db", "high_cluster_median_db", "contrast_db"] as const) {
    if (row[key] !== null) finiteValue(row[key], `${label}.${key}`);
  }
  for (const key of ["selected_candidate", "contrast_point"] as const) {
    if (row[key] !== null) nonNegativeFinite(row[key], `${label}.${key}`);
  }
  arrayValue(row.transition_candidates, `${label}.transition_candidates`).forEach((candidate, index) =>
    nonNegativeFinite(candidate, `${label}.transition_candidates[${index}]`)
  );
  finiteValue(row.delta_seconds, `${label}.delta_seconds`);
  booleanValue(row.success, `${label}.success`);
  if (row.reason !== null) stringValue(row.reason, `${label}.reason`);
}

function whisperSettings(value: unknown, label: string) {
  const row = objectValue(value, label);
  booleanValue(row.enabled, `${label}.enabled`);
  if (!whisperModels.has(row.model as WhisperModelKey)) throw new Error(`Invalid ${label}.model.`);
  stringValue(row.language, `${label}.language`);
  inferenceDevice(row.device, `${label}.device`);
  if (row.demucsDevice !== undefined) inferenceDevice(row.demucsDevice, `${label}.demucsDevice`);
  if (
    row.mmsDevice !== undefined &&
    row.mmsDevice !== "auto" &&
    row.mmsDevice !== "gpu" &&
    row.mmsDevice !== "cpu"
  ) {
    throw new Error(`Invalid ${label}.mmsDevice.`);
  }
  if (
    row.lyricsAlignmentAlgorithm !== undefined &&
    row.lyricsAlignmentAlgorithm !== "songcut-standard" &&
    row.lyricsAlignmentAlgorithm !== "uta-align"
  ) {
    throw new Error(`Invalid ${label}.lyricsAlignmentAlgorithm.`);
  }
}

function validateOperation(value: unknown) {
  if (value === null) return;
  const row = objectValue(value, "operation");
  if (
    !new Set(["analysis", "transcription", "export", "lyrics-analysis", "subtitle-export"]).has(
      String(row.kind)
    )
  ) {
    throw new Error("Invalid operation.kind.");
  }
  if (row.status !== "running" && row.status !== "interrupted") throw new Error("Invalid operation.status.");
  if (row.settings !== undefined) whisperSettings(row.settings, "operation.settings");
  if (row.pending_segment_ids !== undefined) {
    arrayValue(row.pending_segment_ids, "operation.pending_segment_ids").forEach((id, index) =>
      stringValue(id, `operation.pending_segment_ids[${index}]`)
    );
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function stringValue(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`${label} must be a string.`);
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}

function finiteValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function nonNegativeFinite(value: unknown, label: string): number {
  const result = finiteValue(value, label);
  if (result < 0) throw new Error(`${label} must not be negative.`);
  return result;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const result = nonNegativeFinite(value, label);
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer.`);
  return result;
}

function inferenceDevice(value: unknown, label: string): InferenceDevice {
  if (!inferenceDevices.has(value as InferenceDevice)) throw new Error(`Invalid ${label}.`);
  return value as InferenceDevice;
}

function dateValue(value: unknown, label: string) {
  const text = stringValue(value, label);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be an ISO date.`);
}

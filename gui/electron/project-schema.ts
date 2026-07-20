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
export type WhisperModelKey = "tiny" | "base" | "small";

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
};

export type ProjectOperation = {
  kind: "analysis" | "transcription" | "export";
  status: "running" | "interrupted";
  settings?: WhisperSettings;
  pending_segment_ids?: string[];
} | null;

export type ProjectDocumentV1 = {
  format: typeof PROJECT_FORMAT;
  schema_version: typeof PROJECT_SCHEMA_VERSION;
  project_id: string;
  revision: number;
  created_at: string;
  updated_at: string;
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
  } | null;
  segments: ProjectSegment[];
  export_candidates: ProjectExportCandidate[];
  view_state: {
    selected_segment_id: string | null;
    current_time: number;
    zoom_index: number;
  };
  operation: ProjectOperation;
};

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
const whisperModels = new Set<WhisperModelKey>(["tiny", "base", "small"]);

export function sidecarPathForVideo(videoPath: string) {
  return `${videoPath}.songcut`;
}

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

export function assertProjectDocument(value: unknown): asserts value is ProjectDocumentV1 {
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
}

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

function whisperSettings(value: unknown, label: string) {
  const row = objectValue(value, label);
  booleanValue(row.enabled, `${label}.enabled`);
  if (!whisperModels.has(row.model as WhisperModelKey)) throw new Error(`Invalid ${label}.model.`);
  stringValue(row.language, `${label}.language`);
  inferenceDevice(row.device, `${label}.device`);
}

function validateOperation(value: unknown) {
  if (value === null) return;
  const row = objectValue(value, "operation");
  if (!new Set(["analysis", "transcription", "export"]).has(String(row.kind))) throw new Error("Invalid operation.kind.");
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

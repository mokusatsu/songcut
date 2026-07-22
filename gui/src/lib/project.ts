import { assertProjectDocument } from "../../electron/project-schema";
import { WAVEFORM_BINARY_ENCODING, decodeWaveformPoints, encodeWaveformPoints } from "../../electron/waveform-codec";
import type {
  ProjectDocumentV1,
  ProjectExportCandidate,
  ProjectOpenResult,
  ProjectOperation,
  RecoverySnapshot,
  SourceIdentity,
  WhisperSettings as ProjectWhisperSettings,
} from "../../electron/project-schema";
import type { WhisperSettings } from "@/lib/api";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/exportNaming";
import type { AnalysisResult, ExportCandidate, Segment, VideoInfo, WaveformPoint } from "@/types";

export type ProjectSaveStatus = "idle" | "saving" | "saved" | "recovery-only" | "save-failed" | "read-only";

export const DEFAULT_WHISPER_SETTINGS: WhisperSettings = {
  enabled: false,
  model: "small",
  language: "ja",
  device: "auto",
};

export function createProjectDocument(
  projectPath: string,
  source: SourceIdentity,
  videoInfo: VideoInfo,
): ProjectDocumentV1 {
  const now = new Date().toISOString();
  return {
    format: "songcut-project",
    schema_version: 3,
    project_id: crypto.randomUUID(),
    revision: 0,
    created_at: now,
    updated_at: now,
    source: {
      absolute_path: source.path,
      relative_path: source.filename,
      filename: source.filename,
      size_bytes: source.size_bytes,
      mtime_ms: source.mtime_ms,
      duration_seconds: videoInfo.duration,
      fingerprint: source.fingerprint,
    },
    guide_text: "",
    settings: {
      analysis_device: "auto",
      whisper: { ...DEFAULT_WHISPER_SETTINGS },
      export: { filename_template: DEFAULT_FILENAME_TEMPLATE },
    },
    waveform_snapshot: null,
    analysis_snapshot: null,
    segments: [],
    export_candidates: [],
    view_state: { selected_segment_id: null, current_time: 0, zoom_index: 0 },
    operation: null,
  };
}

export function composeProjectDocument(
  base: ProjectDocumentV1,
  state: {
    revision: number;
    videoPath: string;
    duration: number;
    guideText: string;
    waveform: WaveformPoint[];
    analysis: AnalysisResult | null;
    segments: Segment[];
    exportCandidates: ExportCandidate[];
    analysisDevice: ProjectDocumentV1["settings"]["analysis_device"];
    whisper: WhisperSettings;
    filenameTemplate: string;
    selectedSegmentId: string | null;
    currentTime: number;
    zoomIndex: number;
    operation: ProjectOperation;
  },
): ProjectDocumentV1 {
  const segmentIds = new Set(state.segments.map((segment) => segment.id));
  const exportCandidates: ProjectExportCandidate[] = state.exportCandidates
    .map((candidate, index) => {
      const segment = state.segments[index];
      return {
        ...candidate,
        segment_id: segment?.id ?? candidate.id,
        title: segment?.title?.trim() || candidate.title,
        start: segment?.start ?? candidate.start,
        end: segment?.end ?? candidate.end,
        duration: segment ? segment.end - segment.start : candidate.duration,
        checked: segment?.checked ?? candidate.checked,
      };
    })
    .filter((candidate) => segmentIds.has(candidate.segment_id));
  const analysis = state.analysis;
  const priorWaveform = base.waveform_snapshot;
  const waveform = state.waveform;
  return {
    ...base,
    revision: state.revision,
    updated_at: new Date().toISOString(),
    source: {
      ...base.source,
      absolute_path: state.videoPath || base.source.absolute_path,
      duration_seconds: state.duration || base.source.duration_seconds,
    },
    guide_text: state.guideText,
    settings: {
      analysis_device: state.analysisDevice,
      whisper: { ...state.whisper } as ProjectWhisperSettings,
      export: { filename_template: state.filenameTemplate },
    },
    waveform_snapshot: waveform.length
      ? {
          schema_version: 2,
          generator: priorWaveform?.generator ?? "pcm-4k-mono-stream-v1",
          source_fingerprint: base.source.fingerprint.value,
          duration_seconds: state.duration || base.source.duration_seconds,
          sample_rate: priorWaveform?.sample_rate || 4000,
          channels: priorWaveform?.channels || 1,
          completed_at: priorWaveform?.completed_at ?? base.updated_at,
          encoding: WAVEFORM_BINARY_ENCODING,
          point_count: waveform.length,
          data_base64: encodeWaveformPoints(waveform)
        }
      : null,
    analysis_snapshot: analysis
      ? {
          timestamp_source: analysis.timestamp_source,
          backend: analysis.backend,
          device_requested: analysis.device_requested ?? state.analysisDevice,
          device_used: analysis.device_used,
          model_versions: analysis.model_versions ?? {},
          elapsed_seconds: analysis.elapsed_seconds ?? 0,
          frame_scores: analysis.frame_scores ?? [],
          raw_segments: analysis.raw_segments ?? [],
          boundary_refinement: analysis.boundary_refinement,
        }
      : null,
    segments: state.segments,
    export_candidates: exportCandidates,
    view_state: {
      selected_segment_id: state.selectedSegmentId,
      current_time: Math.max(0, state.currentTime),
      zoom_index: Math.max(0, Math.round(state.zoomIndex)),
    },
    operation: state.operation,
  };
}

export function analysisFromProject(document: ProjectDocumentV1): AnalysisResult | null {
  const snapshot = document.analysis_snapshot;
  if (!snapshot) return null;
  return {
    schema_version: 3,
    source_path: document.source.absolute_path,
    duration: document.source.duration_seconds,
    timestamp_source: snapshot.timestamp_source,
    device_used: snapshot.device_used,
    device_requested: snapshot.device_requested,
    backend: snapshot.backend,
    model_versions: snapshot.model_versions,
    elapsed_seconds: snapshot.elapsed_seconds,
    segments: document.segments,
    raw_segments: snapshot.raw_segments,
    boundary_refinement: snapshot.boundary_refinement as AnalysisResult["boundary_refinement"],
    export_candidates: document.export_candidates.map(stripProjectCandidate),
    waveform: [],
    frame_scores: snapshot.frame_scores,
  };
}

export function waveformFromProject(document: ProjectDocumentV1): WaveformPoint[] {
  const snapshot = document.waveform_snapshot;
  if (!snapshot) return [];
  if (snapshot.source_fingerprint !== document.source.fingerprint.value) return [];
  if (!sourceDurationMatches(snapshot.duration_seconds, document.source.duration_seconds)) return [];
  return decodeWaveformPoints(snapshot.data_base64, snapshot.point_count);
}

export function exportCandidatesFromProject(document: ProjectDocumentV1): ExportCandidate[] {
  return document.export_candidates.map(stripProjectCandidate);
}

export function filenameTemplateFromProject(document: ProjectDocumentV1) {
  return document.settings.export?.filename_template ?? DEFAULT_FILENAME_TEMPLATE;
}

export function normalizeInterruptedOperation(operation: ProjectOperation): ProjectOperation {
  return operation ? { ...operation, status: "interrupted" } : null;
}

export function parseProjectOpenResult(value: unknown): ProjectOpenResult {
  if (!value || typeof value !== "object") throw new Error("Invalid project open result.");
  const result = value as Partial<ProjectOpenResult>;
  if (typeof result.projectPath !== "string") throw new Error("Invalid project path.");
  assertProjectDocument(result.document);
  return result as ProjectOpenResult;
}

export function parseSourceIdentity(value: unknown): SourceIdentity {
  if (!value || typeof value !== "object") throw new Error("Invalid source identity.");
  const source = value as SourceIdentity;
  if (
    typeof source.path !== "string" ||
    typeof source.filename !== "string" ||
    !Number.isFinite(source.size_bytes) ||
    source.fingerprint?.algorithm !== "sha256-head-tail-1m-v1" ||
    !/^[a-f0-9]{64}$/i.test(source.fingerprint.value)
  ) {
    throw new Error("Invalid source identity.");
  }
  return source;
}

export function parseRecoverySnapshot(value: unknown): RecoverySnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid recovery snapshot.");
  const snapshot = value as RecoverySnapshot;
  if (snapshot.format !== "songcut-recovery" || snapshot.schema_version !== 1) throw new Error("Invalid recovery snapshot.");
  assertProjectDocument(snapshot.document);
  return snapshot;
}

export function transcriptSettingsAreStale(segment: Segment, settings: WhisperSettings) {
  const transcript = segment.transcript;
  if (!transcript) return false;
  const modelId = `openai/whisper-${settings.model}`;
  const modelChanged = transcript.model_key ? transcript.model_key !== settings.model : transcript.model_id !== modelId;
  const languageChanged = transcript.language_requested
    ? transcript.language_requested !== settings.language
    : settings.language !== "auto" && Boolean(transcript.language && transcript.language !== settings.language);
  return modelChanged || languageChanged;
}

function sourceDurationMatches(expected: number, actual: number) {
  return Math.abs(expected - actual) <= Math.max(0.05, expected * 0.00001);
}

function stripProjectCandidate(candidate: ProjectExportCandidate): ExportCandidate {
  const { segment_id: _segmentId, ...rest } = candidate;
  return rest;
}

export type { ProjectDocumentV1, ProjectOpenResult, ProjectOperation, RecoverySnapshot, SourceIdentity };

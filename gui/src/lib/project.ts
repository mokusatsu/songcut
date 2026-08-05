import {
  assertProjectDocument,
  isProjectOperationKindForMode,
  normalizeProjectDocument as normalizeSchemaProjectDocument,
} from "../../electron/project-schema";
import { decodeWaveformPoints } from "../../electron/waveform-codec";
import type {
  CutProjectDocumentV3,
  CutProjectOperation,
  ModeProjectDocument,
  ProjectDocumentV1,
  ProjectExportCandidate,
  ProjectOpenResult,
  ProjectOperation,
  ProjectOperationKind,
  ProjectOperationRecord,
  RecoverySnapshot,
  SourceIdentity,
  SubProjectDocumentV3,
  SubProjectOperation,
} from "../../electron/project-schema";
import type { WhisperSettings } from "@/lib/api";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/exportNaming";
import type { AnalysisResult, ExportCandidate, Segment, VideoInfo, WaveformPoint } from "@/types";
import type { AppMode } from "@/lib/modes";
import { projectOwnedSettingsFromDocument } from "@/lib/settingsScopes";
import type { ProjectOwnedSettings } from "@/lib/settingsScopes";
import {
  createDefaultSubtitleState,
  validateSubtitleState,
  type SubtitleProjectState,
} from "@/lib/subtitles";
import {
  composeCutProjectDocument,
  composeSubProjectDocument,
  type CutProjectComposeState,
  type SubProjectComposeState,
} from "@/lib/projectAdapters";
import { createBaseProjectDocument, DEFAULT_WHISPER_SETTINGS as BASE_DEFAULT_WHISPER_SETTINGS } from "@/lib/projectBase";

export type ProjectSaveStatus = "idle" | "saving" | "saved" | "recovery-only" | "save-failed" | "read-only";

export { projectOwnedSettingsFromDocument };

export const DEFAULT_WHISPER_SETTINGS: WhisperSettings = BASE_DEFAULT_WHISPER_SETTINGS;

export function createProjectDocument(
  projectPath: string,
  source: SourceIdentity,
  videoInfo: VideoInfo,
  mode: AppMode = "cut",
): ProjectDocumentV1 {
  return createBaseProjectDocument(projectPath, source, videoInfo, mode);
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
    mode?: AppMode;
    subtitle?: SubtitleProjectState;
    /** Typed boundary for values serialized under schema-v3 `settings`/`subtitle`. */
    projectSettings?: ProjectOwnedSettings;
  },
): ProjectDocumentV1 {
  const projectSettings: ProjectOwnedSettings = state.projectSettings ?? {
    analysisDevice: state.analysisDevice,
    whisper: state.whisper,
    filenameTemplate: state.filenameTemplate,
    subtitle: state.subtitle,
  };
  const baseState = {
    revision: state.revision,
    videoPath: state.videoPath,
    duration: state.duration,
    waveform: state.waveform,
    analysisDevice: projectSettings.analysisDevice,
    whisper: projectSettings.whisper,
    filenameTemplate: projectSettings.filenameTemplate,
    currentTime: state.currentTime,
    zoomIndex: state.zoomIndex,
  };
  const mode = state.mode ?? base.mode ?? "cut";
  if (mode === "sub") {
    return composeSubProjectDocument(base, {
      ...baseState,
      subtitle: projectSettings.subtitle ?? subtitleStateFromProject(base),
      operation: state.operation as SubProjectComposeState["operation"],
    } satisfies SubProjectComposeState);
  }
  return composeCutProjectDocument(base, {
    ...baseState,
    selectedSegmentId: state.selectedSegmentId,
    guideText: state.guideText,
    analysis: state.analysis,
    segments: state.segments,
    exportCandidates: state.exportCandidates,
    operation: state.operation as CutProjectComposeState["operation"],
  } satisfies CutProjectComposeState);
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

export function projectMode(document: ProjectDocumentV1): AppMode {
  return document.mode === "sub" ? "sub" : "cut";
}

/**
 * Narrow a validated document to the mode-discriminated internal view. The
 * legacy v3 Cut shape (omitted `mode`) is normalized on a shallow copy by the
 * schema boundary helper; all persisted fields remain untouched.
 */
export function normalizeProjectDocument(document: unknown): ModeProjectDocument {
  return normalizeSchemaProjectDocument(document);
}

export function isProjectOperationCompatible(
  mode: AppMode,
  operation: ProjectOperation,
): boolean {
  return operation === null || isProjectOperationKindForMode(mode, operation.kind);
}

export function subtitleStateFromProject(document: ProjectDocumentV1): SubtitleProjectState {
  return validateSubtitleState(document.subtitle) ?? createDefaultSubtitleState();
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

export type {
  CutProjectDocumentV3,
  CutProjectOperation,
  ModeProjectDocument,
  ProjectDocumentV1,
  ProjectOpenResult,
  ProjectOperation,
  ProjectOperationKind,
  ProjectOperationRecord,
  RecoverySnapshot,
  SourceIdentity,
  SubProjectDocumentV3,
  SubProjectOperation,
};

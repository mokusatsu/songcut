import {
  assertProjectDocument,
  isProjectOperationKindForMode,
  normalizeProjectDocument,
  type CutProjectDocumentV3,
  type CutProjectOperation,
  type ModeProjectDocument,
  type ProjectDocumentV1,
  type ProjectExportCandidate,
  type ProjectOperation,
  type SubProjectDocumentV3,
  type SubProjectOperation,
} from "../../electron/project-schema";
import type { WhisperSettings } from "@/lib/api";
import type { AnalysisResult, ExportCandidate, Segment, VideoInfo } from "@/types";
import {
  cloneValue,
  createBaseProjectDocument,
  hydrateProjectBase,
  serializeProjectBase,
  type ProjectBaseComposeState,
  type ProjectBaseHydratedState,
} from "@/lib/projectBase";
import {
  createDefaultSubtitleState,
  validateSubtitleState,
  type SubtitleProjectState,
} from "@/lib/subtitles";

import type { SourceIdentity } from "../../electron/project-schema";

export type { ProjectBaseComposeState, ProjectBaseHydratedState } from "@/lib/projectBase";

/** Cut-only payload accepted by the Cut project adapter. */
export type CutProjectComposeState = ProjectBaseComposeState & {
  selectedSegmentId: string | null;
  guideText: string;
  analysis: AnalysisResult | null;
  segments: Segment[];
  exportCandidates: ExportCandidate[];
  operation: CutProjectOperation;
};

/** Sub-only payload accepted by the Sub project adapter. */
export type SubProjectComposeState = ProjectBaseComposeState & {
  subtitle: SubtitleProjectState;
  operation: SubProjectOperation;
};

export type CutProjectHydratedState = ProjectBaseHydratedState & {
  mode: "cut";
  selectedSegmentId: string | null;
  guideText: string;
  analysis: AnalysisResult | null;
  segments: Segment[];
  exportCandidates: ExportCandidate[];
  operation: CutProjectOperation;
};

export type SubProjectHydratedState = ProjectBaseHydratedState & {
  mode: "sub";
  subtitle: SubtitleProjectState;
  operation: SubProjectOperation;
};

export type ProjectHydratedState = CutProjectHydratedState | SubProjectHydratedState;

/** Create a new Cut sidecar using only the common base creator. */
/** `createCutProjectDocument`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function createCutProjectDocument(
  projectPath: string,
  source: SourceIdentity,
  videoInfo: VideoInfo,
): CutProjectDocumentV3 {
  return createBaseProjectDocument(projectPath, source, videoInfo, "cut") as CutProjectDocumentV3;
}

/** Create a new Sub sidecar using only the common base creator. */
/** `createSubProjectDocument`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function createSubProjectDocument(
  projectPath: string,
  source: SourceIdentity,
  videoInfo: VideoInfo,
): SubProjectDocumentV3 {
  return createBaseProjectDocument(projectPath, source, videoInfo, "sub") as SubProjectDocumentV3;
}

/** `isCutProjectOperation`の入力が要求された条件やschemaを満たすか検証する。 */
export function isCutProjectOperation(operation: ProjectOperation): operation is CutProjectOperation {
  return operation === null || isProjectOperationKindForMode("cut", operation.kind);
}

/** `isSubProjectOperation`の入力が要求された条件やschemaを満たすか検証する。 */
export function isSubProjectOperation(operation: ProjectOperation): operation is SubProjectOperation {
  return operation === null || isProjectOperationKindForMode("sub", operation.kind);
}

/** `assertCutProjectOperation`の入力が要求された条件やschemaを満たすか検証する。 */
export function assertCutProjectOperation(operation: ProjectOperation): asserts operation is CutProjectOperation {
  assertOperationForMode("cut", operation);
}

/** `assertSubProjectOperation`の入力が要求された条件やschemaを満たすか検証する。 */
export function assertSubProjectOperation(operation: ProjectOperation): asserts operation is SubProjectOperation {
  assertOperationForMode("sub", operation);
}

/**
 * Compose a Cut document from the common envelope and Cut-owned state.
 * Legacy v3 Cut documents may omit `mode`; the base serializer preserves that
 * omission while still treating the document as Cut internally.
 */
/** `composeCutProjectDocument`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function composeCutProjectDocument(
  base: ProjectDocumentV1,
  state: CutProjectComposeState,
): CutProjectDocumentV3 {
  assertBaseMode(base, "cut");
  if (hasOwn(state, "subtitle")) {
    throw new Error("Cut adapter received Sub-only subtitle state.");
  }
  assertOperationForMode("cut", state.operation);
  const common = serializeProjectBase(base, state, "cut", state.selectedSegmentId);
  const segments = cloneValue(state.segments);
  const segmentIds = new Set(segments.map((segment) => segment.id));
  const exportCandidates: ProjectExportCandidate[] = state.exportCandidates
    .map((candidate, index) => {
      const segment = segments[index];
      return {
        ...cloneValue(candidate),
        segment_id: segment?.id ?? candidate.id,
        title: segment?.title?.trim() || candidate.title,
        start: segment?.start ?? candidate.start,
        end: segment?.end ?? candidate.end,
        duration: segment ? segment.end - segment.start : candidate.duration,
        checked: segment?.checked ?? candidate.checked,
      };
    })
    .filter((candidate) => segmentIds.has(candidate.segment_id));

  const next: ProjectDocumentV1 = {
    ...common,
    guide_text: state.guideText,
    analysis_snapshot: state.analysis
      ? {
          timestamp_source: state.analysis.timestamp_source,
          backend: state.analysis.backend,
          device_requested: state.analysis.device_requested ?? state.analysisDevice,
          device_used: state.analysis.device_used,
          model_versions: cloneValue(state.analysis.model_versions ?? {}),
          elapsed_seconds: state.analysis.elapsed_seconds ?? 0,
          frame_scores: cloneValue(state.analysis.frame_scores ?? []),
          raw_segments: cloneValue(state.analysis.raw_segments ?? []),
          boundary_refinement: cloneValue(state.analysis.boundary_refinement),
        }
      : null,
    segments,
    export_candidates: exportCandidates,
    operation: cloneValue(state.operation),
  };
  // A Sub-only field must never leak into a Cut sidecar, including when a
  // caller supplies a stale in-memory base object.
  delete next.subtitle;
  return next as CutProjectDocumentV3;
}

/** Compose a Sub document without requiring any Cut analysis fields. */
/** `composeSubProjectDocument`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function composeSubProjectDocument(
  base: ProjectDocumentV1,
  state: SubProjectComposeState,
): SubProjectDocumentV3 {
  assertBaseMode(base, "sub");
  if (hasOwn(state, "guideText") || hasOwn(state, "analysis") || hasOwn(state, "segments") || hasOwn(state, "exportCandidates")) {
    throw new Error("Sub adapter received Cut-only project state.");
  }
  assertOperationForMode("sub", state.operation);
  if (!validateSubtitleState(state.subtitle)) throw new Error("Invalid Sub subtitle state.");
  const common = serializeProjectBase(base, state, "sub", null);
  const next: ProjectDocumentV1 = {
    ...common,
    analysis_snapshot: null,
    segments: [],
    export_candidates: [],
    operation: cloneValue(state.operation),
    subtitle: cloneValue(state.subtitle),
  };
  next.mode = "sub";
  return next as SubProjectDocumentV3;
}

/** Hydrate the common envelope and Cut-owned state from a validated document. */
/** `hydrateCutProjectDocument`の外部表現を検証し、アプリ内部で扱う状態へ復元する。 */
export function hydrateCutProjectDocument(value: unknown): CutProjectHydratedState {
  const document = modeDocument(value, "cut");
  const common = hydrateProjectBase(document);
  const snapshot = document.analysis_snapshot;
  const analysis: AnalysisResult | null = snapshot
    ? {
        schema_version: 3,
        source_path: document.source.absolute_path,
        duration: document.source.duration_seconds,
        timestamp_source: snapshot.timestamp_source,
        device_used: snapshot.device_used,
        device_requested: snapshot.device_requested,
        backend: snapshot.backend,
        model_versions: cloneValue(snapshot.model_versions),
        elapsed_seconds: snapshot.elapsed_seconds,
        segments: cloneValue(document.segments),
        raw_segments: cloneValue(snapshot.raw_segments),
        boundary_refinement: cloneValue(snapshot.boundary_refinement) as AnalysisResult["boundary_refinement"],
        export_candidates: document.export_candidates.map(stripProjectCandidate),
        waveform: [],
        frame_scores: cloneValue(snapshot.frame_scores),
      }
    : null;
  return {
    ...common,
    mode: "cut",
    selectedSegmentId: document.view_state.selected_segment_id,
    guideText: document.guide_text,
    analysis,
    segments: cloneValue(document.segments),
    exportCandidates: document.export_candidates.map(stripProjectCandidate),
    operation: cloneValue(document.operation) as CutProjectOperation,
  };
}

/** Hydrate the common envelope and Sub-owned state without exposing Cut data. */
/** `hydrateSubProjectDocument`の外部表現を検証し、アプリ内部で扱う状態へ復元する。 */
export function hydrateSubProjectDocument(value: unknown): SubProjectHydratedState {
  const document = modeDocument(value, "sub");
  const subtitle = validateSubtitleState(document.subtitle) ?? createDefaultSubtitleState();
  return {
    ...hydrateProjectBase(document),
    mode: "sub",
    subtitle: cloneValue(subtitle),
    operation: cloneValue(document.operation) as SubProjectOperation,
  };
}

/** Hydrate either mode through its mode-discriminated adapter. */
/** `hydrateProjectDocument`の外部表現を検証し、アプリ内部で扱う状態へ復元する。 */
export function hydrateProjectDocument(value: unknown): ProjectHydratedState {
  const normalized = normalizeProjectDocument(value);
  return normalized.mode === "sub"
    ? hydrateSubProjectDocument(normalized)
    : hydrateCutProjectDocument(normalized);
}

function modeDocument(value: unknown, expectedMode: "cut" | "sub"): ModeProjectDocument {
  assertProjectDocument(value);
  const normalized = normalizeProjectDocument(value);
  if (normalized.mode !== expectedMode) {
    throw new Error(`Project mode ${JSON.stringify(normalized.mode)} cannot be used as ${expectedMode}.`);
  }
  return normalized;
}

function assertBaseMode(base: ProjectDocumentV1, expectedMode: "cut" | "sub") {
  assertProjectDocument(base);
  const mode = normalizeProjectDocument(base).mode;
  if (mode !== expectedMode) {
    throw new Error(`Project mode ${JSON.stringify(mode)} cannot be composed as ${expectedMode}.`);
  }
}

function assertOperationForMode(mode: "cut" | "sub", operation: ProjectOperation) {
  if (operation && !isProjectOperationKindForMode(mode, operation.kind)) {
    throw new Error(`Operation kind ${JSON.stringify(operation.kind)} is incompatible with ${mode} project.`);
  }
}

function stripProjectCandidate(candidate: ProjectExportCandidate): ExportCandidate {
  const { segment_id: _segmentId, ...rest } = candidate;
  return cloneValue(rest);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export type { WhisperSettings };

import {
  type ProjectDocumentV1,
  type SourceIdentity,
  type WhisperSettings as ProjectWhisperSettings,
} from "../../electron/project-schema";
import { WAVEFORM_BINARY_ENCODING, decodeWaveformPoints, encodeWaveformPoints } from "../../electron/waveform-codec";
import type { WhisperSettings } from "@/lib/api";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/exportNaming";
import type { AppMode } from "@/lib/modes";
import type { VideoInfo, WaveformPoint } from "@/types";
import type { ProjectOwnedSettings } from "@/lib/settingsScopes";
import { createDefaultSubtitleState } from "@/lib/subtitles";

export const DEFAULT_WHISPER_SETTINGS: WhisperSettings = {
  enabled: false,
  model: "whisper-large-v3-turbo-int8-ov",
  language: "ja",
  device: "auto",
  demucsDevice: "auto",
  mmsDevice: "auto",
  lyricsAlignmentAlgorithm: "songcut-standard",
};

/**
 * Values shared by both mode serializers.  Mode payloads deliberately do not
 * appear here: Cut analysis fields and Sub subtitle fields are supplied by
 * their respective adapters.
 */
export type ProjectBaseComposeState = {
  revision: number;
  videoPath: string;
  duration: number;
  waveform: WaveformPoint[];
  analysisDevice: ProjectDocumentV1["settings"]["analysis_device"];
  whisper: WhisperSettings;
  filenameTemplate: string;
  currentTime: number;
  zoomIndex: number;
};

export type ProjectBaseHydratedState = {
  mode: AppMode;
  revision: number;
  videoPath: string;
  duration: number;
  waveform: WaveformPoint[];
  projectSettings: Pick<ProjectOwnedSettings, "analysisDevice" | "whisper" | "filenameTemplate">;
  currentTime: number;
  zoomIndex: number;
};

/** Create a fresh schema-v3 envelope for either mode. */
export function createBaseProjectDocument(
  projectPath: string,
  source: SourceIdentity,
  videoInfo: VideoInfo,
  mode: AppMode = "cut",
): ProjectDocumentV1 {
  const now = new Date().toISOString();
  return {
    format: "songcut-project",
    schema_version: 3,
    project_id: crypto.randomUUID(),
    revision: 0,
    created_at: now,
    updated_at: now,
    mode,
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
    subtitle: mode === "sub" ? createDefaultSubtitleState() : undefined,
  };
}

/**
 * Serialize the schema-v3 envelope shared by Cut and Sub.
 *
 * The mode argument is semantic, while the historical Cut representation may
 * omit `mode`.  Preserve that omission when composing a legacy Cut sidecar so
 * a save does not introduce an unrelated JSON field.
 */
export function serializeProjectBase(
  base: ProjectDocumentV1,
  state: ProjectBaseComposeState,
  mode: AppMode,
  selectedSegmentId: string | null,
): ProjectDocumentV1 {
  const sourceDuration = state.duration || base.source.duration_seconds;
  const priorExport = base.settings.export;
  const settings: ProjectDocumentV1["settings"] = {
    analysis_device: state.analysisDevice,
    whisper: cloneValue({ ...state.whisper }) as ProjectWhisperSettings,
  };
  // Keep an omitted legacy export settings object omitted unless a non-default
  // template is being written. Existing v3 sidecars therefore avoid a noisy
  // field-only diff on their next save.
  if (priorExport || state.filenameTemplate !== DEFAULT_FILENAME_TEMPLATE) {
    settings.export = { filename_template: state.filenameTemplate };
  }

  const result: ProjectDocumentV1 = {
    ...cloneValue(base),
    revision: state.revision,
    updated_at: new Date().toISOString(),
    source: {
      ...cloneValue(base.source),
      absolute_path: state.videoPath || base.source.absolute_path,
      duration_seconds: sourceDuration,
    },
    settings,
    waveform_snapshot: state.waveform.length
      ? {
          schema_version: 2,
          generator: base.waveform_snapshot?.generator ?? "pcm-4k-mono-stream-v1",
          source_fingerprint: base.source.fingerprint.value,
          duration_seconds: sourceDuration,
          sample_rate: base.waveform_snapshot?.sample_rate || 4000,
          channels: base.waveform_snapshot?.channels || 1,
          completed_at: base.waveform_snapshot?.completed_at ?? base.updated_at,
          encoding: WAVEFORM_BINARY_ENCODING,
          point_count: state.waveform.length,
          data_base64: encodeWaveformPoints(state.waveform),
        }
      : null,
    view_state: {
      selected_segment_id: selectedSegmentId,
      current_time: Math.max(0, state.currentTime),
      zoom_index: Math.max(0, Math.round(state.zoomIndex)),
    },
  };

  if (mode === "sub") {
    result.mode = "sub";
  } else if (base.mode === "cut") {
    result.mode = "cut";
  } else if (base.mode === undefined) {
    delete result.mode;
  }
  return result;
}

/** Hydrate only the fields owned by the common project session. */
export function hydrateProjectBase(document: ProjectDocumentV1): ProjectBaseHydratedState {
  const mode: AppMode = document.mode === "sub" ? "sub" : "cut";
  const snapshot = document.waveform_snapshot;
  const waveform = snapshot && snapshot.source_fingerprint === document.source.fingerprint.value
    && sourceDurationMatches(snapshot.duration_seconds, document.source.duration_seconds)
    ? decodeWaveformPoints(snapshot.data_base64, snapshot.point_count)
    : [];
  return {
    mode,
    revision: document.revision,
    videoPath: document.source.absolute_path,
    duration: document.source.duration_seconds,
    waveform,
    projectSettings: {
      analysisDevice: document.settings.analysis_device,
      whisper: cloneValue(document.settings.whisper) as WhisperSettings,
      filenameTemplate: document.settings.export?.filename_template ?? DEFAULT_FILENAME_TEMPLATE,
    },
    currentTime: document.view_state.current_time,
    zoomIndex: document.view_state.zoom_index,
  };
}

function sourceDurationMatches(expected: number, actual: number) {
  return Math.abs(expected - actual) <= Math.max(0.05, expected * 0.00001);
}

/** Clone persisted values before returning them to mutable React state. */
export function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export type { SourceIdentity };

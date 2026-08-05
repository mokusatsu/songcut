import { clamp } from "@/lib/time";
import { normalizeScratchAudioProxyEnabled } from "@/lib/scratchProxy";
import {
  BOUNDARY_REFINEMENT_STORAGE_KEY,
  DEFAULT_BOUNDARY_REFINEMENT_SETTINGS,
  normalizeBoundaryRefinementSettings,
  type BoundaryRefinementSettings,
} from "@/lib/boundaryRefinement";
import {
  CUT_WAVEFORM_AMPLITUDE_PROFILE_STORAGE_KEY,
  DEFAULT_CUT_WAVEFORM_AMPLITUDE_PROFILE,
  DEFAULT_WAVEFORM_DISPLAY_MODES,
  LEGACY_WAVEFORM_DISPLAY_MODE_STORAGE_KEY,
  WAVEFORM_DISPLAY_MODE_STORAGE_KEYS,
  readCutWaveformAmplitudeProfile,
  readWaveformDisplayModes,
  type WaveformDisplayModes,
} from "@/lib/waveformPreferences";
import { readSubtitleStylePresets, SUBTITLE_STYLE_PRESETS_STORAGE_KEY } from "@/lib/subtitleStylePresets";
import type { SubtitleStylePreset } from "@/lib/subtitleStylePresets";
import { DEFAULT_FILENAME_TEMPLATE } from "@/lib/exportNaming";
import type { AppMode } from "@/lib/modes";
import type { WhisperSettings } from "@/lib/api";
import type { WaveformDisplayMode } from "@/types";
import type { ProjectDocumentV1 } from "../../electron/project-schema";
import { validateSubtitleState, type SubtitleProjectState } from "@/lib/subtitles";

/** The persistence owner of a setting. */
export type SettingsScope = "app" | "mode" | "project";

/** The renderer storage contract used by all typed preference helpers. */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type AppCommonPreferences = {
  scratchPreviewMilliseconds: number;
  scratchAudioProxyEnabled: boolean;
  boundaryPreviewSeconds: string;
  videoSplitPercent: number;
};

export type CutModePreferences = {
  waveformDisplayMode: WaveformDisplayMode;
  cutWaveformAmplitudeProfile: "adaptive" | "singing-mc-contrast";
  boundaryNudgeSeconds: string;
  boundaryRefinementSettings: BoundaryRefinementSettings;
  createSourceFolder: boolean;
};

export type SubModePreferences = {
  waveformDisplayMode: WaveformDisplayMode;
  subtitleStylePresets?: SubtitleStylePreset[];
};

export type ModePreferences = {
  cut: CutModePreferences;
  sub: SubModePreferences;
};

/** Project values are serialized in schema v3; they never use localStorage. */
export type ProjectOwnedSettings = {
  analysisDevice: ProjectDocumentV1["settings"]["analysis_device"];
  whisper: WhisperSettings;
  filenameTemplate: string;
  subtitle?: SubtitleProjectState;
};

export const SCRATCH_PREVIEW_STORAGE_KEY = "songcut:scratch-preview-milliseconds" as const;
export const SCRATCH_AUDIO_PROXY_ENABLED_STORAGE_KEY = "songcut:scratch-audio-proxy-enabled" as const;
export const BOUNDARY_SECONDS_STORAGE_KEY = "songcut:boundary-preview-seconds" as const;
export const BOUNDARY_NUDGE_SECONDS_STORAGE_KEY = "songcut:boundary-nudge-seconds" as const;
export const VIDEO_SPLIT_STORAGE_KEY = "songcut:video-split-percent" as const;
export const CREATE_SOURCE_FOLDER_STORAGE_KEY = "songcut:create-source-folder" as const;

export const DEFAULT_SCRATCH_PREVIEW_MILLISECONDS = 100;
export const MIN_SCRATCH_PREVIEW_MILLISECONDS = 1;
export const MAX_SCRATCH_PREVIEW_MILLISECONDS = 5000;
export const DEFAULT_BOUNDARY_SECONDS = 5;
export const DEFAULT_BOUNDARY_NUDGE_SECONDS = 0.5;
export const DEFAULT_VIDEO_SPLIT_PERCENT = 35;
export const MIN_VIDEO_SPLIT_PERCENT = 32;
export const MAX_VIDEO_SPLIT_PERCENT = 72;
const MIN_BOUNDARY_NUDGE_SECONDS = 0.1;
const MAX_BOUNDARY_NUDGE_SECONDS = 60;

/**
 * One machine-readable scope matrix for the settings UI and persistence
 * contract. Existing localStorage keys are deliberately kept byte-for-byte.
 */
export const SETTINGS_OWNERSHIP = {
  scratchPreviewMilliseconds: { scope: "app", storage: "localStorage", key: SCRATCH_PREVIEW_STORAGE_KEY },
  scratchAudioProxyEnabled: { scope: "app", storage: "localStorage", key: SCRATCH_AUDIO_PROXY_ENABLED_STORAGE_KEY },
  boundaryPreviewSeconds: { scope: "app", storage: "localStorage", key: BOUNDARY_SECONDS_STORAGE_KEY },
  videoSplitPercent: { scope: "app", storage: "localStorage", key: VIDEO_SPLIT_STORAGE_KEY },
  createSourceFolder: { scope: "mode", mode: "cut", storage: "localStorage", key: CREATE_SOURCE_FOLDER_STORAGE_KEY },
  localePreference: { scope: "app", storage: "native" },
  boundaryNudgeSeconds: { scope: "mode", mode: "cut", storage: "localStorage", key: BOUNDARY_NUDGE_SECONDS_STORAGE_KEY },
  boundaryRefinementSettings: { scope: "mode", mode: "cut", storage: "localStorage", key: BOUNDARY_REFINEMENT_STORAGE_KEY },
  cutWaveformAmplitudeProfile: { scope: "mode", mode: "cut", storage: "localStorage", key: CUT_WAVEFORM_AMPLITUDE_PROFILE_STORAGE_KEY },
  waveformDisplayModeCut: { scope: "mode", mode: "cut", storage: "localStorage", key: WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.cut },
  waveformDisplayModeSub: { scope: "mode", mode: "sub", storage: "localStorage", key: WAVEFORM_DISPLAY_MODE_STORAGE_KEYS.sub },
  waveformDisplayModeLegacy: { scope: "mode", storage: "localStorage", key: LEGACY_WAVEFORM_DISPLAY_MODE_STORAGE_KEY, fallbackFor: "cut" },
  subtitleStylePresets: { scope: "mode", mode: "sub", storage: "localStorage", key: SUBTITLE_STYLE_PRESETS_STORAGE_KEY },
  analysisDevice: { scope: "project", storage: "project", field: "settings.analysis_device" },
  whisperSettings: { scope: "project", storage: "project", field: "settings.whisper" },
  filenameTemplate: { scope: "project", storage: "project", field: "settings.export.filename_template" },
  subtitleState: { scope: "project", storage: "project", field: "subtitle" },
} as const;

export type SettingName = keyof typeof SETTINGS_OWNERSHIP;

export type TypedSetting<T> = {
  key: string;
  defaultValue: T;
  parse: (raw: string | null) => T;
  serialize: (value: T) => string;
};

export function readTypedSetting<T>(storage: StorageLike, definition: TypedSetting<T>): T {
  try {
    return definition.parse(storage.getItem(definition.key));
  } catch {
    return definition.defaultValue;
  }
}

export function writeTypedSetting<T>(storage: StorageLike, definition: TypedSetting<T>, value: T): boolean {
  try {
    storage.setItem(definition.key, definition.serialize(value));
    return true;
  } catch {
    return false;
  }
}

export function normalizeScratchPreviewMilliseconds(value: unknown, fallback = DEFAULT_SCRATCH_PREVIEW_MILLISECONDS) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clamp(Math.round(parsed), MIN_SCRATCH_PREVIEW_MILLISECONDS, MAX_SCRATCH_PREVIEW_MILLISECONDS)
    : fallback;
}

export function parseBoundarySeconds(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(Math.round(parsed), 1, 60) : DEFAULT_BOUNDARY_SECONDS;
}

export function formatBoundarySeconds(value: number) {
  return String(Math.round(value));
}

export function normalizeBoundarySecondsInput(value: string) {
  if (value.trim() === "") return "";
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return formatBoundarySeconds(parseBoundarySeconds(value));
  const digits = value.replace(/\D/g, "");
  return digits ? formatBoundarySeconds(parseBoundarySeconds(digits)) : "";
}

export function parseBoundaryNudgeSeconds(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clamp(Math.round(parsed * 10) / 10, MIN_BOUNDARY_NUDGE_SECONDS, MAX_BOUNDARY_NUDGE_SECONDS)
    : DEFAULT_BOUNDARY_NUDGE_SECONDS;
}

export function formatBoundaryNudgeSeconds(value: number) {
  return parseBoundaryNudgeSeconds(String(value)).toFixed(1);
}

export function normalizeVideoSplitPercent(value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return DEFAULT_VIDEO_SPLIT_PERCENT;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clamp(parsed, MIN_VIDEO_SPLIT_PERCENT, MAX_VIDEO_SPLIT_PERCENT)
    : DEFAULT_VIDEO_SPLIT_PERCENT;
}

const scratchPreviewSetting: TypedSetting<number> = {
  key: SCRATCH_PREVIEW_STORAGE_KEY,
  defaultValue: DEFAULT_SCRATCH_PREVIEW_MILLISECONDS,
  parse: (raw) => normalizeScratchPreviewMilliseconds(raw),
  serialize: (value) => String(normalizeScratchPreviewMilliseconds(value)),
};

const scratchAudioProxySetting: TypedSetting<boolean> = {
  key: SCRATCH_AUDIO_PROXY_ENABLED_STORAGE_KEY,
  defaultValue: true,
  parse: (raw) => normalizeScratchAudioProxyEnabled(raw),
  serialize: (value) => String(Boolean(value)),
};

const boundarySecondsSetting: TypedSetting<string> = {
  key: BOUNDARY_SECONDS_STORAGE_KEY,
  defaultValue: formatBoundarySeconds(DEFAULT_BOUNDARY_SECONDS),
  parse: (raw) => raw?.trim() ? formatBoundarySeconds(parseBoundarySeconds(raw)) : formatBoundarySeconds(DEFAULT_BOUNDARY_SECONDS),
  serialize: (value) => formatBoundarySeconds(parseBoundarySeconds(value)),
};

const boundaryNudgeSecondsSetting: TypedSetting<string> = {
  key: BOUNDARY_NUDGE_SECONDS_STORAGE_KEY,
  defaultValue: formatBoundaryNudgeSeconds(DEFAULT_BOUNDARY_NUDGE_SECONDS),
  parse: (raw) => raw?.trim() ? formatBoundaryNudgeSeconds(parseBoundaryNudgeSeconds(raw)) : formatBoundaryNudgeSeconds(DEFAULT_BOUNDARY_NUDGE_SECONDS),
  serialize: (value) => formatBoundaryNudgeSeconds(parseBoundaryNudgeSeconds(value)),
};

const videoSplitPercentSetting: TypedSetting<number> = {
  key: VIDEO_SPLIT_STORAGE_KEY,
  defaultValue: DEFAULT_VIDEO_SPLIT_PERCENT,
  parse: (raw) => normalizeVideoSplitPercent(raw),
  serialize: (value) => String(normalizeVideoSplitPercent(value)),
};

const createSourceFolderSetting: TypedSetting<boolean> = {
  key: CREATE_SOURCE_FOLDER_STORAGE_KEY,
  defaultValue: false,
  parse: (raw) => raw === "true",
  serialize: (value) => String(Boolean(value)),
};

export function readScratchPreviewMilliseconds(storage: StorageLike): number {
  return readTypedSetting(storage, scratchPreviewSetting);
}

export function writeScratchPreviewMilliseconds(storage: StorageLike, value: number): boolean {
  return writeTypedSetting(storage, scratchPreviewSetting, value);
}

export function readScratchAudioProxyEnabled(storage: StorageLike): boolean {
  return readTypedSetting(storage, scratchAudioProxySetting);
}

export function writeScratchAudioProxyEnabled(storage: StorageLike, value: boolean): boolean {
  return writeTypedSetting(storage, scratchAudioProxySetting, value);
}

export function readBoundarySecondsInput(storage: StorageLike): string {
  return readTypedSetting(storage, boundarySecondsSetting);
}

export function writeBoundarySecondsInput(storage: StorageLike, value: string): boolean {
  return writeTypedSetting(storage, boundarySecondsSetting, value);
}

export function readBoundaryNudgeSecondsInput(storage: StorageLike): string {
  return readTypedSetting(storage, boundaryNudgeSecondsSetting);
}

export function writeBoundaryNudgeSecondsInput(storage: StorageLike, value: string): boolean {
  return writeTypedSetting(storage, boundaryNudgeSecondsSetting, value);
}

export function readVideoSplitPercent(storage: StorageLike): number {
  return readTypedSetting(storage, videoSplitPercentSetting);
}

export function writeVideoSplitPercent(storage: StorageLike, value: number): boolean {
  return writeTypedSetting(storage, videoSplitPercentSetting, value);
}

export function readCreateSourceFolder(storage: StorageLike): boolean {
  return readTypedSetting(storage, createSourceFolderSetting);
}

export function writeCreateSourceFolder(storage: StorageLike, value: boolean): boolean {
  return writeTypedSetting(storage, createSourceFolderSetting, value);
}

export function readAppCommonPreferences(storage: StorageLike): AppCommonPreferences {
  return {
    scratchPreviewMilliseconds: readScratchPreviewMilliseconds(storage),
    scratchAudioProxyEnabled: readScratchAudioProxyEnabled(storage),
    boundaryPreviewSeconds: readBoundarySecondsInput(storage),
    videoSplitPercent: readVideoSplitPercent(storage),
  };
}

export function writeAppCommonPreferences(storage: StorageLike, preferences: AppCommonPreferences): boolean {
  return [
    writeScratchPreviewMilliseconds(storage, preferences.scratchPreviewMilliseconds),
    writeScratchAudioProxyEnabled(storage, preferences.scratchAudioProxyEnabled),
    writeBoundarySecondsInput(storage, preferences.boundaryPreviewSeconds),
    writeVideoSplitPercent(storage, preferences.videoSplitPercent),
  ].every(Boolean);
}

export function readWaveformDisplayMode(storage: StorageLike, mode: AppMode): WaveformDisplayMode {
  try {
    return readWaveformDisplayModes(storage)[mode];
  } catch {
    return DEFAULT_WAVEFORM_DISPLAY_MODES[mode];
  }
}

export function writeWaveformDisplayMode(storage: StorageLike, mode: AppMode, value: WaveformDisplayMode): boolean {
  return writeTypedSetting(storage, {
    key: WAVEFORM_DISPLAY_MODE_STORAGE_KEYS[mode],
    defaultValue: mode === "cut" ? "rms" : "symmetric-peak",
    parse: (raw) => raw === "peak" || raw === "peak-rms" || raw === "symmetric-peak" ? raw : "rms",
    serialize: (next) => next,
  }, value);
}

export function readModePreferences(storage: StorageLike): ModePreferences {
  return {
    cut: readCutModePreferences(storage),
    sub: readSubModePreferences(storage),
  };
}

export function readCutModePreferences(storage: StorageLike): CutModePreferences {
  let cutWaveformAmplitudeProfile: CutModePreferences["cutWaveformAmplitudeProfile"] = DEFAULT_CUT_WAVEFORM_AMPLITUDE_PROFILE;
  try {
    cutWaveformAmplitudeProfile = readCutWaveformAmplitudeProfile(storage);
  } catch {
    // Keep the legacy default when persistent storage is unavailable.
  }
  let waveformDisplayMode = DEFAULT_WAVEFORM_DISPLAY_MODES.cut;
  try {
    waveformDisplayMode = readWaveformDisplayModes(storage).cut;
  } catch {
    // Keep independent Cut/Sub defaults when persistent storage is unavailable.
  }
  return {
    waveformDisplayMode,
    cutWaveformAmplitudeProfile,
    boundaryNudgeSeconds: readBoundaryNudgeSecondsInput(storage),
    boundaryRefinementSettings: readBoundaryRefinementForStorage(storage),
    createSourceFolder: readCreateSourceFolder(storage),
  };
}

export function readSubModePreferences(storage: StorageLike): SubModePreferences {
  let waveformDisplayMode = DEFAULT_WAVEFORM_DISPLAY_MODES.sub;
  try {
    waveformDisplayMode = readWaveformDisplayModes(storage).sub;
  } catch {
    // Keep independent Cut/Sub defaults when persistent storage is unavailable.
  }
  let subtitleStylePresets: SubtitleStylePreset[] = [];
  try {
    subtitleStylePresets = readSubtitleStylePresets(storage);
  } catch {
    // Keep the empty preset list when persistent storage is unavailable.
  }
  return { waveformDisplayMode, subtitleStylePresets };
}

export function projectOwnedSettingsFromDocument(document: ProjectDocumentV1): ProjectOwnedSettings {
  return {
    analysisDevice: document.settings.analysis_device,
    whisper: { ...document.settings.whisper } as WhisperSettings,
    filenameTemplate: document.settings.export?.filename_template ?? DEFAULT_FILENAME_TEMPLATE,
    subtitle: validateSubtitleState(document.subtitle) ?? undefined,
  };
}

function readBoundaryRefinementForStorage(storage: StorageLike): BoundaryRefinementSettings {
  try {
    const raw = storage.getItem(BOUNDARY_REFINEMENT_STORAGE_KEY);
    return raw ? normalizeBoundaryRefinementSettings(JSON.parse(raw)) : { ...DEFAULT_BOUNDARY_REFINEMENT_SETTINGS };
  } catch {
    return { ...DEFAULT_BOUNDARY_REFINEMENT_SETTINGS };
  }
}

export function boundaryRefinementDefaults(): BoundaryRefinementSettings {
  return { ...DEFAULT_BOUNDARY_REFINEMENT_SETTINGS };
}

export { normalizeBoundaryRefinementSettings };
export type { BoundaryRefinementSettings, WaveformDisplayModes };

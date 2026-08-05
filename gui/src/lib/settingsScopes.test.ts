import { describe, expect, it } from "vitest";
import {
  BOUNDARY_NUDGE_SECONDS_STORAGE_KEY,
  BOUNDARY_SECONDS_STORAGE_KEY,
  CREATE_SOURCE_FOLDER_STORAGE_KEY,
  SCRATCH_AUDIO_PROXY_ENABLED_STORAGE_KEY,
  SCRATCH_PREVIEW_STORAGE_KEY,
  SETTINGS_OWNERSHIP,
  VIDEO_SPLIT_STORAGE_KEY,
  formatBoundaryNudgeSeconds,
  projectOwnedSettingsFromDocument,
  readAppCommonPreferences,
  readBoundaryNudgeSecondsInput,
  readBoundarySecondsInput,
  readModePreferences,
  readScratchAudioProxyEnabled,
  readScratchPreviewMilliseconds,
  readVideoSplitPercent,
  writeBoundaryNudgeSecondsInput,
  writeBoundarySecondsInput,
  writeScratchPreviewMilliseconds,
  writeVideoSplitPercent,
} from "@/lib/settingsScopes";
import { createProjectDocument, DEFAULT_WHISPER_SETTINGS } from "@/lib/project";
import type { VideoInfo } from "@/types";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    values,
  };
}

const source = {
  path: "C:\\media\\song.mp4",
  filename: "song.mp4",
  size_bytes: 10,
  mtime_ms: 20,
  fingerprint: { algorithm: "sha256-head-tail-1m-v1" as const, value: "a".repeat(64) },
};

const videoInfo = {
  path: source.path,
  name: source.filename,
  format_name: "mp4",
  duration: 10,
  bit_rate: 0,
  video: {},
  audio: {},
  timestamp_comment_candidates: [],
  info_json_warning: null,
  smart_render_estimate: null,
} as VideoInfo;

describe("typed settings storage", () => {
  it("keeps every legacy key and fallback-compatible values", () => {
    expect(SCRATCH_PREVIEW_STORAGE_KEY).toBe("songcut:scratch-preview-milliseconds");
    expect(SCRATCH_AUDIO_PROXY_ENABLED_STORAGE_KEY).toBe("songcut:scratch-audio-proxy-enabled");
    expect(BOUNDARY_SECONDS_STORAGE_KEY).toBe("songcut:boundary-preview-seconds");
    expect(BOUNDARY_NUDGE_SECONDS_STORAGE_KEY).toBe("songcut:boundary-nudge-seconds");
    expect(VIDEO_SPLIT_STORAGE_KEY).toBe("songcut:video-split-percent");
    expect(CREATE_SOURCE_FOLDER_STORAGE_KEY).toBe("songcut:create-source-folder");

    const target = storage();
    expect(readScratchPreviewMilliseconds(target)).toBe(100);
    expect(readScratchAudioProxyEnabled(target)).toBe(true);
    expect(readBoundarySecondsInput(target)).toBe("5");
    expect(readBoundaryNudgeSecondsInput(target)).toBe("0.5");
    expect(readVideoSplitPercent(target)).toBe(35);
  });

  it("normalizes malformed values and survives storage failures", () => {
    const malformed = storage({
      [SCRATCH_PREVIEW_STORAGE_KEY]: "not-a-number",
      [SCRATCH_AUDIO_PROXY_ENABLED_STORAGE_KEY]: "wat",
      [BOUNDARY_SECONDS_STORAGE_KEY]: "999",
      [BOUNDARY_NUDGE_SECONDS_STORAGE_KEY]: "bad",
      [VIDEO_SPLIT_STORAGE_KEY]: "-4",
    });
    expect(readScratchPreviewMilliseconds(malformed)).toBe(100);
    expect(readScratchAudioProxyEnabled(malformed)).toBe(true);
    expect(readBoundarySecondsInput(malformed)).toBe("60");
    expect(readBoundaryNudgeSecondsInput(malformed)).toBe("0.5");
    expect(readVideoSplitPercent(malformed)).toBe(32);

    const throwing = {
      getItem() {
        throw new Error("storage blocked");
      },
      setItem() {
        throw new Error("storage blocked");
      },
    };
    expect(readScratchPreviewMilliseconds(throwing)).toBe(100);
    expect(writeScratchPreviewMilliseconds(throwing, 250)).toBe(false);
  });

  it("writes normalized values while preserving legacy keys", () => {
    const target = storage();
    writeScratchPreviewMilliseconds(target, 250.7);
    writeBoundarySecondsInput(target, "12.9");
    writeBoundaryNudgeSecondsInput(target, "2.34");
    writeVideoSplitPercent(target, 100);
    expect(target.values.get(SCRATCH_PREVIEW_STORAGE_KEY)).toBe("251");
    expect(target.values.get(BOUNDARY_SECONDS_STORAGE_KEY)).toBe("13");
    expect(target.values.get(BOUNDARY_NUDGE_SECONDS_STORAGE_KEY)).toBe(formatBoundaryNudgeSeconds(2.3));
    expect(target.values.get(VIDEO_SPLIT_STORAGE_KEY)).toBe("72");
  });

  it("exposes app-common preferences as one typed group", () => {
    const target = storage({
      [SCRATCH_PREVIEW_STORAGE_KEY]: "250",
      [SCRATCH_AUDIO_PROXY_ENABLED_STORAGE_KEY]: "false",
      [BOUNDARY_SECONDS_STORAGE_KEY]: "12",
      [VIDEO_SPLIT_STORAGE_KEY]: "50",
    });
    expect(readAppCommonPreferences(target)).toEqual({
      scratchPreviewMilliseconds: 250,
      scratchAudioProxyEnabled: false,
      boundaryPreviewSeconds: "12",
      videoSplitPercent: 50,
    });
  });
});

describe("mode preference isolation", () => {
  it("reads Cut and Sub waveform values independently", () => {
    const target = storage({
      "songcut:waveform-display-mode:cut": "peak",
      "songcut:waveform-display-mode:sub": "rms",
      [CREATE_SOURCE_FOLDER_STORAGE_KEY]: "true",
    });
    const modes = readModePreferences(target);
    expect(modes.cut.waveformDisplayMode).toBe("peak");
    expect(modes.sub.waveformDisplayMode).toBe("rms");
    expect(modes.cut.createSourceFolder).toBe(true);
    expect(modes.sub).not.toHaveProperty("createSourceFolder");
  });
});

describe("settings ownership matrix", () => {
  it("keeps app, mode and project ownership explicit", () => {
    expect(SETTINGS_OWNERSHIP.scratchPreviewMilliseconds.scope).toBe("app");
    expect(SETTINGS_OWNERSHIP.createSourceFolder).toMatchObject({ scope: "mode", mode: "cut" });
    expect(SETTINGS_OWNERSHIP.waveformDisplayModeCut).toMatchObject({ scope: "mode", mode: "cut" });
    expect(SETTINGS_OWNERSHIP.waveformDisplayModeSub).toMatchObject({ scope: "mode", mode: "sub" });
    expect(SETTINGS_OWNERSHIP.analysisDevice).toMatchObject({ scope: "project", field: "settings.analysis_device" });
    expect(SETTINGS_OWNERSHIP.subtitleState).toMatchObject({ scope: "project", field: "subtitle" });
  });
});

describe("project-owned settings extraction", () => {
  it("round-trips only schema-v3 project settings", () => {
    const document = createProjectDocument("C:\\media\\song.mp4.songcut", source, videoInfo);
    document.settings.analysis_device = "gpu";
    document.settings.whisper = { ...DEFAULT_WHISPER_SETTINGS, enabled: true };
    document.settings.export = { filename_template: "{title}" };
    const settings = projectOwnedSettingsFromDocument(document);
    expect(settings).toEqual({
      analysisDevice: "gpu",
      whisper: { ...DEFAULT_WHISPER_SETTINGS, enabled: true },
      filenameTemplate: "{title}",
      subtitle: undefined,
    });
  });
});

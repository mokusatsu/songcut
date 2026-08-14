import { describe, expect, expectTypeOf, it } from "vitest";
import { assertProjectDocument } from "../../electron/project-schema.js";
import {
  composeCutProjectDocument,
  composeSubProjectDocument,
  createCutProjectDocument,
  createSubProjectDocument,
  hydrateCutProjectDocument,
  hydrateProjectDocument,
  hydrateSubProjectDocument,
  type CutProjectComposeState,
  type SubProjectComposeState,
} from "./projectAdapters";
import { DEFAULT_WHISPER_SETTINGS, createProjectDocument } from "./project";
import { DEFAULT_FILENAME_TEMPLATE } from "./exportNaming";
import { subtitleStateFromProject } from "./project";
import type { VideoInfo } from "@/types";

const source = {
  path: "C:\\media\\adapter.mp4",
  filename: "adapter.mp4",
  size_bytes: 123,
  mtime_ms: 456,
  fingerprint: { algorithm: "sha256-head-tail-1m-v1" as const, value: "b".repeat(64) },
};

const videoInfo: VideoInfo = {
  path: source.path,
  name: source.filename,
  format_name: "mov,mp4",
  duration: 12,
  bit_rate: 0,
  video: {},
  audio: {},
  timestamp_comment_candidates: [],
  info_json_warning: null,
  smart_render_estimate: null,
};

function commonState() {
  return {
    revision: 4,
    videoPath: source.path,
    duration: videoInfo.duration,
    waveform: [],
    analysisDevice: "auto" as const,
    whisper: { ...DEFAULT_WHISPER_SETTINGS },
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
    currentTime: 2.25,
    zoomIndex: 3,
  };
}

function cutState(): CutProjectComposeState {
  return {
    ...commonState(),
    selectedSegmentId: null,
    guideText: "",
    analysis: null,
    segments: [],
    exportCandidates: [],
    operation: null,
  };
}

function subState(base: ReturnType<typeof createProjectDocument>): SubProjectComposeState {
  return {
    ...commonState(),
    subtitle: subtitleStateFromProject(base),
    operation: null,
  };
}

describe("mode project adapters", () => {
  it("keeps Cut payloads out of the Sub compose type", () => {
    expectTypeOf<SubProjectComposeState>().not.toHaveProperty("segments");
    expectTypeOf<SubProjectComposeState>().not.toHaveProperty("selectedSegmentId");
    const sub: SubProjectComposeState = subState(createSubProjectDocument(
      "C:\\media\\adapter.mp4.sub.songcut",
      source,
      videoInfo,
    ));
    // @ts-expect-error Sub adapter input must not accept Cut segments.
    const mixed: SubProjectComposeState = { ...sub, segments: [] };
    expect(mixed).toBeDefined();
  });

  it("uses one common serializer while keeping Cut and Sub payloads separate", () => {
    const cutBase = createCutProjectDocument("C:\\media\\adapter.mp4.songcut", source, videoInfo);
    const subBase = createSubProjectDocument("C:\\media\\adapter.mp4.sub.songcut", source, videoInfo);
    const cut = composeCutProjectDocument(cutBase, cutState());
    const sub = composeSubProjectDocument(subBase, subState(subBase));

    expect(cut.revision).toBe(sub.revision);
    expect(cut.source.absolute_path).toBe(sub.source.absolute_path);
    expect(cut.settings).toEqual(sub.settings);
    expect(cut.view_state).toEqual(sub.view_state);
    expect(cut.analysis_snapshot).toBeNull();
    expect(cut.segments).toEqual([]);
    expect(cut.export_candidates).toEqual([]);
    expect(sub.analysis_snapshot).toBeNull();
    expect(sub.segments).toEqual([]);
    expect(sub.export_candidates).toEqual([]);
    expect(sub.subtitle).toBeDefined();
    expect(() => assertProjectDocument(cut)).not.toThrow();
    expect(() => assertProjectDocument(sub)).not.toThrow();
  });

  it("preserves legacy Cut mode omission and omitted export settings", () => {
    const legacy = createProjectDocument("C:\\media\\adapter.mp4.songcut", source, videoInfo);
    delete legacy.mode;
    delete legacy.settings.export;
    const result = composeCutProjectDocument(legacy, cutState());

    expect(result).not.toHaveProperty("mode");
    expect(result.settings).not.toHaveProperty("export");
    expect(JSON.stringify(result)).not.toContain('"mode"');
    expect(() => assertProjectDocument(result)).not.toThrow();
  });

  it("rejects mixed mode bases and operation kinds at runtime", () => {
    const cutBase = createCutProjectDocument("C:\\media\\adapter.mp4.songcut", source, videoInfo);
    const subBase = createSubProjectDocument("C:\\media\\adapter.mp4.sub.songcut", source, videoInfo);

    expect(() => composeSubProjectDocument(cutBase, subState(subBase))).toThrow(/cannot be composed as sub/);
    expect(() => composeCutProjectDocument(subBase, cutState())).toThrow(/cannot be composed as cut/);
    expect(() => composeSubProjectDocument(subBase, {
      ...subState(subBase),
      segments: [],
    } as never)).toThrow(/Cut-only project state/);
    expect(() => composeCutProjectDocument(cutBase, {
      ...cutState(),
      subtitle: subtitleStateFromProject(subBase),
    } as never)).toThrow(/Sub-only subtitle/);
    expect(() => composeCutProjectDocument(cutBase, {
      ...cutState(),
      operation: { kind: "subtitle-export", status: "running" } as never,
    })).toThrow(/incompatible with cut/);
  });

  it("hydrates mode-specific state without sharing mutable persisted values", () => {
    const subBase = createSubProjectDocument("C:\\media\\adapter.mp4.sub.songcut", source, videoInfo);
    const composed = composeSubProjectDocument(subBase, subState(subBase));
    const hydrated = hydrateSubProjectDocument(composed);
    hydrated.subtitle.lanes[0].name = "changed";
    expect(composed.subtitle?.lanes[0].name).not.toBe("changed");
    expect(hydrated).not.toHaveProperty("segments");
    expect(hydrated).not.toHaveProperty("analysis");
    expect(hydrated).not.toHaveProperty("selectedSegmentId");

    const legacy = createCutProjectDocument("C:\\media\\adapter.mp4.songcut", source, videoInfo);
    delete legacy.mode;
    const cutHydrated = hydrateCutProjectDocument(legacy);
    expect(cutHydrated.mode).toBe("cut");
    expect(cutHydrated.selectedSegmentId).toBeNull();
    expect("subtitle" in cutHydrated).toBe(false);
    expect(hydrateProjectDocument(legacy).mode).toBe("cut");
  });

  it("round-trips optional display elements and analysis artifacts in schema v3", () => {
    const subBase = createSubProjectDocument("C:\\media\\adapter.mp4.sub.songcut", source, videoInfo);
    const state = subState(subBase);
    state.subtitle.analysis_artifact = {
      cache_key: "lyrics-cache-1",
      cache_format: "demucs-vocals-wav",
      source_fingerprint: { algorithm: "sha256-head-tail-1m-v1", value: "c".repeat(64) },
      demucs_model: "htdemucs",
      preprocess_version: "v1",
      sample_rate: 16_000,
      channels: 1,
      expires_at: "2026-08-13T00:00:00.000Z",
    };
    state.subtitle.analysis_algorithm = "songcut-standard";
    const lane = state.subtitle.lanes[0];
    lane.segments = [{
      id: "line-1",
      text: "歌",
      start: 0,
      end: 1,
      confidence: 1,
      source: "lyrics",
      low_confidence_outlier: false,
      user_edited: false,
      display_elements: [
        {
          stable_id: "element-1",
          text: "歌",
          start: 0,
          end: 0.5,
          confidence: 1,
          source: "mms-ctc",
          source_start: 0,
          source_end: 1,
          pronunciation: "ka",
          token_start: 0,
          token_end: 1,
          origin_key: "line-1:0",
          manual_start: false,
          manual_end: false,
          manual_structure: false,
          parent_revision: 1,
          conflict: null,
          orphaned_manual: false,
        },
        {
          stable_id: "element-2",
          text: "",
          start: 0.5,
          end: 1,
          confidence: 1,
          source: "blank",
          source_start: 1,
          source_end: 1,
          pronunciation: "",
          token_start: 1,
          token_end: 1,
          origin_key: "blank:line-1:0",
          manual_start: false,
          manual_end: false,
          manual_structure: false,
          parent_revision: 1,
          conflict: null,
          orphaned_manual: false,
        },
      ],
      line_revision: 2,
      display_element_revision: 3,
      display_element_boundary_locked: true,
      start_locked: false,
      end_locked: true,
      alignment_diagnostics: { coverage: 1, accepted: true },
      display_element_text: "歌",
      needs_reanalysis: false,
    }];

    const composed = composeSubProjectDocument(subBase, state);
    expect(() => assertProjectDocument(composed)).not.toThrow();
    const hydrated = hydrateSubProjectDocument(composed);
    expect(hydrated.subtitle.analysis_artifact).toEqual(state.subtitle.analysis_artifact);
    expect(hydrated.subtitle.analysis_algorithm).toBe("songcut-standard");
    expect(hydrated.subtitle.lanes[0].segments[0].display_elements).toEqual(
      state.subtitle.lanes[0].segments[0].display_elements,
    );
    expect(hydrated.subtitle.lanes[0].segments[0].line_revision).toBe(2);
    expect(hydrated.subtitle.lanes[0].segments[0].display_element_boundary_locked).toBe(true);
    expect(hydrated.subtitle.lanes[0].segments[0].start_locked).toBe(false);
    expect(hydrated.subtitle.lanes[0].segments[0].end_locked).toBe(true);
    expect(hydrated.subtitle.lanes[0].segments[0].display_element_text).toBe("歌");

    const legacy = createSubProjectDocument("C:\\media\\legacy.mp4.sub.songcut", source, videoInfo);
    delete legacy.subtitle?.analysis_artifact;
    delete legacy.subtitle?.analysis_algorithm;
    const legacyHydrated = hydrateSubProjectDocument(legacy);
    expect(legacyHydrated.subtitle).not.toHaveProperty("analysis_artifact");
    expect(legacyHydrated.subtitle).not.toHaveProperty("analysis_algorithm");
    expect(legacyHydrated.subtitle.lanes[0].segments[0]).toBeUndefined();
    expect(() => assertProjectDocument(legacy)).not.toThrow();
  });
});

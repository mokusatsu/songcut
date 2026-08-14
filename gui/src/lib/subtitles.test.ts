import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SUBTITLE_STYLE,
  addFourBeatSegment,
  analysisLinesToSegments,
  createLyricsLane,
  labelStackLevels,
  normalizeSubtitleState,
  normalizeSubtitleStyle,
  nudgeSegmentBoundary,
  resolveSubtitleSegmentStyle,
  subtitleRenderSignature,
  updateSegmentBoundary,
  validateSubtitleState,
  withSubtitleSegmentStyle,
  type LyricsSegment,
  type LyricsAnalysisResult,
  type RhythmGridPoint,
} from "./subtitles";
import type { SubtitleEffectCatalog } from "./subtitleEffects";

vi.stubGlobal("crypto", { randomUUID: () => "uuid" });

const grid: RhythmGridPoint[] = Array.from({ length: 41 }, (_, index) => ({
  time: index * 0.25,
  grid: index % 4 === 0 ? "beat" : index % 2 === 0 ? "half-beat" : "quarter-beat",
  attraction_radius: 0.05,
  grid_penalty: 0,
}));

const effectCatalog = {
  package: "ass-lyric-effects",
  version: "3.0.0",
  schema_version: "1.0",
  stable_id_contract: {},
  multiline_context_contract: {},
  effects: [
    { effect_id: "cut", stable_effect_id: true, name_en: "Cut", name_ja: "カット", description_en: "", description_ja: "", parameters: {} },
    { effect_id: "fad", stable_effect_id: true, name_en: "Fade", name_ja: "フェード", description_en: "", description_ja: "", parameters: {} },
  ],
} as SubtitleEffectCatalog;

describe("subtitle segment management", () => {
  it("adds a four-beat segment after the selected segment", () => {
    const lane = createLyricsLane();
    lane.segments = [segment("first", 0, 1), segment("next", 7, 8)];

    expect(addFourBeatSegment(lane, "first", grid)).toMatchObject({ start: 1, end: 5 });
  });

  it("shrinks a new segment to the available gap and rejects a full gap", () => {
    const lane = createLyricsLane();
    lane.segments = [segment("first", 0, 1), segment("next", 2, 3)];

    expect(addFourBeatSegment(lane, "first", grid)).toMatchObject({ start: 1, end: 2 });
    lane.segments = [segment("first", 0, 1), segment("next", 1, 3)];
    expect(addFourBeatSegment(lane, "first", grid)).toBeNull();
  });

  it("snaps boundaries while preserving non-overlap", () => {
    const lane = createLyricsLane();
    lane.segments = [segment("previous", 0, 1), segment("target", 2, 4), segment("next", 5, 6)];

    const changed = updateSegmentBoundary(lane, "target", "start", 1.64, grid);
    expect(changed.segments.find((item) => item.id === "target")?.start).toBe(1.75);

    const clamped = updateSegmentBoundary(changed, "target", "end", 5.2, grid);
    expect(clamped.segments.find((item) => item.id === "target")?.end).toBe(4.75);
  });

  it("nudges only to rhythm points that keep neighboring lanes separate", () => {
    const lane = createLyricsLane();
    lane.segments = [segment("previous", 0, 1), segment("target", 2, 4), segment("next", 5, 6)];

    const nudgedStart = nudgeSegmentBoundary(lane, "target", "start", -1, grid);
    expect(nudgedStart.segments.find((item) => item.id === "target")?.start).toBe(1.75);

    const nudgedEnd = nudgeSegmentBoundary(nudgedStart, "target", "end", 1, grid);
    expect(nudgedEnd.segments.find((item) => item.id === "target")?.end).toBe(4.25);

    const blockedAtPrevious = nudgeSegmentBoundary(
      { ...nudgedStart, segments: nudgedStart.segments.map((item) => item.id === "target" ? { ...item, start: 1.25 } : item) },
      "target",
      "start",
      -1,
      grid,
    );
    expect(blockedAtPrevious.segments.find((item) => item.id === "target")?.start).toBe(1.25);

    const blockedAtNext = nudgeSegmentBoundary(
      { ...nudgedEnd, segments: nudgedEnd.segments.map((item) => item.id === "target" ? { ...item, end: 4.75 } : item) },
      "target",
      "end",
      1,
      grid,
    );
    expect(blockedAtNext.segments.find((item) => item.id === "target")?.end).toBe(4.75);

    const ordered = [...blockedAtNext.segments].sort((left, right) => left.start - right.start);
    expect(ordered[1].start).toBeGreaterThanOrEqual(ordered[0].end);
    expect(ordered[2].start).toBeGreaterThanOrEqual(ordered[1].end);
  });
});

describe("subtitle label levels", () => {
  it("resets after a long median-gap outlier and cycles after six levels", () => {
    const dense = Array.from({ length: 7 }, (_, index) =>
      segment(`dense-${index}`, index, index + 0.8)
    );
    const segments = [...dense, segment("after-gap", 10, 11)];

    const levels = labelStackLevels(segments);

    expect([...dense.map((item) => levels.get(item.id))]).toEqual([0, 1, 2, 3, 4, 5, 5]);
    expect(levels.get("after-gap")).toBe(0);
  });

  it("moves the first of two consecutive top labels to the preceding group's bottom", () => {
    const segments = [
      segment("group-1", 0, 0.8),
      segment("group-2", 1, 1.8),
      segment("group-3", 2, 2.8),
      segment("group-4", 3, 3.8),
      segment("bridge", 8, 8.8),
      segment("next-group", 13, 13.8),
    ];

    const levels = labelStackLevels(segments);

    expect(levels.get("bridge")).toBe(4);
    expect(levels.get("next-group")).toBe(0);
  });
});

describe("subtitleRenderSignature", () => {
  it("changes only when static ASS render inputs change", () => {
    const base = subtitleRenderSignature("歌詞", DEFAULT_SUBTITLE_STYLE, 1920, 1080);
    expect(subtitleRenderSignature("歌詞", DEFAULT_SUBTITLE_STYLE, 1920, 1080)).toBe(base);
    expect(subtitleRenderSignature("別の歌詞", DEFAULT_SUBTITLE_STYLE, 1920, 1080)).not.toBe(base);
    expect(
      subtitleRenderSignature("歌詞", { ...DEFAULT_SUBTITLE_STYLE, bold: true }, 1920, 1080)
    ).not.toBe(base);
    expect(subtitleRenderSignature("歌詞", DEFAULT_SUBTITLE_STYLE, 1280, 720)).not.toBe(base);
  });
});

describe("subtitle style normalization", () => {
  it("uses 90 as the default font size for new lyrics timelines", () => {
    expect(DEFAULT_SUBTITLE_STYLE.font_size).toBe(90);
    expect(createLyricsLane().style.font_size).toBe(90);
  });

  it("clamps persisted and UI values to the API constraints", () => {
    expect(normalizeSubtitleStyle({
      ...DEFAULT_SUBTITLE_STYLE,
      font_size: 500,
      outline: 40,
      shadow: 50,
      margin_l: 5000,
      margin_r: 10.6,
      margin_v: Number.NaN,
      alignment: Number.NaN,
    })).toMatchObject({
      font_size: 400,
      outline: 30,
      shadow: 30,
      margin_l: 4000,
      margin_r: 11,
      margin_v: DEFAULT_SUBTITLE_STYLE.margin_v,
      alignment: DEFAULT_SUBTITLE_STYLE.alignment,
    });
  });

  it("repairs an out-of-range shadow while loading a legacy project", () => {
    const lane = createLyricsLane();
    lane.style.shadow = 50;
    const state = validateSubtitleState({
      lanes: [lane],
      active_lane_id: lane.id,
      selected_segment_id: null,
      tempo_bpm: 0,
      beat_times: [],
      rhythm_grid: [],
      beat_warning: null,
      confidence_statistics: null,
    });

    expect(state?.lanes[0].style.shadow).toBe(30);
  });
});

describe("subtitle effects", () => {
  it("creates lanes with a non-previewing cut effect by default", () => {
    expect(createLyricsLane().effect).toEqual({
      name: "cut",
      start_duration_ms: 750,
      end_duration_ms: 750,
      params: {},
    });
  });

  it("upgrades legacy lanes and preserves configured effect parameters", () => {
    const legacy = createLyricsLane();
    delete (legacy as Partial<typeof legacy>).effect;
    const upgraded = validateSubtitleState({
      lanes: [legacy],
      active_lane_id: legacy.id,
      selected_segment_id: null,
      tempo_bpm: 0,
      beat_times: [],
      rhythm_grid: [],
      beat_warning: null,
      confidence_statistics: null,
    });
    expect(upgraded?.lanes[0].effect.name).toBe("cut");

    const configured = createLyricsLane();
    configured.effect = {
      name: "glow",
      start_duration_ms: 450,
      end_duration_ms: 250,
      params: { radius: 20, border: 12, color: "#42D7FF" },
    };
    expect(validateSubtitleState({
      lanes: [configured],
      active_lane_id: configured.id,
      selected_segment_id: null,
      tempo_bpm: 0,
      beat_times: [],
      rhythm_grid: [],
      beat_warning: null,
      confidence_statistics: null,
    })?.lanes[0].effect).toEqual(configured.effect);
  });
});

describe("display element schema", () => {
  it("keeps backend display elements and analysis revisions when creating segments", () => {
    const element = displayElement("element-1", "歌", 0, 0.45);
    const result: LyricsAnalysisResult = {
      title: null,
      duration: 1,
      device_used: "cpu",
      algorithm: "songcut-standard",
      whisper_text: "歌",
      tempo_bpm: 0,
      beat_times: [],
      rhythm_grid: [],
      beat_warning: null,
      confidence_statistics: {
        count: 1,
        minimum: 1,
        maximum: 1,
        mean: 1,
        median: 1,
        q1: 1,
        q3: 1,
        lower_outlier_bound: 1,
        low_outlier_indexes: [],
      },
      lines: [{
        index: 0,
        text: "歌",
        start: 0,
        end: 1,
        confidence: 0.9,
        source: "lyrics",
        matched_characters: 1,
        exact_characters: 1,
        total_characters: 1,
        low_confidence_outlier: false,
        display_elements: [element, displayElement("element-2", "", 0.45, 1)],
        display_element_text: "歌",
        line_revision: 3,
        display_element_revision: 4,
        alignment_diagnostics: ["coverage"],
        needs_reanalysis: false,
      }],
      elapsed_seconds: 0.1,
    };

    const segments = analysisLinesToSegments(result);
    expect(segments[0]).toMatchObject({
      line_revision: 3,
      display_element_revision: 4,
      display_elements: result.lines[0].display_elements,
      display_element_text: "歌",
    });
    expect(segments[0].display_elements).not.toBe(result.lines[0].display_elements);
  });

  it("accepts a complete partition and rejects gaps, zero durations, and duplicate IDs", () => {
    const lane = createLyricsLane();
    lane.segments = [{
      ...segment("line", 10, 12),
      display_elements: [
        displayElement("element-1", "歌", 10, 11),
        displayElement("element-2", "", 11, 12),
      ],
      line_revision: 1,
      display_element_revision: 1,
      display_element_boundary_locked: true,
      start_locked: false,
      end_locked: false,
      alignment_diagnostics: { coverage: 1, accepted: true },
      needs_reanalysis: false,
    }];
    const valid = validateSubtitleState({
      lanes: [lane],
      active_lane_id: lane.id,
      selected_segment_id: lane.segments[0].id,
      tempo_bpm: 0,
      beat_times: [],
      rhythm_grid: [],
      beat_warning: null,
      confidence_statistics: null,
    });
    expect(valid?.lanes[0].segments[0].display_elements).toHaveLength(2);
    expect(valid?.lanes[0].segments[0].display_element_boundary_locked).toBe(true);

    const gap = structuredClone(lane);
    gap.segments[0].display_elements![1].start = 11.1;
    expect(validateSubtitleState({
      lanes: [gap], active_lane_id: gap.id, selected_segment_id: null,
      tempo_bpm: 0, beat_times: [], rhythm_grid: [], beat_warning: null, confidence_statistics: null,
    })).toBeNull();

    const zero = structuredClone(lane);
    zero.segments[0].display_elements![0].end = 10;
    expect(validateSubtitleState({
      lanes: [zero], active_lane_id: zero.id, selected_segment_id: null,
      tempo_bpm: 0, beat_times: [], rhythm_grid: [], beat_warning: null, confidence_statistics: null,
    })).toBeNull();

    const duplicate = structuredClone(lane);
    duplicate.segments[0].display_elements![1].stable_id = "element-1";
    expect(validateSubtitleState({
      lanes: [duplicate], active_lane_id: duplicate.id, selected_segment_id: null,
      tempo_bpm: 0, beat_times: [], rhythm_grid: [], beat_warning: null, confidence_statistics: null,
    })).toBeNull();

    const invalidLock = structuredClone(lane) as unknown as {
      id: string;
      segments: Array<Record<string, unknown>>;
    };
    invalidLock.segments[0].display_element_boundary_locked = "yes";
    expect(validateSubtitleState({
      lanes: [invalidLock], active_lane_id: invalidLock.id, selected_segment_id: null,
      tempo_bpm: 0, beat_times: [], rhythm_grid: [], beat_warning: null, confidence_statistics: null,
    })).toBeNull();
  });

  it("preserves artifact metadata while rejecting malformed fingerprints", () => {
    const lane = createLyricsLane();
    const artifact = {
      cache_key: "cache-key",
      cache_format: "demucs-vocals-wav",
      source_fingerprint: { algorithm: "sha256-head-tail-1m-v1", value: "a".repeat(64) },
      demucs_model: "htdemucs",
      preprocess_version: "v1",
      sample_rate: 16_000,
      channels: 1,
      expires_at: "2026-08-13T00:00:00.000Z",
    } as const;
    const value = {
      lanes: [lane], active_lane_id: lane.id, selected_segment_id: null,
      tempo_bpm: 0, beat_times: [], rhythm_grid: [], beat_warning: null,
      confidence_statistics: null, analysis_artifact: artifact,
    };
    expect(validateSubtitleState(value)?.analysis_artifact).toEqual(artifact);
    expect(validateSubtitleState({
      ...value,
      analysis_artifact: { ...artifact, source_fingerprint: { ...artifact.source_fingerprint, value: "bad" } },
    })).toBeNull();
  });
});

describe("segment style overrides", () => {
  it("inherits lane settings until a complete custom Style and Effect pair is applied", () => {
    const lane = createLyricsLane();
    const inheritedSegment = segment("line", 0, 1);
    expect(resolveSubtitleSegmentStyle(lane, inheritedSegment, effectCatalog)).toMatchObject({
      mode: "inherit",
      style: { font_size: 90 },
      effect: { name: "cut" },
    });

    const customSegment = withSubtitleSegmentStyle(
      inheritedSegment,
      { ...lane.style, font_size: 48 },
      { ...lane.effect, name: "fad" },
      effectCatalog,
    );
    lane.style = { ...lane.style, font_size: 120 };
    expect(resolveSubtitleSegmentStyle(lane, customSegment, effectCatalog)).toMatchObject({
      mode: "custom",
      style: { font_size: 48 },
      effect: { name: "fad" },
    });
    expect(resolveSubtitleSegmentStyle(lane, withSubtitleSegmentStyle(customSegment, undefined, undefined, effectCatalog), effectCatalog)).toMatchObject({
      mode: "inherit",
      style: { font_size: 120 },
    });
  });

  it("normalizes a persisted complete override and rejects a partial pair", () => {
    const lane = createLyricsLane();
    lane.segments = [withSubtitleSegmentStyle(
      segment("custom", 0, 1),
      { ...lane.style, font_size: 500 },
      { ...lane.effect, start_duration_ms: 99_999 },
      effectCatalog,
    )];
    const state = validateSubtitleState({
      lanes: [lane],
      active_lane_id: lane.id,
      selected_segment_id: lane.segments[0].id,
      tempo_bpm: 0,
      beat_times: [],
      rhythm_grid: [],
      beat_warning: null,
      confidence_statistics: null,
    });
    expect(state?.lanes[0].segments[0].style_override?.font_size).toBe(400);
    expect(state?.lanes[0].segments[0].effect_override?.start_duration_ms).toBe(99_999);

    const partial = { ...lane.segments[0] };
    delete partial.effect_override;
    expect(validateSubtitleState({ ...state, lanes: [{ ...lane, segments: [partial] }] })).toBeNull();
  });

  it("keeps raw effect IDs before catalog arrival and rejects unknown IDs when validating", () => {
    const lane = createLyricsLane();
    lane.effect = {
      name: "future_effect",
      start_duration_ms: 100,
      end_duration_ms: 100,
      params: { palette: ["&HFFFFFF&"] },
    };
    const raw = validateSubtitleState({
      lanes: [lane],
      active_lane_id: lane.id,
      selected_segment_id: null,
      tempo_bpm: 0,
      beat_times: [],
      rhythm_grid: [],
      beat_warning: null,
      confidence_statistics: null,
    });
    expect(raw?.lanes[0].effect).toEqual(lane.effect);
    expect(() => normalizeSubtitleState(raw, effectCatalog)).toThrow(/Unknown subtitle effect_id/);
  });
});

function segment(id: string, start: number, end: number): LyricsSegment {
  return {
    id,
    text: id,
    start,
    end,
    confidence: 1,
    source: "lyrics",
    low_confidence_outlier: false,
    user_edited: false,
  };
}

function displayElement(stableId: string, text: string, start: number, end: number) {
  return {
    stable_id: stableId,
    text,
    start,
    end,
    confidence: 0.9,
    source: text ? "mms-ctc" as const : "blank" as const,
    source_start: text ? 0 : 1,
    source_end: text ? 1 : 1,
    pronunciation: text ? "ka" : "",
    token_start: text ? 0 : 1,
    token_end: text ? 1 : 1,
    origin_key: stableId,
    manual_start: false,
    manual_end: false,
    manual_structure: false,
    parent_revision: 1,
    conflict: null,
    orphaned_manual: false,
  };
}

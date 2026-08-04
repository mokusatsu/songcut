import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SUBTITLE_STYLE,
  addFourBeatSegment,
  createLyricsLane,
  labelStackLevels,
  normalizeSubtitleStyle,
  subtitleRenderSignature,
  updateSegmentBoundary,
  validateSubtitleState,
  type LyricsSegment,
  type RhythmGridPoint,
} from "./subtitles";

vi.stubGlobal("crypto", { randomUUID: () => "uuid" });

const grid: RhythmGridPoint[] = Array.from({ length: 41 }, (_, index) => ({
  time: index * 0.25,
  grid: index % 4 === 0 ? "beat" : index % 2 === 0 ? "half-beat" : "quarter-beat",
  attraction_radius: 0.05,
  grid_penalty: 0,
}));

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
      start_duration_ms: 300,
      end_duration_ms: 300,
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

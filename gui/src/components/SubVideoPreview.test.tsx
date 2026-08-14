import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  activeDisplayElementPreviewKey,
  buildDisplayElementPreviewItems,
  buildStableDisplayElementPreviewItems,
  containedVideoRect,
  displayElementPreviewTrackOffset,
  subVideoPreviewLayout,
  SubVideoPreviewControls,
} from "@/components/SubVideoPreview";
import type { DisplayElement, LyricsLane, LyricsSegment, SubtitleProjectState } from "@/lib/subtitles";

function element(id: string, text: string, start: number, end: number): DisplayElement {
  return {
    stable_id: id,
    text,
    start,
    end,
    confidence: 1,
    source: text ? "mms-ctc" : "blank",
    source_start: 0,
    source_end: text.length,
    pronunciation: text,
    token_start: 0,
    token_end: text.length,
    origin_key: id,
    manual_start: false,
    manual_end: false,
    manual_structure: false,
    parent_revision: 1,
    conflict: null,
    orphaned_manual: false,
  };
}

function segment(id: string, start: number, end: number, elements: DisplayElement[]): LyricsSegment {
  return {
    id,
    text: elements.map((item) => item.text).join(""),
    start,
    end,
    confidence: 1,
    source: "lyrics",
    low_confidence_outlier: false,
    user_edited: false,
    display_elements: elements,
  };
}

function lane(id: string, segments: LyricsSegment[]): LyricsLane {
  return {
    id,
    name: id,
    style: {} as LyricsLane["style"],
    effect: {} as LyricsLane["effect"],
    segments,
  };
}

function state(lanes: LyricsLane[], selected = "primary"): SubtitleProjectState {
  return {
    lanes,
    active_lane_id: lanes[0]?.id ?? "",
    selected_segment_id: selected,
    tempo_bpm: 120,
    beat_times: [],
    rhythm_grid: [],
    beat_warning: null,
    confidence_statistics: null,
  };
}

describe("buildDisplayElementPreviewItems", () => {
  it("maps the primary Lyrics Timeline to a 120px/s center cursor and excludes other lanes", () => {
    const project = state([
      lane("lyrics", [
        segment("previous", 8, 9, [element("p", "P", 8, 9)]),
        segment("primary", 9, 11, [
          element("a", "A", 9, 10),
          element("blank", "", 10, 10.25),
          element("b", "B", 10.25, 11),
        ]),
        segment("selected-too", 11, 12, [element("c", "C", 11, 12)]),
      ]),
      lane("other", [segment("other", 9, 11, [element("x", "X", 9, 11)])]),
    ]);
    const items = buildDisplayElementPreviewItems(
      project,
      new Set(["primary", "selected-too", "other"]),
      10,
      1000,
    );

    expect(items.map((item) => item.text)).toEqual(["P", "A", "", "B", "C"]);
    expect(items.find((item) => item.elementId === "a")).toMatchObject({ left: 380, width: 120, active: false });
    expect(items.find((item) => item.elementId === "blank")).toMatchObject({ left: 500, width: 30, active: true, blank: true });
    expect(items.find((item) => item.elementId === "c")?.selectedSegment).toBe(true);
    expect(items.some((item) => item.text === "X")).toBe(false);
  });

  it("culls outside the visible range and returns nothing without a valid primary selection", () => {
    const project = state([
      lane("lyrics", [
        segment("primary", 0, 1, [element("far", "far", 0, 1)]),
        segment("near", 9.5, 10.5, [element("near", "near", 9.5, 10.5)]),
      ]),
    ]);
    expect(buildDisplayElementPreviewItems(project, new Set(), 10, 240, 120, 0).map((item) => item.text)).toEqual(["near"]);
    expect(buildDisplayElementPreviewItems({ ...project, selected_segment_id: "missing" }, new Set(), 10, 240)).toEqual([]);
  });

  it("keeps the final element active at its inclusive end and recognizes blank source", () => {
    const sourceBlank = { ...element("source-blank", "ignored", 10, 10.5), source: "blank" as const };
    const project = state([
      lane("lyrics", [
        segment("primary", 10, 11, [sourceBlank, element("final", "F", 10.5, 11)]),
      ]),
    ]);
    const items = buildDisplayElementPreviewItems(project, new Set(["primary"]), 11, 480);

    expect(items.find((item) => item.elementId === "source-blank")?.blank).toBe(true);
    expect(items.find((item) => item.elementId === "final")?.active).toBe(true);
  });
});

describe("containedVideoRect", () => {
  it("centers an object-fit contain video inside letterbox space", () => {
    const rect = containedVideoRect(1000, 500, 1920, 1080);
    expect(rect.left).toBeCloseTo(500 / 9);
    expect(rect.top).toBe(0);
    expect(rect.width).toBeCloseTo(8000 / 9);
    expect(rect.height).toBe(500);
  });

  it("places controls in the left pillarbox and gives display elements the full pane width", () => {
    const layout = subVideoPreviewLayout(1000, 500, 1920, 1080);

    expect(layout.controls).toEqual({
      left: 0,
      top: 0,
      width: expect.closeTo(500 / 9),
      height: 500,
    });
    expect(layout.overlay).toEqual({ left: 0, top: 0, width: 1000, height: 500 });
  });
});

describe("displayElementPreviewTrackOffset", () => {
  it("moves the track smoothly in the opposite direction of media playback", () => {
    expect(displayElementPreviewTrackOffset(10, 10)).toBe(0);
    expect(displayElementPreviewTrackOffset(10, 10.25)).toBe(-30);
    expect(displayElementPreviewTrackOffset(10, 9.5)).toBe(60);
  });

  it("keeps one stable DOM key set across playback anchors", () => {
    const project = state([
      lane("lyrics", [
        segment("primary", 0, 1, [element("far-left", "L", 0, 1)]),
        segment("later", 100, 101, [element("far-right", "R", 100, 101)]),
      ]),
    ]);
    const atStart = buildStableDisplayElementPreviewItems(project, new Set(["primary"]), 0, 1000);
    const atEnd = buildStableDisplayElementPreviewItems(project, new Set(["primary"]), 100, 1000);

    expect(atStart.map((item) => item.key)).toEqual(["primary:far-left", "later:far-right"]);
    expect(atEnd.map((item) => item.key)).toEqual(atStart.map((item) => item.key));
  });
});

describe("activeDisplayElementPreviewKey", () => {
  it("updates the active key without rebuilding the buffered card list", () => {
    const project = state([
      lane("lyrics", [
        segment("primary", 10, 12, [element("a", "A", 10, 11), element("b", "B", 11, 12)]),
      ]),
    ]);

    expect(activeDisplayElementPreviewKey(project, 10.5)).toBe("primary:a");
    expect(activeDisplayElementPreviewKey(project, 11.5)).toBe("primary:b");
  });
});

describe("SubVideoPreviewControls", () => {
  it("renders independent editor checkboxes with the requested labels", () => {
    const markup = renderToStaticMarkup(
      <SubVideoPreviewControls
        subtitleVisible
        displayElementsVisible={false}
        labels={{ controls: "Preview visibility", subtitle: "Subtitle", displayElements: "Display elements" }}
        onSubtitleVisibleChange={() => undefined}
        onDisplayElementsVisibleChange={() => undefined}
      />,
    );
    expect(markup).toContain("role=\"group\"");
    expect(markup).toContain("Subtitle");
    expect(markup).toContain("Display elements");
    expect(markup).toContain("checked=\"\"");
  });
});

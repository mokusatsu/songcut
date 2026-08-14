import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  laneNameEditKeyAction,
  lyricsTextEditKeyAction,
  lyricsLaneHeight,
  resolveLaneNameEdit,
  resolveLyricsTextEdit,
} from "@/components/SubTimelineEditor";
import type { LyricsSegment } from "@/lib/subtitles";

const subTimelineEditorSource = readFileSync(new URL("./SubTimelineEditor.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("Sub lyric text edit commit contract", () => {
  it("does not commit Enter or Escape during IME composition", () => {
    expect(lyricsTextEditKeyAction({ key: "Enter", isComposing: true, keyCode: 13 })).toBeNull();
    expect(lyricsTextEditKeyAction({ key: "Escape", isComposing: false, keyCode: 229 })).toBeNull();
    expect(lyricsTextEditKeyAction({ key: "a", isComposing: false, keyCode: 65 })).toBeNull();
  });

  it("uses only non-IME Enter and Escape as explicit finish actions", () => {
    expect(lyricsTextEditKeyAction({ key: "Enter", isComposing: false, keyCode: 13 })).toBe("commit");
    expect(lyricsTextEditKeyAction({ key: "Escape", isComposing: false, keyCode: 27 })).toBe("cancel");
  });

  it("trims one committed value and keeps unchanged or cancelled edits out of state", () => {
    expect(resolveLyricsTextEdit("歌詞", "  新しい歌詞  ", false)).toEqual({
      action: "commit",
      text: "新しい歌詞",
    });
    expect(resolveLyricsTextEdit("歌詞", "歌詞", false)).toEqual({ action: "unchanged" });
    expect(resolveLyricsTextEdit("歌詞", "破棄", true)).toEqual({ action: "cancel" });
  });
});

describe("Sub lyric lane name edit contract", () => {
  it("keeps Enter and Escape inert during IME composition", () => {
    expect(laneNameEditKeyAction({ key: "Enter", isComposing: true, keyCode: 13 })).toBeNull();
    expect(laneNameEditKeyAction({ key: "Escape", isComposing: false, keyCode: 229 })).toBeNull();
    expect(laneNameEditKeyAction({ key: "Enter", isComposing: false, keyCode: 13 })).toBe("commit");
    expect(laneNameEditKeyAction({ key: "Escape", isComposing: false, keyCode: 27 })).toBe("cancel");
  });

  it("trims committed names and does not emit cancelled or unchanged edits", () => {
    expect(resolveLaneNameEdit("Lyrics 1", "  Main vocals  ", false)).toEqual({
      action: "commit",
      name: "Main vocals",
    });
    expect(resolveLaneNameEdit("Lyrics 1", "Lyrics 1", false)).toEqual({ action: "unchanged" });
    expect(resolveLaneNameEdit("Lyrics 1", "   ", false)).toEqual({ action: "cancel" });
    expect(resolveLaneNameEdit("Lyrics 1", "Discarded", true)).toEqual({ action: "cancel" });
  });
});

describe("Sub lyric lane density contract", () => {
  it("uses the highest label stack level instead of the fixed 240px lane", () => {
    const segment = (id: string, start: number, end: number): LyricsSegment => ({
      id,
      text: id,
      start,
      end,
      confidence: 1,
      source: "lyrics",
      low_confidence_outlier: false,
      user_edited: false,
    });

    const oneLevel = lyricsLaneHeight([segment("one", 0, 0.8)]);
    const twoLevels = lyricsLaneHeight([
      segment("one", 0, 0.8),
      segment("two", 1, 1.8),
    ]);

    expect(oneLevel).toBe(90);
    expect(twoLevels).toBe(112);
    expect(twoLevels).toBeLessThan(240);
    expect(lyricsLaneHeight([segment("one", 0, 0.8)], 0)).toBeGreaterThan(oneLevel);
  });
});

describe("Sub timeline horizontal scrollbar gutter", () => {
  it("reserves the Sub-only scrollbar height below the final lyric lane", () => {
    const selectorStart = stylesSource.indexOf(".sub-timeline-content {");
    const selectorEnd = stylesSource.indexOf("}", selectorStart);
    const rules = stylesSource.slice(selectorStart, selectorEnd);

    expect(selectorStart).toBeGreaterThanOrEqual(0);
    expect(selectorEnd).toBeGreaterThan(selectorStart);
    expect(rules).toContain("padding-bottom: var(--sub-scrollbar-size);");
  });
});

describe("Sub waveform segment pointer contract", () => {
  it("keeps only the waveform range transparent while the timeline segment remains selectable", () => {
    const waveformSegmentStart = subTimelineEditorSource.indexOf('className={`sub-waveform-segment');
    const waveformSegmentEnd = subTimelineEditorSource.indexOf("/>", waveformSegmentStart);
    const waveformSegmentMarkup = subTimelineEditorSource.slice(waveformSegmentStart, waveformSegmentEnd);
    const segmentStart = subTimelineEditorSource.indexOf('className={`lyrics-segment');
    const segmentEnd = subTimelineEditorSource.indexOf("/>", segmentStart);
    const segmentMarkup = subTimelineEditorSource.slice(segmentStart, segmentEnd);

    expect(waveformSegmentStart).toBeGreaterThanOrEqual(0);
    expect(waveformSegmentEnd).toBeGreaterThan(waveformSegmentStart);
    expect(waveformSegmentMarkup).toContain('pointerEvents="none"');
    expect(waveformSegmentMarkup).not.toContain("onPointerDown");
    expect(waveformSegmentMarkup).not.toContain("onClick");
    expect(segmentStart).toBeGreaterThanOrEqual(0);
    expect(segmentEnd).toBeGreaterThan(segmentStart);
    expect(segmentMarkup).not.toContain('pointerEvents: "none"');
    expect(subTimelineEditorSource).toContain("...segmentActionFocusProps");
    expect(segmentMarkup).not.toContain("lyrics-handle");
    expect(subTimelineEditorSource).toContain('className={`lyrics-handle start ${props.selected ? "selected" : ""}`}');
    expect(subTimelineEditorSource).toContain('className={`lyrics-handle end ${props.selected ? "selected" : ""}`}');
    expect(subTimelineEditorSource).toContain("startBoundaryEditable ?");
    expect(subTimelineEditorSource).toContain("endBoundaryEditable ?");
    expect(subTimelineEditorSource).toContain("className={`lyrics-label");
    expect(subTimelineEditorSource).toContain("onClick={(event) => props.onSelect(segmentSelectionModifiers(event))}");
  });

  it("keeps boundary handles outside the selectable button so a drag cannot reselect and seek", () => {
    expect(subTimelineEditorSource).toContain('style={{ left: left - 5, top: -1 }}');
    expect(subTimelineEditorSource).toContain('style={{ left: right - 5, right: "auto", top: -1 }}');
    expect(subTimelineEditorSource).toContain("event.stopPropagation();");
  });

  it("renders an inert lock marker in the center of a boundary-locked lyric segment", () => {
    expect(subTimelineEditorSource).toContain('data-boundary-locked={boundaryLocked || undefined}');
    expect(subTimelineEditorSource).toContain('className="lyrics-segment-boundary-lock"');
    expect(subTimelineEditorSource).toContain('aria-hidden="true"');
  });
});

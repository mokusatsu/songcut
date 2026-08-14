import { describe, expect, it } from "vitest";

import {
  DISPLAY_ELEMENT_BLANK_DURATION_SECONDS,
  activeDisplayElementId,
  addBlankDisplayElementLeft,
  addBlankDisplayElementRight,
  commitDisplayElementBoundary,
  deleteDisplayElement,
  displayElementPercentRange,
  editDisplayElementText,
  isDisplayElementBoundaryLocked,
  isDisplayElementLineBoundaryEditable,
  mergeDisplayElementRight,
  previewDisplayElementBoundary,
  retimeDisplayElementsForLine,
  retimeSegmentForLineBoundaryPreview,
} from "@/lib/displayElements";
import { validateSubtitleState, type DisplayElement, type LyricsSegment } from "@/lib/subtitles";

function element(id: string, text: string, start: number, end: number): DisplayElement {
  return {
    stable_id: id,
    text,
    start,
    end,
    confidence: 0.9,
    source: text ? "mms-ctc" : "blank",
    source_start: 0,
    source_end: text.length,
    pronunciation: text,
    token_start: 0,
    token_end: text.length,
    origin_key: `origin-${id}`,
    manual_start: false,
    manual_end: false,
    manual_structure: false,
    parent_revision: 2,
    conflict: null,
    orphaned_manual: false,
  };
}

function segment(): LyricsSegment {
  return {
    id: "line-1",
    text: "あいう",
    start: 10,
    end: 11,
    confidence: 0.9,
    source: "lyrics",
    low_confidence_outlier: false,
    user_edited: false,
    display_element_revision: 2,
    display_elements: [
      element("a", "あ", 10, 10.4),
      element("b", "い", 10.4, 10.7),
      element("c", "う", 10.7, 11),
    ],
  };
}

describe("display element editing", () => {
  it("normalizes the selected line to exactly 100 percent", () => {
    const value = segment();
    const first = displayElementPercentRange(value, value.display_elements![0]);
    const last = displayElementPercentRange(value, value.display_elements![2]);
    expect(first.left).toBe(0);
    expect(first.width).toBeCloseTo(40);
    expect(last.left).toBeCloseTo(70);
    expect(last.width).toBeCloseTo(30);
  });

  it("moves only a shared boundary and clamps both sides to 1ms", () => {
    const value = segment();
    const preview = previewDisplayElementBoundary(value, 0, 10.9)!;
    expect(preview[0].end).toBeCloseTo(10.699, 6);
    expect(preview[1].start).toBeCloseTo(10.699, 6);
    expect(preview[0].manual_end).toBe(true);
    expect(preview[1].manual_start).toBe(true);
    expect(preview[1].end - preview[1].start).toBeCloseTo(0.001, 6);

    const committed = commitDisplayElementBoundary(value, 0, 10.5)!;
    expect(committed.revision).toBe(3);
    expect(committed.boundaryLocked).toBe(true);
    expect(committed.elements.every((item) => item.parent_revision === 3)).toBe(true);
    expect(committed.elements[0].end).toBe(committed.elements[1].start);
  });

  it("merges right while preserving the left stable ID", () => {
    const merged = mergeDisplayElementRight(segment(), "b")!;
    expect(merged.selectedId).toBe("b");
    expect(merged.elements.map((item) => item.stable_id)).toEqual(["a", "b"]);
    expect(merged.elements[1]).toMatchObject({
      text: "いう",
      start: 10.4,
      end: 11,
      source: "manual",
      manual_start: true,
      manual_end: true,
      manual_structure: true,
    });
  });

  it("cuts exactly 100ms from a 101ms-or-longer element into a selected manual blank", () => {
    const updated = addBlankDisplayElementRight(segment(), "b", () => "blank-new")!;
    const blank = updated.elements[2];
    expect(updated.selectedId).toBe("blank-new");
    expect(blank).toMatchObject({
      stable_id: "blank-new",
      text: "",
      source: "manual",
      manual_structure: true,
    });
    expect(blank.end - blank.start).toBeCloseTo(DISPLAY_ELEMENT_BLANK_DURATION_SECONDS, 6);
    expect(updated.elements[1].end).toBe(blank.start);
  });

  it("rejects a blank split when the selected element cannot leave 1ms", () => {
    const value = segment();
    value.display_elements = [element("short", "あ", 10, 10.1), element("rest", "い", 10.1, 11)];
    expect(addBlankDisplayElementRight(value, "short", () => "blank")).toBeNull();
  });

  it("cuts exactly 100ms from the start into a selected manual blank", () => {
    const updated = addBlankDisplayElementLeft(segment(), "b", () => "blank-left")!;
    expect(updated.selectedId).toBe("blank-left");
    expect(updated.elements.map((item) => item.stable_id)).toEqual(["a", "blank-left", "b", "c"]);
    expect(updated.elements[1]).toMatchObject({
      stable_id: "blank-left",
      text: "",
      source: "manual",
      manual_start: true,
      manual_end: true,
      manual_structure: true,
    });
    expect(updated.elements[2]).toMatchObject({ manual_start: true, start: 10.5, end: 10.7 });
    expect(updated.elements[1].end - updated.elements[1].start).toBeCloseTo(
      DISPLAY_ELEMENT_BLANK_DURATION_SECONDS,
      6,
    );
    expect(updated.elements.every((item, index) => (
      index === 0 || item.start === updated.elements[index - 1].end
    ))).toBe(true);
    expect(updated.elements.every((item) => item.end - item.start >= 0.001 - 1e-6)).toBe(true);
    expect(updated.elements.every((item) => item.parent_revision === updated.revision)).toBe(true);
  });

  it("rejects a left blank split when the selected element cannot leave 1ms or the ID is duplicated", () => {
    const value = segment();
    value.display_elements = [element("short", "あ", 10, 10.1), element("rest", "い", 10.1, 11)];
    expect(addBlankDisplayElementLeft(value, "short", () => "blank")).toBeNull();

    expect(addBlankDisplayElementLeft(segment(), "b", () => "a")).toBeNull();
  });

  it("deletes the first element into the right neighbor", () => {
    const updated = deleteDisplayElement(segment(), "a")!;
    expect(updated.selectedId).toBe("b");
    expect(updated.elements.map((item) => item.stable_id)).toEqual(["b", "c"]);
    expect(updated.elements[0]).toMatchObject({
      start: 10,
      end: 10.7,
      source: "manual",
      manual_start: true,
      manual_structure: true,
    });
    expect(updated.elements[0].origin_key).toContain("manual-delete");
  });

  it("deletes a middle element into the right neighbor and marks the shared boundary", () => {
    const updated = deleteDisplayElement(segment(), "b")!;
    expect(updated.selectedId).toBe("c");
    expect(updated.elements.map((item) => item.stable_id)).toEqual(["a", "c"]);
    expect(updated.elements[0].end).toBe(updated.elements[1].start);
    expect(updated.elements[0]).toMatchObject({ end: 10.4, manual_end: true });
    expect(updated.elements[1]).toMatchObject({
      start: 10.4,
      end: 11,
      source: "manual",
      manual_start: true,
      manual_structure: true,
    });
  });

  it("deletes the final element into the left neighbor", () => {
    const updated = deleteDisplayElement(segment(), "c")!;
    expect(updated.selectedId).toBe("b");
    expect(updated.elements.map((item) => item.stable_id)).toEqual(["a", "b"]);
    expect(updated.elements[1]).toMatchObject({
      start: 10.4,
      end: 11,
      source: "manual",
      manual_end: true,
      manual_structure: true,
    });
  });

  it("rejects deleting an unknown or sole element", () => {
    expect(deleteDisplayElement(segment(), "missing")).toBeNull();
    const value = segment();
    value.display_elements = [element("only", "あ", 10, 11)];
    expect(deleteDisplayElement(value, "only")).toBeNull();
  });

  it("keeps a continuous partition and revision metadata after deletion", () => {
    const updated = deleteDisplayElement(segment(), "b")!;
    expect(updated.elements[0].start).toBe(10);
    expect(updated.elements.at(-1)?.end).toBe(11);
    expect(updated.elements.every((item, index) => (
      index === 0 || item.start === updated.elements[index - 1].end
    ))).toBe(true);
    expect(updated.elements.every((item, index) => item.index === index)).toBe(true);
    expect(updated.elements.every((item) => item.parent_revision === updated.revision)).toBe(true);
  });

  it("edits text without trimming and preserves the stable ID and time range", () => {
    const value = segment();
    const original = value.display_elements![1];
    const updated = editDisplayElementText(value, "b", "  変更  ")!;
    expect(updated.selectedId).toBe("b");
    expect(updated.elements[1]).toMatchObject({
      stable_id: "b",
      text: "  変更  ",
      start: original.start,
      end: original.end,
      source: "manual",
      manual_structure: true,
    });
    expect(updated.elements[1].origin_key).toContain("manual-text");

    const blank = editDisplayElementText(value, "b", "")!;
    expect(blank.elements[1]).toMatchObject({ text: "", source: "manual", manual_structure: true });
    expect(editDisplayElementText(value, "b", "い")).toBeNull();
    expect(editDisplayElementText(value, "missing", "x")).toBeNull();
  });

  it("retimes a continuous automatic partition with changed line bounds", () => {
    const resized = retimeDisplayElementsForLine(segment(), 9.8, 11.2)!;
    expect(resized[0].start).toBe(9.8);
    expect(resized.at(-1)?.end).toBe(11.2);
    expect(resized[0].end).toBe(resized[1].start);
    expect(resized[1].end).toBe(resized[2].start);
    expect(resized.every((item) => item.end - item.start >= 0.001 - 1e-6)).toBe(true);
  });

  it("redistributes manual elements after the user explicitly unlocks the line boundary", () => {
    const value = segment();
    value.display_elements![1] = {
      ...value.display_elements![1],
      source: "manual",
      manual_start: true,
      manual_end: true,
      manual_structure: true,
    };
    value.display_element_boundary_locked = false;
    const resized = retimeDisplayElementsForLine(value, 9.8, 11.2)!;
    expect(resized[0].start).toBe(9.8);
    expect(resized.at(-1)?.end).toBe(11.2);
    expect(resized[1].start).not.toBe(10.4);
    expect(resized[1]).toMatchObject({ source: "manual", manual_structure: true });
  });

  it("rejects nonblank line boundary changes while the display-element lock is on", () => {
    const value = segment();
    value.display_element_boundary_locked = true;
    expect(retimeDisplayElementsForLine(value, 9.9, 11)).toBeNull();
    expect(retimeDisplayElementsForLine(value, 10, 11.1)).toBeNull();
    expect(isDisplayElementBoundaryLocked(value)).toBe(true);
    expect(isDisplayElementLineBoundaryEditable(value, "start")).toBe(false);
    expect(isDisplayElementLineBoundaryEditable(value, "end")).toBe(false);
  });

  it("lets locked line boundaries consume or extend only contiguous edge blanks", () => {
    const value = segment();
    value.display_element_boundary_locked = true;
    value.display_elements = [
      element("blank-start-a", "", 10, 10.1),
      element("blank-start-b", "", 10.1, 10.2),
      element("text", "あ", 10.2, 10.8),
      element("blank-end", "", 10.8, 11),
    ];
    expect(isDisplayElementLineBoundaryEditable(value, "start")).toBe(true);
    expect(isDisplayElementLineBoundaryEditable(value, "end")).toBe(true);

    const resized = retimeDisplayElementsForLine(value, 10.15, 10.9)!;
    expect(resized[0].start).toBe(10.15);
    expect(resized[1].end).toBe(10.2);
    expect(resized[2]).toMatchObject({ start: 10.2, end: 10.8, text: "あ" });
    expect(resized[3]).toMatchObject({ start: 10.8, end: 10.9, text: "" });
    expect(resized.every((item, index) => index === 0 || item.start === resized[index - 1].end)).toBe(true);

    expect(retimeDisplayElementsForLine(value, 10.198, 10.801)).not.toBeNull();
    expect(retimeDisplayElementsForLine(value, 10.1981, 11)).toBeNull();
    expect(retimeDisplayElementsForLine(value, 10, 10.8009)).toBeNull();
  });

  it("treats an all-blank locked line as freely resizable and missing lock state as off", () => {
    const value = segment();
    value.display_elements = [
      element("blank-a", "", 10, 10.5),
      element("blank-b", "", 10.5, 11),
    ];
    value.display_element_boundary_locked = true;
    const resized = retimeDisplayElementsForLine(value, 9.5, 11.5)!;
    expect(resized[0].start).toBe(9.5);
    expect(resized.at(-1)?.end).toBe(11.5);
    expect(isDisplayElementLineBoundaryEditable(value, "start")).toBe(true);
    expect(isDisplayElementLineBoundaryEditable(value, "end")).toBe(true);

    delete value.display_element_boundary_locked;
    expect(isDisplayElementBoundaryLocked(value)).toBe(false);
  });

  it("keeps the Sub state valid while a line boundary preview is in flight", () => {
    const source = segment();
    const preview = retimeSegmentForLineBoundaryPreview(source, {
      ...source,
      start: 10.1,
      user_edited: true,
    });
    expect(preview?.display_elements?.[0].start).toBe(10.1);
    expect(preview?.display_elements?.at(-1)?.end).toBe(11);
    expect(validateSubtitleState({
      lanes: [{
        id: "lane-1",
        name: "Lyrics 1",
        style: {
          font_name: "Arial",
          font_size: 48,
          primary_color: "#ffffff",
          secondary_color: "#ffffff",
          outline_color: "#000000",
          back_color: "#000000",
          bold: false,
          italic: false,
          outline: 2,
          shadow: 0,
          alignment: 2,
          margin_l: 20,
          margin_r: 20,
          margin_v: 20,
        },
        effect: { type: "none", duration: 0, params: {} },
        segments: [preview!],
      }],
      active_lane_id: "lane-1",
      selected_segment_id: source.id,
      tempo_bpm: null,
      beat_times: [],
      rhythm_grid: [],
      beat_warning: null,
      confidence_statistics: null,
      analysis_algorithm: "songcut-standard",
    })).not.toBeNull();
  });
});

describe("display element playback", () => {
  it("keeps active playback distinct at shared and final boundaries", () => {
    const elements = segment().display_elements!;
    expect(activeDisplayElementId(elements, 10.2)).toBe("a");
    expect(activeDisplayElementId(elements, 10.4)).toBe("b");
    expect(activeDisplayElementId(elements, 11)).toBe("c");
    expect(activeDisplayElementId(elements, 11.1)).toBeNull();
  });
});

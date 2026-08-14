import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DisplayElementInspector,
  displayElementDeleteNeedsConfirmation,
  type DisplayElementInspectorLabels,
} from "@/components/DisplayElementInspector";
import type { DisplayElement, LyricsSegment } from "@/lib/subtitles";

const labels: DisplayElementInspectorLabels = {
  empty: "No timing",
  blank: "Blank",
  zoomEdit: "Zoom edit",
  zoomDisabled: "No timed elements",
  lockBoundaries: "Lock boundaries",
  unlockBoundaries: "Unlock boundaries",
  mergeRight: "Merge right",
  mergeDisabled: "No right neighbor",
  addBlankLeft: "Add blank left",
  addBlankRight: "Add blank right",
  addBlankDisabled: "Needs 101ms",
  deleteElement: "Delete element",
  deleteDisabled: "Cannot delete element",
  deleteConfirm: "Delete text element?",
  editText: "Edit element text",
  timeline: "Line element timeline",
  list: "Element list",
  boundary: "Drag boundary",
};

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
    origin_key: id,
    manual_start: false,
    manual_end: false,
    manual_structure: false,
    parent_revision: 1,
    conflict: null,
    orphaned_manual: false,
  };
}

function segment(elements?: DisplayElement[]): LyricsSegment {
  return {
    id: "line",
    text: "AB",
    start: 10,
    end: 11,
    confidence: 1,
    source: "lyrics",
    low_confidence_outlier: false,
    user_edited: false,
    display_element_revision: elements ? 1 : undefined,
    display_elements: elements,
  };
}

function render(segmentValue: LyricsSegment, currentTime = 10.25, zoom = false) {
  return renderToStaticMarkup(
    <DisplayElementInspector
      segment={segmentValue}
      currentTime={currentTime}
      labels={labels}
      onPreview={() => undefined}
      onCancel={() => undefined}
      onCommit={() => undefined}
      onBoundaryLockChange={() => undefined}
      onOpenZoom={zoom ? () => undefined : undefined}
    />,
  );
}

describe("DisplayElementInspector", () => {
  it("uses a 100% selected-line timeline and distinct selected, active, and blank states", () => {
    const markup = render(segment([
      element("a", "A", 10, 10.5),
      element("blank", "", 10.5, 10.7),
      element("b", "B", 10.7, 11),
    ]));
    expect(markup).toContain("Line element timeline");
    expect(markup).toContain("left:0%;width:50%");
    expect(markup).toContain("left:50%;width:19.99999999999993%");
    expect(markup).toContain("display-element-block selected active");
    expect(markup).toContain("display-element-block blank");
    expect(markup).toContain("aria-label=\"Drag boundary\"");
    expect(markup).toContain("display-element-list-scroll");
    expect(markup).toContain("display-element-list-scroll-viewport");
  });

  it("exposes icon operations with labels, tooltip reasons, and the legacy empty state", () => {
    const one = render(segment([element("only", "A", 10, 11)]), 10.25, true);
    expect(one).toContain("aria-label=\"Zoom edit\"");
    expect(one).toContain("aria-label=\"Lock boundaries\"");
    expect(one).toContain("aria-pressed=\"false\"");
    expect(one.indexOf("aria-label=\"Lock boundaries\"")).toBeLessThan(one.indexOf("aria-label=\"Zoom edit\""));
    expect(one.indexOf("aria-label=\"Zoom edit\"")).toBeLessThan(one.indexOf("aria-label=\"Merge right\""));
    expect(one).toContain("aria-label=\"Merge right\"");
    expect(one).toContain("title=\"No right neighbor\"");
    expect(one).toContain("aria-label=\"Add blank left\"");
    expect(one).toContain("aria-label=\"Add blank right\"");
    expect(one).toContain("aria-label=\"Delete element\"");
    expect(one).toContain("title=\"Cannot delete element\"");
    expect(one.indexOf("aria-label=\"Merge right\"")).toBeLessThan(one.indexOf("aria-label=\"Add blank left\""));
    expect(one.indexOf("aria-label=\"Add blank left\"")).toBeLessThan(one.indexOf("aria-label=\"Add blank right\""));
    expect(one.indexOf("aria-label=\"Add blank right\"")).toBeLessThan(one.indexOf("aria-label=\"Delete element\""));
    expect(one).toContain("lucide-arrow-left-to-line");
    expect(one).toContain("lucide-arrow-right-to-line");
    expect(one).not.toContain("title=\"Needs 101ms\"");
    const empty = render(segment(), 10.25, true);
    expect(empty).toContain("No timing");
    expect(empty).toContain("title=\"No timed elements\"");
  });

  it("shows the common lock action as pressed for an explicitly locked line", () => {
    const value = segment([element("a", "A", 10, 11)]);
    value.display_element_boundary_locked = true;
    const markup = render(value, 10.25, true);
    expect(markup).toContain("aria-label=\"Unlock boundaries\"");
    expect(markup).toContain("aria-pressed=\"true\"");
    expect(markup).toContain("lucide-lock");
  });

  it("shows a clamped playhead when the shared editor is used in the zoom dialog", () => {
    const markup = renderToStaticMarkup(
      <DisplayElementInspector
        segment={segment([element("a", "A", 10, 11)])}
        currentTime={10.4}
        labels={labels}
        onPreview={() => undefined}
        onCancel={() => undefined}
        onCommit={() => undefined}
        showPlayhead
        timelineRange={{ start: 8, end: 13 }}
      />,
    );
    expect(markup).toContain("display-element-playhead");
    expect(markup).toContain("left:40%;width:20%");
    expect(markup).toContain("var(--display-element-zoom-playhead-percent, 48.00000000000001%)");
  });

  it("requires delete confirmation only when an element contains text", () => {
    expect(displayElementDeleteNeedsConfirmation(element("text", "A", 10, 10.5))).toBe(true);
    expect(displayElementDeleteNeedsConfirmation(element("blank", "", 10, 10.5))).toBe(false);
  });
});

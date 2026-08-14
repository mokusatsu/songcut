import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SegmentInspector,
  createSegmentInspectorTimingDraft,
  resetSegmentInspectorTimingDraft,
  resolveSegmentInspectorTimingCommit,
  shouldCommitSegmentInspectorEnter,
  type SegmentInspectorLabels,
} from "@/components/SegmentInspector";

const labels: SegmentInspectorLabels = {
  noSelection: "Select a segment",
  multipleSelection: "Multiple segments selected",
  timeline: "Timeline",
  timing: "Timing",
  style: "Style",
  displayElements: "Display elements",
  start: "Start",
  end: "End",
  duration: "Duration",
  specification: "Specification",
  durationMode: "Duration",
  endMode: "End time",
};

const cutSegment = { id: "cut-1", start: 1, end: 2 };
const subSegment = { id: "sub-1", start: 1, end: 2 };

function inspectorMarkup(mode: "cut" | "sub", segment: typeof cutSegment | null = mode === "cut" ? cutSegment : subSegment) {
  return renderToStaticMarkup(
    <SegmentInspector
      mode={mode}
      segment={segment}
      mediaDuration={10}
      labels={labels}
      onTimingCommit={() => undefined}
      style={mode === "sub" ? <div>style controls</div> : undefined}
      timeline={mode === "sub" ? <div>timeline controls</div> : undefined}
    />,
  );
}

describe("SegmentInspector rendering contract", () => {
  it("renders only the supplied no-selection message when selection is null", () => {
    const markup = inspectorMarkup("cut", null);
    expect(markup).toContain("Select a segment");
    expect(markup).not.toContain("Timing");
    expect(markup).not.toContain("segment-inspector-header");
  });

  it("exposes independent WAI-ARIA accordion controls without Tabs", () => {
    const cutMarkup = inspectorMarkup("cut");
    expect(cutMarkup).toContain("segment-inspector-header");
    expect(cutMarkup).toContain("aria-expanded=\"true\"");
    expect(cutMarkup).toContain("aria-controls=");
    expect(cutMarkup).toContain("role=\"region\"");
    expect(cutMarkup).not.toContain("tabs");

    const subMarkup = inspectorMarkup("sub");
    expect((subMarkup.match(/class=\"segment-inspector-header\"/g) ?? []).length).toBe(4);
    expect(subMarkup).toContain("timeline controls");
    expect(subMarkup).toContain("Display elements");
    expect(subMarkup).toContain("style controls");
    expect(subMarkup).not.toContain("Tabs");
  });

  it("limits multi-selection sections by mode", () => {
    const cutMarkup = renderToStaticMarkup(
      <SegmentInspector
        mode="cut"
        segment={cutSegment}
        selectionCount={2}
        mediaDuration={10}
        labels={labels}
        onTimingCommit={() => undefined}
      />,
    );
    expect(cutMarkup).toContain("Multiple segments selected");
    expect(cutMarkup).not.toContain("segment-inspector-header");

    const subMarkup = renderToStaticMarkup(
      <SegmentInspector
        mode="sub"
        segment={subSegment}
        selectionCount={2}
        mediaDuration={10}
        labels={labels}
        onTimingCommit={() => undefined}
        timeline={<div>timeline controls</div>}
        style={<div>style controls</div>}
      />,
    );
    expect((subMarkup.match(/class=\"segment-inspector-header\"/g) ?? []).length).toBe(2);
    expect(subMarkup).toContain("Timeline");
    expect(subMarkup).toContain("Style");
    expect(subMarkup).not.toContain("Timing");
    expect(subMarkup).not.toContain("Display elements");
  });
});

describe("SegmentInspector timing draft contract", () => {
  it("resets local strings when selection changes", () => {
    const first = createSegmentInspectorTimingDraft({ start: 1, end: 2 });
    const second = resetSegmentInspectorTimingDraft({ start: 3.5, end: 4.75 });
    expect(first.startInput).toBe("0:01.000");
    expect(first.extentInput).toBe("0:01.000");
    expect(second).toMatchObject({
      startInput: "0:03.500",
      extentInput: "0:01.250",
      rangeMode: "duration",
    });
  });

  it("accepts a valid draft for blur and non-IME Enter commits", () => {
    const draft = createSegmentInspectorTimingDraft(cutSegment);
    const resolved = resolveSegmentInspectorTimingCommit({
      draft: { ...draft, startInput: "0:02.000", extentInput: "0:01.000" },
      mode: "cut",
      mediaDuration: 10,
    });
    expect(resolved).toEqual({ start: 2, end: 3 });
    expect(shouldCommitSegmentInspectorEnter({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(true);
    expect(shouldCommitSegmentInspectorEnter({ key: "Enter", isComposing: true, keyCode: 13 })).toBe(false);
    expect(shouldCommitSegmentInspectorEnter({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(false);
  });

  it("does not resolve invalid drafts, and Escape restores without a commit", () => {
    const invalid = resolveSegmentInspectorTimingCommit({
      draft: { ...createSegmentInspectorTimingDraft(cutSegment), extentInput: "not-a-time" },
      mode: "cut",
      mediaDuration: 10,
    });
    expect(invalid).toBeNull();
    expect(resetSegmentInspectorTimingDraft({ start: 1, end: 2 })).toEqual({
      startInput: "0:01.000",
      extentInput: "0:01.000",
      rangeMode: "duration",
    });
  });
});

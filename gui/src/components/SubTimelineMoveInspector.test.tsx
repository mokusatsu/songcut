import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SubTimelineMoveInspector,
  firstMovableTimeline,
} from "./SubTimelineMoveInspector";

const options = [
  { id: "lane-1", name: "Lyrics 1", disabled: true, disabledReason: "Already selected" },
  { id: "lane-2", name: "Lyrics 2", disabled: false },
];

describe("SubTimelineMoveInspector", () => {
  it("renders the compact Current/Move to row with stable DOM and ARIA contracts", () => {
    expect(firstMovableTimeline(options)).toBe("lane-2");
    const markup = renderToStaticMarkup(
      <SubTimelineMoveInspector
        selectionKey="a"
        currentTimeline="Lyrics 1"
        options={options}
        labels={{ current: "Current", target: "Move to", move: "Move", unavailable: "Unavailable" }}
        onMove={() => undefined}
      />,
    );
    expect(markup).toContain('class="segment-timeline-move"');
    expect(markup).toContain("segment-timeline-move-headings");
    expect(markup).toContain("segment-timeline-move-heading-current");
    expect(markup).toContain("segment-timeline-move-heading-target");
    expect(markup).toContain('role="group"');
    expect(markup).toMatch(/aria-labelledby="[^"]+ [^"]+"/);
    expect(markup).toContain("Lyrics 1");
    expect(markup).toContain("Lyrics 2");
    expect(markup).toContain("Current");
    expect(markup).toContain("Move to");
    expect(markup).toContain("segment-timeline-current-name");
    expect(markup).toContain("segment-timeline-move-arrow");
    expect(markup).toContain("segment-timeline-move-select");
    expect(markup).toContain("segment-timeline-move-button");
    expect(markup).toContain("Move");
    expect(markup).toContain("value=\"lane-2\"");
  });

  it("keeps the disabled reason and accessible description when no target is movable", () => {
    const unavailableOptions = options.map((option) => ({ ...option, disabled: true }));
    expect(firstMovableTimeline(unavailableOptions)).toBe("");
    const markup = renderToStaticMarkup(
      <SubTimelineMoveInspector
        selectionKey="all-disabled"
        currentTimeline="Lyrics 1"
        options={unavailableOptions}
        labels={{ current: "Current", target: "Move to", move: "Move", unavailable: "No valid target" }}
        onMove={() => undefined}
      />,
    );
    expect(markup).toContain('class="segment-timeline-move-reason"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain("No valid target");
    expect(markup).toContain("aria-describedby=");
    expect(markup).toContain('disabled=""');
  });
});

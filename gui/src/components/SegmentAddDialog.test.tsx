import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  SegmentAddDialogContent,
  segmentAddPositionOptions,
} from "@/components/SegmentAddDialog";
import { initializeRendererI18n } from "@/i18n";
import { createLyricsLane, type LyricsSegment, type RhythmGridPoint } from "@/lib/subtitles";

vi.stubGlobal("crypto", { randomUUID: () => "uuid" });

const grid: RhythmGridPoint[] = Array.from({ length: 41 }, (_, index) => ({
  time: index * 0.25,
  grid: index % 4 === 0 ? "beat" : index % 2 === 0 ? "half-beat" : "quarter-beat",
  attraction_radius: 0.05,
  grid_penalty: 0,
}));

describe("SegmentAddDialog", () => {
  beforeAll(async () => {
    await initializeRendererI18n("ja");
  });

  it("offers four positions and disables before/after without a single selection", () => {
    const noSelection = segmentAddPositionOptions(false);
    const singleSelection = segmentAddPositionOptions(true);

    expect(noSelection.map((option) => option.value)).toEqual(["start", "before", "after", "playback"]);
    expect(noSelection.filter((option) => option.disabled).map((option) => option.value)).toEqual(["before", "after"]);
    expect(singleSelection.filter((option) => option.disabled)).toEqual([]);
  });

  it("renders the target timeline, position selectors, preview, and Cancel/Add actions", () => {
    const lane = createLyricsLane(2, "Lyrics 1");
    const candidate = segment("candidate", 0, 4);
    const markup = renderToStaticMarkup(
      <SegmentAddDialogContent
        lanes={[lane]}
        targetLaneId={lane.id}
        position="start"
        positionOptions={segmentAddPositionOptions(false)}
        candidate={candidate}
        busy={false}
        onTargetLaneId={() => undefined}
        onPosition={() => undefined}
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(markup).toContain("Lyrics 1");
    expect(markup).toContain("0.000");
    expect(markup).toContain("4.000");
    expect(markup).toContain("キャンセル");
    expect(markup).toContain("追加");
  });
});

function segment(id: string, start: number, end: number): LyricsSegment {
  return {
    id,
    text: id,
    start,
    end,
    confidence: 1,
    source: "manual",
    low_confidence_outlier: false,
    user_edited: true,
  };
}

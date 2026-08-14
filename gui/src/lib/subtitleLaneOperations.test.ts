import { describe, expect, it } from "vitest";

import {
  moveSubtitleSegments,
  removeSubtitleSegments,
  selectedSubtitleSegments,
} from "./subtitleLaneOperations";
import {
  createDefaultSubtitleState,
  createLyricsLane,
  type LyricsSegment,
} from "./subtitles";

describe("subtitle timeline movement", () => {
  it("returns selections in visual lane/time order", () => {
    const state = createDefaultSubtitleState();
    const second = createLyricsLane(8, "Second");
    state.lanes[0].segments = [segment("b", 2, 3), segment("a", 0, 1)];
    second.segments = [segment("c", 4, 5)];
    state.lanes.push(second);
    expect(selectedSubtitleSegments(state, new Set(["c", "a", "b"])).map(({ segment }) => segment.id))
      .toEqual(["a", "b", "c"]);
  });

  it("moves all selected segments and preserves their stable IDs", () => {
    const state = createDefaultSubtitleState();
    const second = createLyricsLane(8, "Second");
    state.lanes[0].segments = [segment("a", 0, 1), segment("b", 2, 3)];
    second.segments = [segment("c", 4, 5)];
    state.lanes.push(second);
    state.selected_segment_id = "b";

    const result = moveSubtitleSegments({
      state,
      selectedIds: new Set(["a", "b"]),
      targetLaneId: second.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.active_lane_id).toBe(second.id);
    expect(result.state.selected_segment_id).toBe("b");
    expect(result.state.lanes[0].segments).toEqual([]);
    expect(result.state.lanes[1].segments.map(({ id }) => id)).toEqual(["a", "b", "c"]);
  });

  it("rejects same-lane and overlapping moves without mutating the state", () => {
    const state = createDefaultSubtitleState();
    const second = createLyricsLane(8, "Second");
    state.lanes[0].segments = [segment("a", 0, 2)];
    second.segments = [segment("b", 1, 3)];
    state.lanes.push(second);

    expect(moveSubtitleSegments({
      state,
      selectedIds: new Set(["a"]),
      targetLaneId: state.lanes[0].id,
    })).toEqual({ ok: false, reason: "same-timeline" });
    expect(moveSubtitleSegments({
      state,
      selectedIds: new Set(["a"]),
      targetLaneId: second.id,
    })).toEqual({ ok: false, reason: "overlap" });
    expect(state.lanes[0].segments.map(({ id }) => id)).toEqual(["a"]);
    expect(state.lanes[1].segments.map(({ id }) => id)).toEqual(["b"]);
  });

  it("removes every selected segment across timelines and selects the nearest survivor", () => {
    const state = createDefaultSubtitleState();
    const second = createLyricsLane(8, "Second");
    state.lanes[0].segments = [segment("a", 0, 1), segment("b", 2, 3)];
    second.segments = [segment("c", 4, 5), segment("d", 6, 7)];
    state.lanes.push(second);
    state.selected_segment_id = "b";

    const result = removeSubtitleSegments({
      state,
      selectedIds: new Set(["b", "c"]),
    });

    expect(result.removedIds).toEqual(["b", "c"]);
    expect(result.state.lanes.flatMap((lane) => lane.segments.map(({ id }) => id))).toEqual(["a", "d"]);
    expect(result.replacement?.segment.id).toBe("d");
    expect(result.state.selected_segment_id).toBe("d");
    expect(result.state.active_lane_id).toBe(second.id);
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

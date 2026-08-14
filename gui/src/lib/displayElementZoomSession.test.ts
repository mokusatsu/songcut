import { describe, expect, it } from "vitest";

import {
  createDisplayElementZoomSession,
  displayElementZoomOpenTime,
  displayElementZoomSessionIsValid,
  resolveDisplayElementZoomTarget,
  updateDisplayElementZoomSessionRevision,
} from "@/lib/displayElementZoomSession";
import type { DisplayElement, LyricsSegment, SubtitleProjectState } from "@/lib/subtitles";

const displayElement: DisplayElement = {
  stable_id: "element",
  text: "A",
  start: 10,
  end: 12,
  confidence: 1,
  source: "mms-ctc",
  source_start: 0,
  source_end: 1,
  pronunciation: "A",
  token_start: 0,
  token_end: 1,
  origin_key: "element",
  manual_start: false,
  manual_end: false,
  manual_structure: false,
  parent_revision: 2,
  conflict: null,
  orphaned_manual: false,
};
const segment: LyricsSegment = {
  id: "line",
  text: "A",
  start: 10,
  end: 12,
  confidence: 1,
  source: "lyrics",
  low_confidence_outlier: false,
  user_edited: false,
  line_revision: 3,
  display_element_revision: 4,
  display_elements: [displayElement],
};

function state(value: LyricsSegment = segment): SubtitleProjectState {
  return {
    lanes: [{ id: "lyrics", name: "Lyrics", style: {} as never, effect: {} as never, segments: [value] }],
    active_lane_id: "lyrics",
    selected_segment_id: value.id,
    tempo_bpm: 120,
    beat_times: [],
    rhythm_grid: [],
    beat_warning: null,
    confidence_statistics: null,
  };
}

describe("display element zoom session", () => {
  const session = createDisplayElementZoomSession({
    token: 7,
    laneId: "lyrics",
    segment,
    projectEpoch: 2,
    projectIdentity: "project-a",
  });

  it("captures the target independently from later selection changes", () => {
    expect(session).not.toBeNull();
    expect(resolveDisplayElementZoomTarget({ ...state(), selected_segment_id: null }, session)?.id).toBe("line");
    expect(displayElementZoomSessionIsValid(
      { ...state(), selected_segment_id: "another" },
      session!,
      "project-a",
      2,
    )).toBe(true);
  });

  it("invalidates project/source, deletion, line range, and revision changes", () => {
    expect(displayElementZoomSessionIsValid(state(), session!, "project-b", 2)).toBe(false);
    expect(displayElementZoomSessionIsValid(state(), session!, "project-a", 3)).toBe(false);
    expect(displayElementZoomSessionIsValid({ ...state(), lanes: [] }, session!, "project-a", 2)).toBe(false);
    expect(displayElementZoomSessionIsValid(state({ ...segment, end: 13 }), session!, "project-a", 2)).toBe(false);
    expect(displayElementZoomSessionIsValid(
      state({ ...segment, display_element_revision: 5 }), session!, "project-a", 2,
    )).toBe(false);
  });

  it("accepts an immediate commit only after the captured revision is advanced", () => {
    const nextState = state({ ...segment, display_element_revision: 5 });
    const nextSession = updateDisplayElementZoomSessionRevision(session!, 5);
    expect(displayElementZoomSessionIsValid(nextState, nextSession, "project-a", 2)).toBe(true);
  });

  it("opens at the current in-range time and resets outside or at the end", () => {
    expect(displayElementZoomOpenTime(segment, 11)).toBe(11);
    expect(displayElementZoomOpenTime(segment, 9)).toBe(10);
    expect(displayElementZoomOpenTime(segment, 12)).toBe(10);
  });

  it("refuses rows without a positive range and timed elements", () => {
    expect(createDisplayElementZoomSession({
      token: 1, laneId: "lyrics", segment: { ...segment, display_elements: [] }, projectEpoch: 1, projectIdentity: "x",
    })).toBeNull();
    expect(createDisplayElementZoomSession({
      token: 1, laneId: "lyrics", segment: { ...segment, end: segment.start }, projectEpoch: 1, projectIdentity: "x",
    })).toBeNull();
  });
});

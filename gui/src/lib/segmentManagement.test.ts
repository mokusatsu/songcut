import { describe, expect, it } from "vitest";
import {
  createManualSegment,
  insertSegmentPair,
  invertSegmentChecks,
  removeSegments,
  setAllSegmentsChecked,
  sortSegmentsByStart,
} from "./segmentManagement";
import type { ExportCandidate, Segment } from "../types";

const segments: Segment[] = [segment("first", 10, 20, true), segment("second", 30, 40, false)];
const exportCandidates: ExportCandidate[] = segments.map((item) => candidate(item));

describe("segment management", () => {
  it("creates a checked manual segment at the playhead with a unique id", () => {
    const pair = createManualSegment([...segments, segment("manual-001", 0, 1, true)], 58, 60);
    expect(pair.segment).toMatchObject({ id: "manual-002", start: 58, end: 60, checked: true, source: "manual" });
    expect(pair.exportCandidate).toMatchObject({ id: "export-manual-002", start: 58, end: 60, checked: true });
  });

  it("inserts after an explicit selection and otherwise appends", () => {
    const pair = createManualSegment(segments, 5, 60);
    expect(insertSegmentPair({ segments, exportCandidates }, pair, "first").segments.map(({ id }) => id)).toEqual([
      "first",
      "manual-001",
      "second",
    ]);
    expect(insertSegmentPair({ segments, exportCandidates }, pair, null).segments.map(({ id }) => id)).toEqual([
      "first",
      "second",
      "manual-001",
    ]);
    const firstPair = createManualSegment([], 0, 60);
    expect(insertSegmentPair({ segments: [], exportCandidates: [] }, firstPair, null).segments.map(({ id }) => id)).toEqual([
      "manual-001",
    ]);
  });

  it("removes and sorts segments without losing their export candidates", () => {
    const unsorted = {
      segments: [segments[1], segments[0]],
      exportCandidates: [exportCandidates[1], exportCandidates[0]],
    };
    const sorted = sortSegmentsByStart(unsorted);
    expect(sorted.segments.map(({ id }) => id)).toEqual(["first", "second"]);
    expect(sorted.exportCandidates.map(({ id }) => id)).toEqual(["export-first", "export-second"]);
    const removed = removeSegments(sorted, new Set(["first"]));
    expect(removed.segments.map(({ id }) => id)).toEqual(["second"]);
    expect(removed.exportCandidates.map(({ id }) => id)).toEqual(["export-second"]);
  });

  it("checks, unchecks, and inverts the export selection", () => {
    expect(setAllSegmentsChecked(segments, true).every(({ checked }) => checked)).toBe(true);
    expect(setAllSegmentsChecked(segments, false).every(({ checked }) => checked === false)).toBe(true);
    expect(invertSegmentChecks(segments).map(({ checked }) => checked)).toEqual([false, true]);
  });
});

function segment(id: string, start: number, end: number, checked: boolean): Segment {
  return {
    id,
    title: id,
    start,
    end,
    start_timecode: String(start),
    end_timecode: String(end),
    duration: end - start,
    confidence: 1,
    source: "test",
    flags: [],
    user_edited: false,
    checked,
  };
}

function candidate(item: Segment): ExportCandidate {
  return {
    id: `export-${item.id}`,
    title: item.title || item.id,
    filename_stem: item.id,
    start: item.start,
    end: item.end,
    duration: item.duration,
    match_source: item.source,
    checked: item.checked !== false,
  };
}

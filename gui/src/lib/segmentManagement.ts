import { formatTime } from "@/lib/time";
import type { ExportCandidate, Segment } from "@/types";

const MIN_SEGMENT_SECONDS = 0.1;
const NEW_SEGMENT_SECONDS = 5;

export type SegmentCollection = {
  segments: Segment[];
  exportCandidates: ExportCandidate[];
};

export type SegmentPair = {
  segment: Segment;
  exportCandidate: ExportCandidate;
};

export function createManualSegment(existing: readonly Segment[], currentTime: number, sourceDuration: number): SegmentPair {
  const id = nextManualSegmentId(existing);
  const boundedDuration = Math.max(0, sourceDuration);
  const latestStart = Math.max(0, boundedDuration - MIN_SEGMENT_SECONDS);
  const start = boundedDuration > 0 ? clamp(currentTime, 0, latestStart) : Math.max(0, currentTime);
  const end = boundedDuration > 0
    ? Math.min(boundedDuration, Math.max(start + MIN_SEGMENT_SECONDS, start + NEW_SEGMENT_SECONDS))
    : start + NEW_SEGMENT_SECONDS;
  const segment: Segment = {
    id,
    title: "New Segment",
    filename_stem: id,
    start,
    end,
    start_timecode: formatTime(start),
    end_timecode: formatTime(end),
    duration: end - start,
    confidence: 1,
    source: "manual",
    match_source: "manual",
    flags: ["manual"],
    user_edited: true,
    checked: true,
  };
  return {
    segment,
    exportCandidate: candidateForSegment(segment),
  };
}

export function insertSegmentPair(
  collection: SegmentCollection,
  pair: SegmentPair,
  selectedSegmentId: string | null,
): SegmentCollection {
  const pairs = normalizedPairs(collection);
  const selectedIndex = selectedSegmentId
    ? pairs.findIndex(({ segment }) => segment.id === selectedSegmentId)
    : -1;
  pairs.splice(selectedIndex >= 0 ? selectedIndex + 1 : pairs.length, 0, pair);
  return collectionFromPairs(pairs);
}

export function removeSegments(collection: SegmentCollection, segmentIds: ReadonlySet<string>): SegmentCollection {
  return collectionFromPairs(normalizedPairs(collection).filter(({ segment }) => !segmentIds.has(segment.id)));
}

export function sortSegmentsByStart(collection: SegmentCollection): SegmentCollection {
  const pairs = normalizedPairs(collection).map((pair, index) => ({ pair, index }));
  pairs.sort((left, right) => left.pair.segment.start - right.pair.segment.start || left.index - right.index);
  return collectionFromPairs(pairs.map(({ pair }) => pair));
}

export function setAllSegmentsChecked(segments: readonly Segment[], checked: boolean) {
  return segments.map((segment) => ({ ...segment, checked }));
}

export function invertSegmentChecks(segments: readonly Segment[]) {
  return segments.map((segment) => ({ ...segment, checked: segment.checked === false }));
}

function normalizedPairs(collection: SegmentCollection): SegmentPair[] {
  return collection.segments.map((segment, index) => ({
    segment,
    exportCandidate: candidateForSegment(segment, collection.exportCandidates[index]),
  }));
}

function collectionFromPairs(pairs: readonly SegmentPair[]): SegmentCollection {
  return {
    segments: pairs.map(({ segment }) => segment),
    exportCandidates: pairs.map(({ exportCandidate }) => exportCandidate),
  };
}

function candidateForSegment(segment: Segment, candidate?: ExportCandidate): ExportCandidate {
  return {
    id: candidate?.id ?? `export-${segment.id}`,
    title: segment.title?.trim() || candidate?.title || segment.id,
    filename_stem: candidate?.filename_stem || segment.filename_stem || segment.id,
    start: segment.start,
    end: segment.end,
    duration: segment.end - segment.start,
    match_source: candidate?.match_source || segment.match_source || segment.source,
    checked: segment.checked !== false,
  };
}

function nextManualSegmentId(segments: readonly Segment[]) {
  const ids = new Set(segments.map((segment) => segment.id));
  let index = 1;
  while (ids.has(`manual-${String(index).padStart(3, "0")}`)) index += 1;
  return `manual-${String(index).padStart(3, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

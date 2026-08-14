import type { LyricsSegment, SubtitleProjectState } from "@/lib/subtitles";
import { rangesOverlap } from "@/lib/timeRange";

export type SelectedSubtitleSegment = {
  laneId: string;
  segment: LyricsSegment;
};

export type MoveSubtitleSegmentsResult =
  | { ok: true; state: SubtitleProjectState; movedCount: number }
  | { ok: false; reason: "missing-timeline" | "no-selection" | "same-timeline" | "overlap" };

export type RemoveSubtitleSegmentsResult = {
  state: SubtitleProjectState;
  removedIds: string[];
  replacement: SelectedSubtitleSegment | null;
};

/** レーン順、各レーンの開始時刻順で、選択中の歌詞セグメントを返す。 */
export function selectedSubtitleSegments(
  state: SubtitleProjectState,
  selectedIds: ReadonlySet<string>,
): SelectedSubtitleSegment[] {
  return state.lanes.flatMap((lane) => [...lane.segments]
    .sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id))
    .filter((segment) => selectedIds.has(segment.id))
    .map((segment) => ({ laneId: lane.id, segment })));
}

/** 選択集合を対象レーンへ移し、重複が生じる場合は状態を変更せず拒否する。 */
export function moveSubtitleSegments(input: {
  state: SubtitleProjectState;
  selectedIds: ReadonlySet<string>;
  targetLaneId: string;
}): MoveSubtitleSegmentsResult {
  const targetLane = input.state.lanes.find((lane) => lane.id === input.targetLaneId);
  if (!targetLane) return { ok: false, reason: "missing-timeline" };
  const selected = selectedSubtitleSegments(input.state, input.selectedIds);
  if (!selected.length) return { ok: false, reason: "no-selection" };
  if (selected.every((item) => item.laneId === input.targetLaneId)) {
    return { ok: false, reason: "same-timeline" };
  }

  const selectedIds = new Set(selected.map(({ segment }) => segment.id));
  const targetSegments = [
    ...targetLane.segments.filter((segment) => !selectedIds.has(segment.id)),
    ...selected.map(({ segment }) => segment),
  ].sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
  for (let index = 1; index < targetSegments.length; index += 1) {
    if (rangesOverlap(targetSegments[index - 1], targetSegments[index])) {
      return { ok: false, reason: "overlap" };
    }
  }

  return {
    ok: true,
    movedCount: selected.length,
    state: {
      ...input.state,
      active_lane_id: input.targetLaneId,
      lanes: input.state.lanes.map((lane) => ({
        ...lane,
        segments: lane.id === input.targetLaneId
          ? targetSegments
          : lane.segments.filter((segment) => !selectedIds.has(segment.id)),
      })),
    },
  };
}

/** 選択中セグメントを全レーンから削除し、主選択位置に最も近い残存セグメントを選ぶ。 */
export function removeSubtitleSegments(input: {
  state: SubtitleProjectState;
  selectedIds: ReadonlySet<string>;
}): RemoveSubtitleSegmentsResult {
  const ordered = input.state.lanes.flatMap((lane) => [...lane.segments]
    .sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id))
    .map((segment) => ({ laneId: lane.id, segment })));
  const validIds = new Set(ordered.map(({ segment }) => segment.id));
  const removedIds = [...input.selectedIds].filter((id) => validIds.has(id));
  if (!removedIds.length) return { state: input.state, removedIds, replacement: null };

  const removed = new Set(removedIds);
  const primaryIndex = input.state.selected_segment_id
    ? ordered.findIndex(({ segment }) => segment.id === input.state.selected_segment_id)
    : -1;
  const remaining = ordered.filter(({ segment }) => !removed.has(segment.id));
  const retainedPrimary = input.state.selected_segment_id
    ? remaining.find(({ segment }) => segment.id === input.state.selected_segment_id) ?? null
    : null;
  const replacement = retainedPrimary ?? (primaryIndex >= 0
    ? remaining[Math.min(primaryIndex, Math.max(0, remaining.length - 1))] ?? null
    : null);
  const state: SubtitleProjectState = {
    ...input.state,
    active_lane_id: replacement?.laneId ?? input.state.active_lane_id,
    selected_segment_id: replacement?.segment.id ?? null,
    lanes: input.state.lanes.map((lane) => ({
      ...lane,
      segments: lane.segments.filter((segment) => !removed.has(segment.id)),
    })),
  };
  return { state, removedIds, replacement };
}

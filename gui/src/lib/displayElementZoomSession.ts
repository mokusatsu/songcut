import type { LyricsSegment, SubtitleProjectState } from "@/lib/subtitles";

export type DisplayElementZoomSession = Readonly<{
  token: number;
  laneId: string;
  segmentId: string;
  projectEpoch: number;
  projectIdentity: string;
  start: number;
  end: number;
  lineRevision: number;
  displayElementRevision: number;
}>;

/** 単一Lyrics行を固定targetとする表示素ズームsessionを構築する。 */
export function createDisplayElementZoomSession(input: {
  token: number;
  laneId: string;
  segment: LyricsSegment;
  projectEpoch: number;
  projectIdentity: string;
}): DisplayElementZoomSession | null {
  if (!input.segment.display_elements?.length || input.segment.end <= input.segment.start) return null;
  return {
    token: input.token,
    laneId: input.laneId,
    segmentId: input.segment.id,
    projectEpoch: input.projectEpoch,
    projectIdentity: input.projectIdentity,
    start: input.segment.start,
    end: input.segment.end,
    lineRevision: input.segment.line_revision ?? 0,
    displayElementRevision: input.segment.display_element_revision ?? 0,
  };
}

/** sessionが固定したlane／行を、現在のProject状態から選択状態に依存せず取得する。 */
export function resolveDisplayElementZoomTarget(
  state: SubtitleProjectState,
  session: DisplayElementZoomSession | null,
) {
  if (!session) return null;
  return state.lanes.find((lane) => lane.id === session.laneId)
    ?.segments.find((segment) => segment.id === session.segmentId) ?? null;
}

/** Project identity、epoch、行範囲、revisionがsession作成時から変わっていないか判定する。 */
export function displayElementZoomSessionIsValid(
  state: SubtitleProjectState,
  session: DisplayElementZoomSession,
  projectIdentity: string,
  projectEpoch: number,
) {
  const segment = resolveDisplayElementZoomTarget(state, session);
  return Boolean(
    segment
    && session.projectIdentity === projectIdentity
    && session.projectEpoch === projectEpoch
    && segment.start === session.start
    && segment.end === session.end
    && (segment.line_revision ?? 0) === session.lineRevision
    && (segment.display_element_revision ?? 0) === session.displayElementRevision
  );
}

/** Dialogを開く時刻を行範囲へ制限し、範囲外または終了位置では先頭を返す。 */
export function displayElementZoomOpenTime(segment: Pick<LyricsSegment, "start" | "end">, currentTime: number) {
  return Number.isFinite(currentTime) && currentTime >= segment.start && currentTime < segment.end
    ? currentTime
    : segment.start;
}

/** 即時確定した表示素revisionを同じ固定targetのsessionへ反映する。 */
export function updateDisplayElementZoomSessionRevision(
  session: DisplayElementZoomSession,
  displayElementRevision: number,
): DisplayElementZoomSession {
  return { ...session, displayElementRevision };
}

import { TIME_RANGE_EPSILON } from "@/lib/timeRange";

export const PLAYBACK_RANGE_STOP_TOLERANCE_SECONDS = 0.02;

export type PlaybackRangeSession = Readonly<{
  generation: number;
  start: number;
  stopAt: number;
  loop: boolean;
}>;

export type PlaybackRangeState = Readonly<{
  generation: number;
  session: PlaybackRangeSession | null;
}>;

export type PlaybackRangeDecision =
  | Readonly<{ kind: "continue"; state: PlaybackRangeState }>
  | Readonly<{ kind: "stop"; state: PlaybackRangeState; time: number; generation: number }>
  | Readonly<{ kind: "loop"; state: PlaybackRangeState; time: number; generation: number }>;

/** 明示的な停止範囲を持たない初期再生状態を生成する。 */
export function createPlaybackRangeState(): PlaybackRangeState {
  return { generation: 0, session: null };
}

/** 新しい再生範囲を発行し、以前の範囲callbackをgenerationで無効化する。 */
export function beginPlaybackRange(
  state: PlaybackRangeState,
  start: number,
  stopAt: number | null,
  loop = false,
): PlaybackRangeState {
  const generation = state.generation + 1;
  if (
    stopAt === null
    || !Number.isFinite(start)
    || !Number.isFinite(stopAt)
    || stopAt <= start + TIME_RANGE_EPSILON
  ) {
    return { generation, session: null };
  }
  return {
    generation,
    session: { generation, start, stopAt, loop },
  };
}

/** 現在の再生範囲を取消し、以前の非同期callbackを無効化する。 */
export function cancelPlaybackRange(state: PlaybackRangeState): PlaybackRangeState {
  return { generation: state.generation + 1, session: null };
}

/** pauseを範囲取消とは扱わず、再開後も同じ停止位置を維持する。 */
export function preservePlaybackRangeOnPause(state: PlaybackRangeState): PlaybackRangeState {
  return state;
}

/** 現在の範囲へloop設定を適用し、範囲がなければ状態を変更しない。 */
export function setPlaybackRangeLoop(state: PlaybackRangeState, loop: boolean): PlaybackRangeState {
  if (!state.session || state.session.loop === loop) return state;
  return { ...state, session: { ...state.session, loop } };
}

/** media時刻が停止境界へ達したかを判定し、停止またはloop動作を返す。 */
export function resolvePlaybackRangeTime(
  state: PlaybackRangeState,
  currentTime: number,
  toleranceSeconds = PLAYBACK_RANGE_STOP_TOLERANCE_SECONDS,
): PlaybackRangeDecision {
  const session = state.session;
  if (
    !session
    || !Number.isFinite(currentTime)
    || currentTime < session.stopAt - Math.max(0, toleranceSeconds)
  ) {
    return { kind: "continue", state };
  }
  if (session.loop) {
    return { kind: "loop", state, time: session.start, generation: session.generation };
  }
  return {
    kind: "stop",
    state: cancelPlaybackRange(state),
    time: session.stopAt,
    generation: session.generation,
  };
}

import {
  beginPlaybackRange,
  cancelPlaybackRange,
  preservePlaybackRangeOnPause,
  type PlaybackRangeState,
} from "@/lib/playbackRange";
import { displayElementZoomOpenTime } from "@/lib/displayElementZoomSession";

export type DisplayElementZoomMedia = Pick<HTMLMediaElement, "currentTime" | "paused" | "pause" | "play">;

export type DisplayElementZoomPlaybackResult = {
  state: PlaybackRangeState;
  time: number;
};

/** Dialog open時にmediaを停止し、範囲外または終了位置を行先頭へ戻す。 */
export function openDisplayElementZoomPlayback(
  media: DisplayElementZoomMedia | null,
  state: PlaybackRangeState,
  start: number,
  end: number,
  fallbackTime: number,
): DisplayElementZoomPlaybackResult {
  const time = displayElementZoomOpenTime({ start, end }, media?.currentTime ?? fallbackTime);
  media?.pause();
  if (media) media.currentTime = time;
  return { state: cancelPlaybackRange(state), time };
}

/** Dialog close時にmediaを停止し、現在位置を変更せずrange sessionを無効化する。 */
export function closeDisplayElementZoomPlayback(
  media: DisplayElementZoomMedia | null,
  state: PlaybackRangeState,
): PlaybackRangeState {
  media?.pause();
  return cancelPlaybackRange(state);
}

/** Dialog内seekを行範囲へclampし、同じ停止境界とloop設定を再発行する。 */
export function seekDisplayElementZoomPlayback(
  media: DisplayElementZoomMedia,
  state: PlaybackRangeState,
  start: number,
  end: number,
  time: number,
  loop: boolean,
): DisplayElementZoomPlaybackResult {
  const target = Math.max(start, Math.min(end, Number.isFinite(time) ? time : start));
  media.currentTime = target;
  return { state: beginPlaybackRange(state, start, end, loop), time: target };
}

/** Dialog専用のPlay/Pauseを切り替え、Play時だけ行範囲のgeneration-aware sessionを発行する。 */
export function toggleDisplayElementZoomPlayback(
  media: DisplayElementZoomMedia,
  state: PlaybackRangeState,
  start: number,
  end: number,
  loop: boolean,
): DisplayElementZoomPlaybackResult {
  if (!media.paused) {
    media.pause();
    return { state: preservePlaybackRangeOnPause(state), time: media.currentTime };
  }
  const time = displayElementZoomOpenTime({ start, end }, media.currentTime);
  media.currentTime = time;
  const nextState = beginPlaybackRange(state, start, end, loop);
  void media.play();
  return { state: nextState, time };
}

import type { WaveformPhase } from "@/lib/useProgressiveWaveform";
import type { VideoInfo, WaveformDisplayMode, WaveformPoint } from "@/types";

/**
 * The media/timeline values shared by the Cut and Sub presentation panels.
 *
 * Mode-owned state (segments, subtitle lanes, and their actions) deliberately
 * does not belong here.  Keeping this object small gives the composition root
 * one typed boundary for the media session without introducing a store or
 * changing the existing panel interaction model.
 */
export type ModeMediaViewModel = {
  sourceAvailable: boolean;
  videoInfo: VideoInfo | null;
  waveform: WaveformPoint[];
  progressiveWaveformChunks: WaveformPoint[][];
  waveformPhase: WaveformPhase;
  waveformProgress: number;
  waveformDisplayMode: WaveformDisplayMode;
  duration: number;
  currentTime: number;
  playing: boolean;
  zoom: number;
  focusRequest: number;
  editing: boolean;
  onSeek: (time: number) => void;
  onScrub: (time: number) => void;
  onSeekingChange: (seeking: boolean) => void;
  onHandleEditingChange: (editing: boolean) => void;
};

/** Shared transport controls supplied to either mode panel. */
export type ModeTransportViewModel = {
  saveStatus: string;
  saveStatusClassName?: string;
  boundaryPreview: {
    disabled: boolean;
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
    onStart: () => void;
    onEnd: () => void;
  };
  boundaryNudge:
    | {
        kind: "seconds";
        disabled: boolean;
        value: string;
        onChange: (value: string) => void;
        onBlur: () => void;
        onLeft: () => void;
        onRight: () => void;
      }
    | {
        kind: "rhythm-grid";
        disabled: boolean;
        onLeft: () => void;
        onRight: () => void;
      };
  playback: {
    onStart: () => void;
    onPrevious: () => void;
    onPlay: () => void;
    onPause: () => void;
    onNext: () => void;
  };
  zoom: {
    value: number;
    onIn: () => void;
    onOut: () => void;
    onReset: () => void;
  };
};

/**
 * One typed object for the common panel boundary.  Mode-specific panel props
 * can spread `media`/`transport` and keep only their own domain values.
 */
export type ModePanelViewModel = {
  media: ModeMediaViewModel;
  transport: ModeTransportViewModel;
};

/**
 * Keep construction explicit at the App boundary while preserving object
 * identity for callers that memoize panel view models.
 */
/** `createModePanelViewModel`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function createModePanelViewModel(
  media: ModeMediaViewModel,
  transport: ModeTransportViewModel,
): ModePanelViewModel {
  return { media, transport };
}

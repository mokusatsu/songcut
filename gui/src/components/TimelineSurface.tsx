import type * as React from "react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditorFocus } from "@/components/ui/editor-focus";
import { TimelinePlayhead, TimelineWaveform } from "@/components/TimelineWaveform";
import { useTimelineViewport } from "@/lib/useTimelineViewport";
import type { WaveformPhase } from "@/lib/useProgressiveWaveform";
import type { WaveformAmplitudeProfile } from "@/lib/waveform";
import type { WaveformDisplayMode, WaveformPoint } from "@/types";

export type TimelineSurfaceContext = {
  width: number;
  viewportRef: React.RefObject<HTMLDivElement>;
  timeFromClientX: (clientX: number) => number;
  scrubFromClientX: (clientX: number) => void;
  stopScrubAutoScroll: () => void;
  scrollByWheel: (event: Pick<React.WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "preventDefault">) => void;
};

export type TimelineSurfaceSlot =
  | React.ReactNode
  | ((context: TimelineSurfaceContext) => React.ReactNode);

export type TimelineWheelScope = "surface" | "waveform";

/** Return whether a wheel event should be handled by the shared timeline route. */
/** `shouldRouteTimelineWheel`の入力が要求された条件やschemaを満たすか検証する。 */
export function shouldRouteTimelineWheel(
  scope: TimelineWheelScope,
  waveformTarget: boolean,
): boolean {
  return scope === "surface" || waveformTarget;
}

/** Detect a waveform descendant without requiring a browser DOM in pure tests. */
/** `isTimelineWaveformTarget`の入力が要求された条件やschemaを満たすか検証する。 */
export function isTimelineWaveformTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as { closest?: (selector: string) => unknown };
  return typeof candidate.closest === "function"
    && Boolean(candidate.closest(".timeline-waveform-surface"));
}

/** Resolve a mode-specific slot against the shared timeline viewport context. */
/** `renderTimelineSurfaceSlot`でtimeline slotを現在の表示条件に応じたReact要素へ変換する。 */
export function renderTimelineSurfaceSlot(
  slot: TimelineSurfaceSlot | undefined,
  context: TimelineSurfaceContext,
): React.ReactNode {
  return typeof slot === "function" ? slot(context) : slot;
}

type TimelineSurfaceProps = {
  duration: number;
  waveform: WaveformPoint[];
  progressiveWaveformChunks: WaveformPoint[][];
  waveformPhase: WaveformPhase;
  waveformProgress: number;
  waveformDisplayMode: WaveformDisplayMode;
  waveformAmplitudeProfile: WaveformAmplitudeProfile;
  currentTime: number;
  playing: boolean;
  zoom: number;
  focusRequest: number;
  focusRange: { start: number; end: number } | null;
  editing: boolean;
  onSeek: (time: number) => void;
  onScrub: (time: number) => void;
  onSeekingChange: (seeking: boolean) => void;
  surfaceClassName?: string;
  contentClassName?: string;
  waveformClassName?: string;
  waveformSvgClassName?: string;
  waveformBackgroundClassName?: string;
  playheadClassName?: string;
  rangeLayer?: TimelineSurfaceSlot;
  children?: TimelineSurfaceSlot;
  minimumWidth?: number;
  scrollbars?: Array<"horizontal" | "vertical">;
  scrollAreaType?: "auto" | "always" | "scroll" | "hover";
  wheelScope: TimelineWheelScope;
};

/**
 * Shared viewport shell for Cut and Sub timelines.
 *
 * Modes provide range overlays and rows through slots while this component
 * owns the scroll viewport, sizing, waveform, playhead, wheel routing, and
 * scrub/focus behavior.
 */
/** `TimelineSurface`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function TimelineSurface(props: TimelineSurfaceProps) {
  const editorFocus = useEditorFocus();
  const timelineViewport = useTimelineViewport({
    duration: props.duration,
    currentTime: props.currentTime,
    playing: props.playing,
    editing: props.editing,
    zoom: props.zoom,
    focusRequest: props.focusRequest,
    focusRange: props.focusRange,
    onScrub: props.onScrub,
    minimumWidth: props.minimumWidth,
  });
  const context: TimelineSurfaceContext = {
    width: timelineViewport.contentWidth,
    viewportRef: timelineViewport.viewportRef,
    timeFromClientX: timelineViewport.timeFromClientX,
    scrubFromClientX: timelineViewport.scrubFromClientX,
    stopScrubAutoScroll: timelineViewport.stopScrubAutoScroll,
    scrollByWheel: timelineViewport.scrollByWheel,
  };
  const handleWheel = (event: React.WheelEvent) => {
    if (!shouldRouteTimelineWheel(props.wheelScope, isTimelineWaveformTarget(event.target))) return;
    editorFocus.focusRoot();
    timelineViewport.scrollByWheel(event);
  };

  return (
    <ScrollArea
      className={props.surfaceClassName}
      viewportRef={timelineViewport.viewportRef}
      scrollbars={props.scrollbars ?? ["horizontal"]}
      type={props.scrollAreaType}
      onWheel={handleWheel}
    >
      <div className={props.contentClassName} style={{ width: context.width }}>
        <TimelinePlayhead
          currentTime={props.currentTime}
          duration={props.duration}
          className={props.playheadClassName}
        />
        <TimelineWaveform
          duration={props.duration}
          waveform={props.waveform}
          progressiveChunks={props.progressiveWaveformChunks}
          phase={props.waveformPhase}
          progress={props.waveformProgress}
          displayMode={props.waveformDisplayMode}
          amplitudeProfile={props.waveformAmplitudeProfile}
          width={context.width}
          className={props.waveformClassName}
          svgClassName={props.waveformSvgClassName}
          backgroundClassName={props.waveformBackgroundClassName}
          rangeLayer={renderTimelineSurfaceSlot(props.rangeLayer, context)}
          onSeek={props.onSeek}
          timeFromClientX={context.timeFromClientX}
          scrubFromClientX={context.scrubFromClientX}
          stopScrubAutoScroll={context.stopScrubAutoScroll}
          onSeekingChange={props.onSeekingChange}
          onInteractionStart={editorFocus.focusRoot}
        />
        {renderTimelineSurfaceSlot(props.children, context)}
      </div>
    </ScrollArea>
  );
}

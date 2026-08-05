import { memo, useEffect, useMemo, useRef } from "react";
import type * as React from "react";

import type { WaveformPhase } from "@/lib/useProgressiveWaveform";
import {
  buildWaveformPathSpecs,
  buildWaveformPyramid,
  calculateWaveformAmplitudeScale,
  selectWaveformLevel,
  type WaveformAmplitudeScale,
  type WaveformAmplitudeProfile,
} from "@/lib/waveform";
import type { WaveformDisplayMode, WaveformPoint } from "@/types";

export type TimelineWaveformProps = {
  duration: number;
  width: number;
  waveform: WaveformPoint[];
  progressiveChunks: WaveformPoint[][];
  phase: WaveformPhase;
  progress: number;
  displayMode: WaveformDisplayMode;
  amplitudeProfile: WaveformAmplitudeProfile;
  className?: string;
  svgClassName?: string;
  backgroundClassName?: string;
  rangeLayer?: React.ReactNode;
  onSeek: (time: number) => void;
  timeFromClientX: (clientX: number) => number;
  scrubFromClientX: (clientX: number) => void;
  stopScrubAutoScroll: () => void;
  onSeekingChange: (seeking: boolean) => void;
  onInteractionStart?: () => void;
  onWheelScroll?: (event: WheelEvent) => void;
};

export function TimelineWaveform(props: TimelineWaveformProps) {
  const suppressClickRef = useRef(false);
  const pointerSeekingRef = useRef(false);
  const mouseSeekingRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const waveform = svgRef.current;
    if (!waveform || !props.onWheelScroll) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      props.onWheelScroll?.(event);
    };
    waveform.addEventListener("wheel", handleWheel, { passive: false });
    return () => waveform.removeEventListener("wheel", handleWheel);
  }, [props.onWheelScroll]);

  const finishSeeking = () => {
    pointerSeekingRef.current = false;
    props.stopScrubAutoScroll();
    props.onSeekingChange(false);
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  return (
    <div
      className={`timeline-waveform-surface${props.className ? ` ${props.className}` : ""}`}
      style={{ width: props.width }}
      data-waveform-mode={props.displayMode}
      data-waveform-amplitude-profile={props.amplitudeProfile}
      data-waveform-phase={props.phase}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        props.onInteractionStart?.();
        event.preventDefault();
        suppressClickRef.current = true;
        pointerSeekingRef.current = true;
        props.onSeekingChange(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        props.scrubFromClientX(event.clientX);
      }}
      onPointerMove={(event) => {
        if ((event.buttons & 1) !== 1 || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        props.scrubFromClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        finishSeeking();
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        finishSeeking();
      }}
      onClick={(event) => {
        props.onInteractionStart?.();
        if (suppressClickRef.current) {
          event.preventDefault();
          return;
        }
        props.onSeek(props.timeFromClientX(event.clientX));
      }}
      onMouseDown={(event) => {
        if (event.button !== 0 || pointerSeekingRef.current) return;
        props.onInteractionStart?.();
        event.preventDefault();
        suppressClickRef.current = true;
        mouseSeekingRef.current = true;
        props.onSeekingChange(true);
        props.scrubFromClientX(event.clientX);
        const move = (moveEvent: MouseEvent) => {
          if (mouseSeekingRef.current) props.scrubFromClientX(moveEvent.clientX);
        };
        const up = () => {
          mouseSeekingRef.current = false;
          props.stopScrubAutoScroll();
          props.onSeekingChange(false);
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    >
      <svg
        ref={svgRef}
        className={props.svgClassName}
        width={props.width}
        height="86"
        viewBox={`0 0 ${props.width} 86`}
        preserveAspectRatio="none"
        data-waveform-mode={props.displayMode}
        data-waveform-amplitude-profile={props.amplitudeProfile}
        data-waveform-phase={props.phase}
      >
        <rect className={props.backgroundClassName ?? "timeline-waveform-background"} width={props.width} height="86" />
        {props.rangeLayer}
        {props.phase === "streaming" || props.phase === "finalizing" ? (
          <ProgressiveWaveformLayer
            duration={props.duration}
            chunks={props.progressiveChunks}
            width={props.width}
            mode={props.displayMode}
            amplitudeProfile={props.amplitudeProfile}
            finalizing={props.phase === "finalizing"}
          />
        ) : null}
        {props.phase === "ready" || props.phase === "finalizing" ? (
          <StaticWaveformLayer
            duration={props.duration}
            waveform={props.waveform}
            width={props.width}
            mode={props.displayMode}
            amplitudeProfile={props.amplitudeProfile}
            finalizing={props.phase === "finalizing"}
          />
        ) : null}
        {props.phase === "streaming" ? (
          <line
            className="waveform-progress-frontier"
            x1={Math.max(0, Math.min(1, props.progress)) * props.width}
            x2={Math.max(0, Math.min(1, props.progress)) * props.width}
            y1="4"
            y2="82"
            pointerEvents="none"
          />
        ) : null}
      </svg>
    </div>
  );
}

export function TimelinePlayhead(props: { currentTime: number; duration: number; className?: string }) {
  const safeDuration = Math.max(0.001, props.duration);
  return (
    <div
      className={`timeline-playhead${props.className ? ` ${props.className}` : ""}`}
      style={{ left: `${(props.currentTime / safeDuration) * 100}%` }}
    />
  );
}

const StaticWaveformLayer = memo(function StaticWaveformLayer(props: {
  duration: number;
  waveform: WaveformPoint[];
  width: number;
  mode: WaveformDisplayMode;
  amplitudeProfile: WaveformAmplitudeProfile;
  finalizing?: boolean;
}) {
  const pyramid = useMemo(() => buildWaveformPyramid(props.waveform), [props.waveform]);
  const selectedLevel = useMemo(
    () => selectWaveformLevel(pyramid, props.duration, props.width),
    [pyramid, props.duration, props.width]
  );
  const points = pyramid[selectedLevel] ?? [];
  const scale = useMemo(
    () => calculateWaveformAmplitudeScale(points, props.amplitudeProfile),
    [points, props.amplitudeProfile]
  );
  const paths = useMemo(
    () => buildWaveformPathSpecs(points, props.duration, props.width, props.mode, scale),
    [points, props.duration, props.width, props.mode, scale]
  );

  return (
    <g className={props.finalizing ? "waveform-static-layer is-finalizing" : "waveform-static-layer"} data-waveform-level={selectedLevel} data-waveform-points={points.length}>
      {paths.map((path) => (
        <path key={path.kind} className={`waveform-path waveform-path-${path.kind}`} data-waveform-path={path.kind} d={path.d} fill="none" stroke="#f2cf63" strokeWidth="1" opacity={path.opacity} pointerEvents="none" />
      ))}
    </g>
  );
});

const ProgressiveWaveformLayer = memo(function ProgressiveWaveformLayer(props: {
  duration: number;
  chunks: WaveformPoint[][];
  width: number;
  mode: WaveformDisplayMode;
  amplitudeProfile: WaveformAmplitudeProfile;
  finalizing: boolean;
}) {
  const scale = useMemo(
    () => calculateWaveformAmplitudeScale(props.chunks.flat(), props.amplitudeProfile),
    [props.chunks, props.amplitudeProfile]
  );
  return (
    <g className={props.finalizing ? "waveform-progressive-layer is-finalizing" : "waveform-progressive-layer"} data-waveform-chunks={props.chunks.length}>
      {props.chunks.map((chunk, index) => (
        <ProgressiveWaveformChunk key={index} points={chunk} duration={props.duration} width={props.width} mode={props.mode} scale={scale} />
      ))}
    </g>
  );
});

const ProgressiveWaveformChunk = memo(function ProgressiveWaveformChunk(props: {
  points: WaveformPoint[];
  duration: number;
  width: number;
  mode: WaveformDisplayMode;
  scale: WaveformAmplitudeScale;
}) {
  const paths = useMemo(
    () => buildWaveformPathSpecs(props.points, props.duration, props.width, props.mode, props.scale),
    [props.points, props.duration, props.width, props.mode, props.scale]
  );
  return paths.map((path) => (
    <path key={path.kind} className={`waveform-path waveform-path-${path.kind}`} data-waveform-path={`progressive-${path.kind}`} d={path.d} fill="none" stroke="#f2cf63" strokeWidth="1" opacity={path.opacity} pointerEvents="none" />
  ));
});

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { clamp } from "@/lib/time";

type FollowScrollInput = {
  scrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
  playheadX: number;
  playing: boolean;
  editing: boolean;
};

/** `timelineFollowScrollLeft`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
export function timelineFollowScrollLeft(input: FollowScrollInput): number {
  if (input.editing || input.viewportWidth <= 0 || input.contentWidth <= input.viewportWidth) {
    return input.scrollLeft;
  }
  const maximum = Math.max(0, input.contentWidth - input.viewportWidth);
  const left = input.scrollLeft;
  const right = left + input.viewportWidth;
  let target: number | null = null;
  if (input.playing) {
    if (input.playheadX > left + input.viewportWidth * 0.9) {
      target = input.playheadX - input.viewportWidth * 0.7;
    } else if (input.playheadX < left + input.viewportWidth * 0.1) {
      target = input.playheadX - input.viewportWidth * 0.3;
    }
  } else if (input.playheadX < left) {
    target = input.playheadX - input.viewportWidth * 0.3;
  } else if (input.playheadX > right) {
    target = input.playheadX - input.viewportWidth * 0.7;
  }
  return target === null ? input.scrollLeft : clamp(target, 0, maximum);
}

type FocusScrollInput = {
  scrollLeft: number;
  viewportWidth: number;
  contentWidth: number;
  segmentStartX: number;
  segmentEndX: number;
};

/** `timelineFocusScrollLeft`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
export function timelineFocusScrollLeft(input: FocusScrollInput): number {
  const segmentWidth = Math.max(0, input.segmentEndX - input.segmentStartX);
  const viewportEnd = input.scrollLeft + input.viewportWidth;
  if (
    segmentWidth <= input.viewportWidth &&
    input.segmentStartX >= input.scrollLeft &&
    input.segmentEndX <= viewportEnd
  ) {
    return input.scrollLeft;
  }
  const target =
    segmentWidth <= input.viewportWidth
      ? input.segmentStartX + segmentWidth / 2 - input.viewportWidth / 2
      : input.segmentStartX - input.viewportWidth * 0.1;
  return clamp(target, 0, Math.max(0, input.contentWidth - input.viewportWidth));
}

/** `timelineWheelScrollLeft`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
export function timelineWheelScrollLeft(
  scrollLeft: number,
  viewportWidth: number,
  contentWidth: number,
  deltaX: number,
  deltaY: number,
  deltaMode: number,
): number {
  const maximum = Math.max(0, contentWidth - viewportWidth);
  if (maximum <= 0) return scrollLeft;
  const rawDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  const multiplier = deltaMode === 1 ? 24 : deltaMode === 2 ? viewportWidth : 1;
  return clamp(scrollLeft + rawDelta * multiplier, 0, maximum);
}

type TimelineFocusRange = {
  start: number;
  end: number;
} | null;

type UseTimelineViewportOptions = {
  duration: number;
  currentTime: number;
  playing: boolean;
  editing: boolean;
  zoom: number;
  focusRequest: number;
  focusRange: TimelineFocusRange;
  onScrub: (time: number) => void;
  minimumWidth?: number;
};

type TimelineWheelEvent = Pick<
  React.WheelEvent,
  "deltaX" | "deltaY" | "deltaMode" | "preventDefault"
>;

/** `useTimelineViewport`に必要な状態、派生値、副作用をReact hookとしてまとめる。 */
export function useTimelineViewport(options: UseTimelineViewportOptions) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const handledFocusRequestRef = useRef(0);
  const dragClientXRef = useRef<number | null>(null);
  const autoScrollTimerRef = useRef<number | null>(null);
  const lastAutoScrollTimeRef = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(900);
  const minimumWidth = options.minimumWidth ?? 1;
  const contentWidth = Math.max(viewportWidth, viewportWidth * options.zoom);
  const safeDuration = Math.max(0.001, options.duration);
  const contentWidthRef = useRef(contentWidth);
  const durationRef = useRef(safeDuration);
  const onScrubRef = useRef(options.onScrub);
  contentWidthRef.current = contentWidth;
  durationRef.current = safeDuration;
  onScrubRef.current = options.onScrub;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => setViewportWidth(Math.max(minimumWidth, viewport.clientWidth));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [minimumWidth]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || options.duration <= 0) return;
    const playheadX = clamp(options.currentTime / options.duration, 0, 1) * contentWidth;
    const next = timelineFollowScrollLeft({
      scrollLeft: viewport.scrollLeft,
      viewportWidth: viewport.clientWidth,
      contentWidth: viewport.scrollWidth,
      playheadX,
      playing: options.playing,
      editing: options.editing,
    });
    if (next !== viewport.scrollLeft) viewport.scrollLeft = next;
  }, [
    options.currentTime,
    options.duration,
    options.playing,
    options.editing,
    options.zoom,
    contentWidth,
  ]);

  useLayoutEffect(() => {
    if (handledFocusRequestRef.current === options.focusRequest) return;
    const viewport = viewportRef.current;
    const range = options.focusRange;
    if (!viewport || !range || options.duration <= 0) return;
    const width = viewport.scrollWidth;
    const startX = clamp(range.start / options.duration, 0, 1) * width;
    const endX = clamp(range.end / options.duration, 0, 1) * width;
    viewport.scrollLeft = timelineFocusScrollLeft({
      scrollLeft: viewport.scrollLeft,
      viewportWidth: viewport.clientWidth,
      contentWidth: width,
      segmentStartX: startX,
      segmentEndX: endX,
    });
    handledFocusRequestRef.current = options.focusRequest;
  }, [options.focusRequest, options.focusRange?.start, options.focusRange?.end, options.duration]);

  const timeFromClientX = (clientX: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return 0;
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left + viewport.scrollLeft;
    return clamp((x / contentWidthRef.current) * durationRef.current, 0, durationRef.current);
  };

  const stopScrubAutoScroll = () => {
    if (autoScrollTimerRef.current !== null) {
      window.clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
    lastAutoScrollTimeRef.current = null;
    dragClientXRef.current = null;
  };

  const autoScrollScrub = () => {
    const viewport = viewportRef.current;
    const clientX = dragClientXRef.current;
    if (!viewport || clientX === null) {
      stopScrubAutoScroll();
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const edgeZone = 64;
    const maxSpeed = 900;
    const leftDistance = clientX - rect.left;
    const rightDistance = rect.right - clientX;
    let speed = 0;
    if (leftDistance < edgeZone) {
      const ratio = clamp((edgeZone - Math.max(0, leftDistance)) / edgeZone, 0, 1);
      speed = -maxSpeed * ratio * ratio;
    } else if (rightDistance < edgeZone) {
      const ratio = clamp((edgeZone - Math.max(0, rightDistance)) / edgeZone, 0, 1);
      speed = maxSpeed * ratio * ratio;
    }
    if (speed === 0) {
      lastAutoScrollTimeRef.current = null;
      return;
    }
    const now = window.performance.now();
    const previous = lastAutoScrollTimeRef.current ?? now - 16;
    const deltaSeconds = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    lastAutoScrollTimeRef.current = now;
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    viewport.scrollLeft = clamp(viewport.scrollLeft + speed * deltaSeconds, 0, maximum);
    onScrubRef.current(timeFromClientX(clientX));
  };

  const scrubFromClientX = (clientX: number) => {
    dragClientXRef.current = clientX;
    if (autoScrollTimerRef.current === null) {
      autoScrollTimerRef.current = window.setInterval(autoScrollScrub, 16);
    }
    autoScrollScrub();
    onScrubRef.current(timeFromClientX(clientX));
  };

  useEffect(() => stopScrubAutoScroll, []);

  const scrollByWheel = useCallback((event: TimelineWheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const next = timelineWheelScrollLeft(
      viewport.scrollLeft,
      viewport.clientWidth,
      viewport.scrollWidth,
      event.deltaX,
      event.deltaY,
      event.deltaMode,
    );
    if (next === viewport.scrollLeft) return;
    event.preventDefault();
    viewport.scrollLeft = next;
  }, []);

  return {
    viewportRef,
    viewportWidth,
    contentWidth,
    scrollByWheel,
    timeFromClientX,
    scrubFromClientX,
    stopScrubAutoScroll,
  };
}

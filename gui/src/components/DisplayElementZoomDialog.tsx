import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Pause, Play, SkipBack } from "lucide-react";

import {
  DisplayElementInspector,
  type DisplayElementInspectorLabels,
} from "@/components/DisplayElementInspector";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatTime } from "@/lib/time";
import type { DisplayElementUpdate } from "@/lib/displayElements";
import type { DisplayElement, LyricsSegment } from "@/lib/subtitles";
import {
  buildWaveformPathSpecs,
  calculateWaveformAmplitudeScale,
  cropWaveformToRange,
} from "@/lib/waveform";
import type { WaveformDisplayMode, WaveformPoint } from "@/types";

const WAVEFORM_VIEWBOX_WIDTH = 1000;
export const DISPLAY_ELEMENT_ZOOM_PADDING_SECONDS = 2;
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type DisplayElementZoomLabels = {
  title: string;
  rangeStart: string;
  play: string;
  pause: string;
  loopPlayback: string;
  waveform: string;
  waveformUnavailable: string;
  playbackUnavailable: string;
  currentTime: string;
  endTime: string;
};

export type DisplayElementZoomDialogProps = {
  open: boolean;
  segment: LyricsSegment | null;
  currentTime: number;
  playing: boolean;
  mediaRef?: RefObject<HTMLVideoElement | null>;
  mediaDuration: number;
  loop: boolean;
  canPlayback: boolean;
  waveform: readonly WaveformPoint[];
  waveformDisplayMode: WaveformDisplayMode;
  labels: DisplayElementZoomLabels;
  inspectorLabels: DisplayElementInspectorLabels;
  onClose: () => void;
  onPlayPause: () => void;
  onSeek: (absoluteTime: number) => void;
  onLoopChange: (loop: boolean) => void;
  onPreview: (elements: DisplayElement[]) => void;
  onCancel: (elements: DisplayElement[]) => void;
  onCommit: (update: DisplayElementUpdate) => void;
  onBoundaryLockChange: (locked: boolean) => void;
  onEditingEnter?: () => void;
  onEditingExitWithoutChange?: () => void;
  status?: "waiting" | "running" | "cancelling" | "stale" | "conflict" | "failed";
  statusText?: string;
  statusError?: string;
};

/** 表示素ズームDialogを共通Dialogと通常focus scopeで描画する。 */
export function DisplayElementZoomDialog(props: DisplayElementZoomDialogProps) {
  const initialFocusRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open={props.open}
      title={props.labels.title}
      onClose={props.onClose}
      className="display-element-zoom-dialog"
      initialFocusRef={initialFocusRef}
    >
      {props.segment ? (
        <DisplayElementZoomContent {...props} segment={props.segment} initialFocusRef={initialFocusRef} />
      ) : null}
    </Dialog>
  );
}

/** wide Dialog内の範囲再生、切り出しwaveform、共通表示素editorを描画する。 */
export function DisplayElementZoomContent(props: Omit<DisplayElementZoomDialogProps, "open" | "onClose"> & {
  segment: LyricsSegment;
  initialFocusRef?: RefObject<HTMLDivElement>;
}) {
  const internalContentRef = useRef<HTMLDivElement>(null);
  const contentRef = props.initialFocusRef ?? internalContentRef;
  const currentTimeRef = useRef(props.currentTime);
  currentTimeRef.current = props.currentTime;
  const viewRange = displayElementZoomRange(props.segment, props.mediaDuration);
  const duration = Math.max(0.001, viewRange.end - viewRange.start);
  const currentTime = clampDisplayElementZoomTime(viewRange, props.currentTime);
  const localTime = currentTime - viewRange.start;
  const initialPlayheadPercent = displayElementZoomPlayheadPercent(viewRange, currentTime);
  const initialPlayheadPercentRef = useRef(initialPlayheadPercent);
  const syncSmoothPlayhead = useCallback((absoluteTime: number) => {
    contentRef.current?.style.setProperty(
      "--display-element-zoom-playhead-percent",
      `${displayElementZoomPlayheadPercent(viewRange, absoluteTime)}%`,
    );
  }, [viewRange.end, viewRange.start]);
  useClientLayoutEffect(() => {
    if (!props.playing) syncSmoothPlayhead(currentTimeRef.current);
  }, [props.currentTime, props.playing, syncSmoothPlayhead]);
  useEffect(() => {
    if (!props.playing) return;
    let animationFrame = 0;
    const update = () => {
      syncSmoothPlayhead(props.mediaRef?.current?.currentTime ?? currentTimeRef.current);
      animationFrame = window.requestAnimationFrame(update);
    };
    update();
    return () => window.cancelAnimationFrame(animationFrame);
  }, [props.mediaRef, props.playing, syncSmoothPlayhead]);
  const croppedWaveform = useMemo(
    () => cropWaveformToRange(props.waveform, viewRange.start, viewRange.end),
    [props.waveform, viewRange.end, viewRange.start],
  );
  const waveformPaths = useMemo(() => {
    const scale = calculateWaveformAmplitudeScale(croppedWaveform, "adaptive");
    return buildWaveformPathSpecs(
      croppedWaveform,
      duration,
      WAVEFORM_VIEWBOX_WIDTH,
      props.waveformDisplayMode,
      scale,
    );
  }, [croppedWaveform, duration, props.waveformDisplayMode]);
  const seekFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    props.onSeek(displayElementZoomTimeFromClientX(
      viewRange,
      event.clientX,
      rect.left,
      rect.width,
    ));
  };
  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!shouldToggleDisplayElementZoomPlaybackKey({
      key: event.key,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.nativeEvent.keyCode,
      defaultPrevented: event.defaultPrevented,
      target: event.target,
    })) return;
    event.preventDefault();
    if (props.canPlayback) props.onPlayPause();
  };

  return (
    <ScrollArea
      className="display-element-zoom-scroll"
      viewportClassName="display-element-zoom-scroll-viewport"
      scrollbars={["vertical"]}
      type="auto"
      dir="ltr"
    >
      <div
        ref={contentRef}
        className="display-element-zoom-content"
        role="group"
        aria-label={props.labels.title}
        tabIndex={0}
        onKeyDown={onRootKeyDown}
        style={{
          "--display-element-zoom-playhead-percent": `${initialPlayheadPercentRef.current}%`,
        } as CSSProperties}
      >
        <div className="display-element-zoom-transport" role="group" aria-label={props.labels.title}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={props.labels.rangeStart}
            title={props.labels.rangeStart}
            onClick={() => props.onSeek(viewRange.start)}
          >
            <SkipBack size={15} aria-hidden="true" />
            {formatTime(viewRange.start)}
          </Button>
          <Button
            type="button"
            size="sm"
            aria-label={props.playing ? props.labels.pause : props.labels.play}
            title={props.canPlayback
              ? (props.playing ? props.labels.pause : props.labels.play)
              : props.labels.playbackUnavailable}
            disabled={!props.canPlayback}
            onClick={props.onPlayPause}
          >
            {props.playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            {props.playing ? props.labels.pause : props.labels.play}
          </Button>
          <dl className="display-element-zoom-times">
            <div><dt>{props.labels.currentTime}</dt><dd>{formatTime(currentTime)}</dd></div>
            <div><dt>{props.labels.endTime}</dt><dd>{formatTime(viewRange.end)}</dd></div>
          </dl>
          <label className="display-element-zoom-loop">
            <Checkbox
              checked={props.loop}
              onChange={(event) => props.onLoopChange(event.currentTarget.checked)}
            />
            <span>{props.labels.loopPlayback}</span>
          </label>
        </div>

        <div className="display-element-zoom-waveform-group">
          <span className="display-element-zoom-section-label">{props.labels.waveform}</span>
          <div className="display-element-zoom-waveform-stage">
          <svg
            className="display-element-zoom-waveform"
            role="slider"
            aria-label={props.labels.waveform}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={localTime}
            tabIndex={0}
            viewBox={`0 0 ${WAVEFORM_VIEWBOX_WIDTH} 86`}
            preserveAspectRatio="none"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              seekFromPointer(event);
            }}
            onPointerMove={(event) => {
              if ((event.buttons & 1) !== 1 || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              seekFromPointer(event);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Home") props.onSeek(viewRange.start);
              else if (event.key === "End") props.onSeek(viewRange.end);
              else if (event.key === "ArrowLeft") props.onSeek(currentTime - 0.01);
              else if (event.key === "ArrowRight") props.onSeek(currentTime + 0.01);
              else return;
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <rect className="display-element-zoom-waveform-background" width={WAVEFORM_VIEWBOX_WIDTH} height="86" />
            {waveformPaths.map((path) => (
              <path
                key={path.kind}
                className={`waveform-path waveform-path-${path.kind}`}
                d={path.d}
                fill="none"
                stroke="#f2cf63"
                strokeWidth="1"
                opacity={path.opacity}
                pointerEvents="none"
              />
            ))}
          </svg>
          <span className="display-element-zoom-waveform-playhead" aria-hidden="true" />
          {croppedWaveform.length === 0 ? (
            <p className="display-element-zoom-waveform-empty">{props.labels.waveformUnavailable}</p>
          ) : null}
          </div>
        </div>

        <div className="display-element-zoom-inspector">
          <DisplayElementInspector
            segment={props.segment}
            currentTime={currentTime}
            labels={props.inspectorLabels}
            onPreview={props.onPreview}
            onCancel={props.onCancel}
            onCommit={props.onCommit}
            onBoundaryLockChange={props.onBoundaryLockChange}
            onEditingEnter={props.onEditingEnter}
            onEditingExitWithoutChange={props.onEditingExitWithoutChange}
            status={props.status}
            statusText={props.statusText}
            statusError={props.statusError}
            showPlayhead
            timelineRange={viewRange}
          />
        </div>
      </div>
    </ScrollArea>
  );
}

/** ズーム範囲内の絶対時刻を0..100%の再生カーソル位置へ変換する。 */
export function displayElementZoomPlayheadPercent(
  range: Pick<LyricsSegment, "start" | "end">,
  time: number,
) {
  const duration = Math.max(0.001, range.end - range.start);
  return ((clampDisplayElementZoomTime(range, time) - range.start) / duration) * 100;
}

/** ズームDialogのseek時刻を対象行の絶対範囲内へ制限する。 */
export function clampDisplayElementZoomTime(range: Pick<LyricsSegment, "start" | "end">, time: number) {
  if (!Number.isFinite(time)) return range.start;
  return Math.max(range.start, Math.min(range.end, time));
}

/** waveform上のclient Xを対象行内の絶対時刻へ変換する。 */
export function displayElementZoomTimeFromClientX(
  range: Pick<LyricsSegment, "start" | "end">,
  clientX: number,
  left: number,
  width: number,
) {
  const ratio = width > 0 && Number.isFinite(clientX) ? Math.max(0, Math.min(1, (clientX - left) / width)) : 0;
  return range.start + ratio * Math.max(0, range.end - range.start);
}

/** 選択行の前後へ2秒の文脈を加え、動画端でclampしたズーム表示・再生範囲を返す。 */
export function displayElementZoomRange(
  segment: Pick<LyricsSegment, "start" | "end">,
  mediaDuration: number,
  paddingSeconds = DISPLAY_ELEMENT_ZOOM_PADDING_SECONDS,
) {
  const padding = Number.isFinite(paddingSeconds) ? Math.max(0, paddingSeconds) : 0;
  const mediaEnd = Number.isFinite(mediaDuration) && mediaDuration > 0
    ? mediaDuration
    : segment.end + padding;
  return {
    start: Math.max(0, segment.start - padding),
    end: Math.max(segment.end, Math.min(mediaEnd, segment.end + padding)),
  };
}

/** Dialog背景にfocusがあるSpaceだけを再生切替として受け付け、IMEや入力controlを除外する。 */
export function shouldToggleDisplayElementZoomPlaybackKey(event: {
  key: string;
  isComposing: boolean;
  keyCode: number;
  defaultPrevented: boolean;
  target: EventTarget | null;
}) {
  if (event.key !== " " || event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
  const target = event.target as { closest?: (selector: string) => Element | null } | null;
  if (!target || typeof target.closest !== "function") return true;
  return !target.closest([
    "button", "input", "select", "textarea", "a[href]", "[contenteditable='true']",
    "[role='button']", "[role='checkbox']", "[role='radio']", "[role='slider']", "[role='combobox']",
  ].join(","));
}

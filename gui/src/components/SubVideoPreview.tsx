import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { activeDisplayElementId } from "@/lib/displayElements";
import type { SubtitleProjectState } from "@/lib/subtitles";

export const DISPLAY_ELEMENT_PREVIEW_PIXELS_PER_SECOND = 120;
export const DISPLAY_ELEMENT_PREVIEW_OVERSCAN_PIXELS = 120;

export type SubVideoPreviewLabels = {
  controls: string;
  subtitle: string;
  displayElements: string;
};

export type DisplayElementPreviewItem = {
  key: string;
  segmentId: string;
  elementId: string;
  text: string;
  left: number;
  width: number;
  selectedSegment: boolean;
  active: boolean;
  blank: boolean;
};

export type ContainedVideoRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SubVideoPreviewLayout = {
  controls: ContainedVideoRect;
  overlay: ContainedVideoRect;
};

/** contain表示された動画の実描画矩形を親要素と動画解像度から求める。 */
export function containedVideoRect(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): ContainedVideoRect {
  if (!(containerWidth > 0) || !(containerHeight > 0)) return { left: 0, top: 0, width: 0, height: 0 };
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const scale = Math.min(containerWidth / safeWidth, containerHeight / safeHeight);
  const width = safeWidth * scale;
  const height = safeHeight * scale;
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  };
}

/** 実映像左のpillarboxへ操作部を置き、表示素には動画pane全幅を割り当てる。 */
export function subVideoPreviewLayout(
  containerWidth: number,
  containerHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): SubVideoPreviewLayout {
  const video = containedVideoRect(containerWidth, containerHeight, sourceWidth, sourceHeight);
  return {
    controls: { left: 0, top: video.top, width: video.left, height: video.height },
    overlay: { left: 0, top: video.top, width: Math.max(0, containerWidth), height: video.height },
  };
}

/** anchor時刻からmedia時刻までの差を、表示素trackへ適用する平行移動pxへ変換する。 */
export function displayElementPreviewTrackOffset(
  anchorTime: number,
  mediaTime: number,
  pixelsPerSecond = DISPLAY_ELEMENT_PREVIEW_PIXELS_PER_SECOND,
) {
  if (!Number.isFinite(anchorTime) || !Number.isFinite(mediaTime) || !(pixelsPerSecond > 0)) return 0;
  return (anchorTime - mediaTime) * pixelsPerSecond;
}

/** primary選択のLyrics Timelineを表示素プレビュー対象として返す。 */
function selectedDisplayElementPreviewLane(state: SubtitleProjectState) {
  const primaryId = state.selected_segment_id;
  if (!primaryId) return null;
  return state.lanes.find((candidate) => candidate.segments.some((segment) => segment.id === primaryId)) ?? null;
}

/** 現在時刻に対応する表示素のDOM keyをprimary選択Timelineから求める。 */
export function activeDisplayElementPreviewKey(
  state: SubtitleProjectState,
  currentTime: number,
): string | null {
  const lane = selectedDisplayElementPreviewLane(state);
  if (!lane || !Number.isFinite(currentTime)) return null;
  for (const segment of lane.segments) {
    const elements = segment.display_elements ?? [];
    const elementId = activeDisplayElementId(elements, currentTime);
    if (elementId) return `${segment.id}:${elementId}`;
  }
  return null;
}

/** Sub動画上の字幕と表示素プレビューを独立して切り替える操作部を描画する。 */
export function SubVideoPreviewControls(props: {
  subtitleVisible: boolean;
  displayElementsVisible: boolean;
  labels: SubVideoPreviewLabels;
  onSubtitleVisibleChange: (visible: boolean) => void;
  onDisplayElementsVisibleChange: (visible: boolean) => void;
}) {
  return (
    <div className="sub-video-preview-controls" role="group" aria-label={props.labels.controls}>
      <label>
        <Checkbox
          checked={props.subtitleVisible}
          onChange={(event) => props.onSubtitleVisibleChange(event.currentTarget.checked)}
        />
        <span>{props.labels.subtitle}</span>
      </label>
      <label>
        <Checkbox
          checked={props.displayElementsVisible}
          onChange={(event) => props.onDisplayElementsVisibleChange(event.currentTarget.checked)}
        />
        <span>{props.labels.displayElements}</span>
      </label>
    </div>
  );
}

/** Sub動画の実表示矩形にプレビュー操作部と表示素タイミングを重ねる。 */
export function SubVideoPreview(props: {
  state: SubtitleProjectState;
  selectedSegmentIds: ReadonlySet<string>;
  currentTime: number;
  playing: boolean;
  mediaRef: RefObject<HTMLVideoElement | null>;
  videoWidth: number;
  videoHeight: number;
  subtitleVisible: boolean;
  displayElementsVisible: boolean;
  labels: SubVideoPreviewLabels;
  onSubtitleVisibleChange: (visible: boolean) => void;
  onDisplayElementsVisibleChange: (visible: boolean) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const container = layerRef.current?.parentElement;
    if (!container) return;
    const update = () => setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const layout = subVideoPreviewLayout(
    containerSize.width,
    containerSize.height,
    props.videoWidth,
    props.videoHeight,
  );

  return (
    <div
      ref={layerRef}
      className="sub-video-preview-layer"
    >
      <div
        className="sub-video-preview-controls-region"
        style={layout.controls}
      >
        <SubVideoPreviewControls
          subtitleVisible={props.subtitleVisible}
          displayElementsVisible={props.displayElementsVisible}
          labels={props.labels}
          onSubtitleVisibleChange={props.onSubtitleVisibleChange}
          onDisplayElementsVisibleChange={props.onDisplayElementsVisibleChange}
        />
      </div>
      {props.displayElementsVisible ? (
        <div className="sub-video-preview-overlay-region" style={layout.overlay}>
          <DisplayElementPreviewOverlay
            state={props.state}
            selectedSegmentIds={props.selectedSegmentIds}
            currentTime={props.currentTime}
            viewportWidth={layout.overlay.width}
            playing={props.playing}
            mediaRef={props.mediaRef}
          />
        </div>
      ) : null}
    </div>
  );
}

/** primary選択が属するLyrics Timelineの表示素を中央再生カーソル基準のpx座標へ変換する。 */
export function buildDisplayElementPreviewItems(
  state: SubtitleProjectState,
  selectedSegmentIds: ReadonlySet<string>,
  currentTime: number,
  viewportWidth: number,
  pixelsPerSecond = DISPLAY_ELEMENT_PREVIEW_PIXELS_PER_SECOND,
  overscanPixels = DISPLAY_ELEMENT_PREVIEW_OVERSCAN_PIXELS,
): DisplayElementPreviewItem[] {
  if (!(viewportWidth > 0) || !(pixelsPerSecond > 0) || !Number.isFinite(currentTime)) return [];
  const primaryId = state.selected_segment_id;
  if (!primaryId) return [];
  const lane = selectedDisplayElementPreviewLane(state);
  if (!lane) return [];

  const halfVisibleSeconds = (viewportWidth / 2 + Math.max(0, overscanPixels)) / pixelsPerSecond;
  const visibleStart = currentTime - halfVisibleSeconds;
  const visibleEnd = currentTime + halfVisibleSeconds;
  const center = viewportWidth / 2;
  const items: DisplayElementPreviewItem[] = [];

  const segments = [...lane.segments].sort((left, right) => (
    left.start - right.start || left.end - right.end || left.id.localeCompare(right.id)
  ));
  for (const segment of segments) {
    const elements = [...(segment.display_elements ?? [])].sort((left, right) => (
      left.start - right.start || left.end - right.end || left.stable_id.localeCompare(right.stable_id)
    ));
    const activeId = activeDisplayElementId(elements, currentTime);
    for (const element of elements) {
      if (!Number.isFinite(element.start) || !Number.isFinite(element.end) || element.end <= element.start) continue;
      if (element.end < visibleStart || element.start > visibleEnd) continue;
      items.push({
        key: `${segment.id}:${element.stable_id}`,
        segmentId: segment.id,
        elementId: element.stable_id,
        text: element.text,
        left: center + (element.start - currentTime) * pixelsPerSecond,
        width: Math.max(1, (element.end - element.start) * pixelsPerSecond),
        selectedSegment: segment.id === primaryId || selectedSegmentIds.has(segment.id),
        active: activeId === element.stable_id,
        blank: element.text.length === 0 || element.source === "blank",
      });
    }
  }
  return items;
}

/** 再生中のDOM追加削除を避けるため、選択Timeline全体を安定したkey集合へ変換する。 */
export function buildStableDisplayElementPreviewItems(
  state: SubtitleProjectState,
  selectedSegmentIds: ReadonlySet<string>,
  anchorTime: number,
  viewportWidth: number,
) {
  return buildDisplayElementPreviewItems(
    state,
    selectedSegmentIds,
    anchorTime,
    viewportWidth,
    DISPLAY_ELEMENT_PREVIEW_PIXELS_PER_SECOND,
    Number.POSITIVE_INFINITY,
  );
}

/** 選択Timelineの表示素を動画中央の固定カーソルに対して時間比例で移動表示する。 */
export function DisplayElementPreviewOverlay(props: {
  state: SubtitleProjectState;
  selectedSegmentIds: ReadonlySet<string>;
  currentTime: number;
  viewportWidth: number;
  playing?: boolean;
  mediaRef?: RefObject<HTMLVideoElement | null>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef(props.currentTime);
  const anchorTimeRef = useRef(props.currentTime);
  const primaryIdRef = useRef(props.state.selected_segment_id);
  const [anchorTime, setAnchorTime] = useState(props.currentTime);
  const [activeKey, setActiveKey] = useState(() => activeDisplayElementPreviewKey(props.state, props.currentTime));
  const activeKeyRef = useRef(activeKey);
  currentTimeRef.current = props.currentTime;

  const primaryId = props.state.selected_segment_id;
  const hasPrimary = Boolean(selectedDisplayElementPreviewLane(props.state));
  const items = useMemo(() => buildStableDisplayElementPreviewItems(
    props.state,
    props.selectedSegmentIds,
    anchorTime,
    props.viewportWidth,
  ), [anchorTime, props.selectedSegmentIds, props.state, props.viewportWidth]);
  const resolveActiveKey = useCallback(
    (mediaTime: number) => activeDisplayElementPreviewKey(props.state, mediaTime),
    [props.state],
  );
  const updateActiveKey = useCallback((mediaTime: number) => {
    const nextActiveKey = resolveActiveKey(mediaTime);
    if (activeKeyRef.current === nextActiveKey) return;
    activeKeyRef.current = nextActiveKey;
    setActiveKey(nextActiveKey);
  }, [resolveActiveKey]);

  useLayoutEffect(() => {
    const selectionChanged = primaryIdRef.current !== primaryId;
    primaryIdRef.current = primaryId;
    if (props.playing && !selectionChanged) return;
    const mediaTime = props.mediaRef?.current?.currentTime ?? currentTimeRef.current;
    anchorTimeRef.current = mediaTime;
    setAnchorTime((current) => (Math.abs(current - mediaTime) > 1e-6 ? mediaTime : current));
    trackRef.current?.style.setProperty("--display-element-preview-offset", "0px");
    updateActiveKey(mediaTime);
  }, [primaryId, props.currentTime, props.mediaRef, props.playing, updateActiveKey]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let animationFrame = 0;
    const update = () => {
      const media = props.mediaRef?.current;
      const mediaTime = props.playing && media ? media.currentTime : currentTimeRef.current;
      const offset = displayElementPreviewTrackOffset(anchorTimeRef.current, mediaTime);
      track.style.setProperty("--display-element-preview-offset", `${offset}px`);
      updateActiveKey(mediaTime);
      if (props.playing) animationFrame = window.requestAnimationFrame(update);
    };
    update();
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [props.mediaRef, props.playing, updateActiveKey]);

  useLayoutEffect(() => {
    anchorTimeRef.current = anchorTime;
    const mediaTime = props.playing
      ? props.mediaRef?.current?.currentTime ?? currentTimeRef.current
      : currentTimeRef.current;
    trackRef.current?.style.setProperty(
      "--display-element-preview-offset",
      `${displayElementPreviewTrackOffset(anchorTime, mediaTime)}px`,
    );
  }, [anchorTime, props.mediaRef, props.playing]);

  if (!hasPrimary) return null;
  return (
    <div className="display-element-preview-overlay" aria-hidden="true">
      <div ref={trackRef} className="display-element-preview-track">
        {items.map((item) => (
          <div
            key={item.key}
            className={[
              "display-element-preview-card",
              item.selectedSegment ? "selected-segment" : "other-segment",
              item.key === activeKey ? "active selected" : "",
              item.blank ? "blank" : "",
            ].filter(Boolean).join(" ")}
            data-segment-id={item.segmentId}
            data-element-id={item.elementId}
            style={{ left: item.left, width: item.width }}
          >
            {item.text}
          </div>
        ))}
      </div>
      <div className="display-element-preview-cursor" />
    </div>
  );
}

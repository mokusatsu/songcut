import { useRef, useState } from "react";
import type * as React from "react";
import { Lock, Trash2 } from "lucide-react";

import { TimelineSurface } from "@/components/TimelineSurface";
import { SubtitleAlignmentIcon } from "@/components/SubtitleAlignmentIcon";
import { Button } from "@/components/ui/button";
import { useEditorActionFocusProps, useEditorFocus } from "@/components/ui/editor-focus";
import { Input } from "@/components/ui/input";
import { tr } from "@/i18n";
import {
  labelStackLevels,
  type LyricsSegment,
  type SubtitleProjectState,
} from "@/lib/subtitles";
import { clamp } from "@/lib/time";
import {
  isDisplayElementBoundaryLocked,
  isDisplayElementLineBoundaryEditable,
} from "@/lib/displayElements";
import { useBoundaryDrag } from "@/lib/useBoundaryDrag";
import type { ModeMediaViewModel } from "@/lib/modeViewModel";
import {
  segmentSelectionModifiers,
  type SegmentSelectionModifiers,
} from "@/lib/segmentSelection";

export type SubTimelineEditorProps = ModeMediaViewModel & {
  state: SubtitleProjectState;
  selectedSegment: LyricsSegment | null;
  selectedSegmentIds: ReadonlySet<string>;
  editingSegmentId: string | null;
  onEditingSegmentId: (id: string | null) => void;
  onStateChange: (state: SubtitleProjectState) => void;
  onBoundaryPreview: (
    laneId: string,
    segmentId: string,
    edge: "start" | "end",
    time: number,
  ) => void;
  onBoundaryCancel: (
    laneId: string,
    segmentId: string,
    segment: LyricsSegment,
  ) => void;
  onBoundaryEditingEnter: (laneId: string, segmentId: string) => void;
  onBoundaryCommit: (laneId: string, segmentId: string, startSegment: LyricsSegment) => void;
  onTextEditingEnter: (laneId: string, segmentId: string) => void;
  onTextCommit: (laneId: string, segmentId: string, originalText: string, text: string) => void;
  onTextEditingExitWithoutChange: (laneId: string, segmentId: string) => void;
  onStyle: (laneId: string) => void;
  onRemoveLane: (laneId: string) => void;
  onRenameLane: (laneId: string, name: string) => void;
  onSelectSegment: (
    laneId: string,
    segment: LyricsSegment,
    modifiers: SegmentSelectionModifiers,
  ) => void;
};

/** IME変換中を除き、歌詞本文入力で確定または取消になるキーだけを返す。 */
export function lyricsTextEditKeyAction(input: {
  key: string;
  isComposing: boolean;
  keyCode: number;
}): "commit" | "cancel" | null {
  if (input.isComposing || input.keyCode === 229) return null;
  if (input.key === "Enter") return "commit";
  if (input.key === "Escape") return "cancel";
  return null;
}

/** blur／Enter／Escapeの本文draftを、保存・無変更・取消へ一度だけ分類する。 */
export function resolveLyricsTextEdit(
  originalText: string,
  draft: string,
  cancelled: boolean,
): { action: "commit"; text: string } | { action: "unchanged" | "cancel" } {
  if (cancelled) return { action: "cancel" };
  const text = draft.trim();
  return text === originalText ? { action: "unchanged" } : { action: "commit", text };
}

/** IME変換中を除き、歌詞lane名入力で確定または取消になるキーだけを返す。 */
export function laneNameEditKeyAction(input: {
  key: string;
  isComposing: boolean;
  keyCode: number;
}): "commit" | "cancel" | null {
  if (input.isComposing || input.keyCode === 229) return null;
  if (input.key === "Enter") return "commit";
  if (input.key === "Escape") return "cancel";
  return null;
}

/** lane名draftを保存・無変更・取消へ一度だけ分類する。 */
export function resolveLaneNameEdit(
  originalName: string,
  draft: string,
  cancelled: boolean,
): { action: "commit"; name: string } | { action: "unchanged" | "cancel" } {
  if (cancelled) return { action: "cancel" };
  const name = draft.trim();
  if (!name) return { action: "cancel" };
  return name === originalName ? { action: "unchanged" } : { action: "commit", name };
}

const LYRICS_TRACK_TOP = 30;
const LYRICS_LABEL_TOP = 34;
const LYRICS_LEVEL_STEP = 22;
const LYRICS_LANE_BOTTOM_PADDING = 4;
const LYRICS_INPUT_HEIGHT = 42;

/** lane内の実際のstack level数から、clipしない最小高さを算出する。 */
export function lyricsLaneHeight(
  segments: readonly LyricsSegment[],
  editingLevel: number | null = null,
): number {
  const levels = labelStackLevels(segments);
  const levelCount = Math.max(1, ...[...levels.values()].map((level) => level + 1));
  const contentHeight = LYRICS_TRACK_TOP
    + LYRICS_LABEL_TOP
    + levelCount * LYRICS_LEVEL_STEP
    + LYRICS_LANE_BOTTOM_PADDING;
  if (editingLevel === null) return contentHeight;
  return Math.max(
    contentHeight,
    LYRICS_TRACK_TOP + LYRICS_LABEL_TOP + editingLevel * LYRICS_LEVEL_STEP + LYRICS_INPUT_HEIGHT + 2,
  );
}

/** Sub-only timeline surface, lane presentation, and direct segment editing. */
/** `SubTimelineEditor`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function SubTimelineEditor(props: SubTimelineEditorProps) {
  const safeDuration = Math.max(0.001, props.duration);
  const editorFocus = useEditorFocus();
  const [draggingBoundary, setDraggingBoundary] = useState<{
    laneId: string;
    segmentId: string;
    edge: "start" | "end";
  } | null>(null);
  const [editingLaneId, setEditingLaneId] = useState<string | null>(null);
  const [laneNameDraft, setLaneNameDraft] = useState("");
  const laneNameOriginalRef = useRef("");
  const laneNameFinishedRef = useRef(false);
  const laneNameComposingRef = useRef(false);

  /** ダブルクリックされたlane名をdraftへ写し、inline編集を開始する。 */
  function beginLaneNameEdit(laneId: string, name: string) {
    laneNameOriginalRef.current = name;
    laneNameFinishedRef.current = false;
    laneNameComposingRef.current = false;
    setLaneNameDraft(name);
    setEditingLaneId(laneId);
  }

  /** lane名draftを一度だけ確定または破棄し、editor focusへ戻す。 */
  function finishLaneNameEdit(cancelled: boolean) {
    if (!editingLaneId || laneNameFinishedRef.current) return;
    laneNameFinishedRef.current = true;
    const resolution = resolveLaneNameEdit(laneNameOriginalRef.current, laneNameDraft, cancelled);
    if (resolution.action === "commit") props.onRenameLane(editingLaneId, resolution.name);
    setLaneNameDraft(laneNameOriginalRef.current);
    setEditingLaneId(null);
    editorFocus.focusRoot();
  }

  return (
    <TimelineSurface
      surfaceClassName="sub-timeline-scroll"
      contentClassName="sub-timeline-content"
      duration={props.duration}
      waveform={props.waveform}
      progressiveWaveformChunks={props.progressiveWaveformChunks}
      waveformPhase={props.waveformPhase}
      waveformProgress={props.waveformProgress}
      waveformDisplayMode={props.waveformDisplayMode}
      waveformAmplitudeProfile="adaptive"
      currentTime={props.currentTime}
      playing={props.playing}
      zoom={props.zoom}
      focusRequest={props.focusRequest}
      focusRange={props.selectedSegment}
      editing={props.editing}
      onSeek={props.onSeek}
      onScrub={props.onScrub}
      onSeekingChange={props.onSeekingChange}
      playheadClassName="sub-playhead"
      waveformClassName="sub-waveform-surface"
      waveformSvgClassName="sub-waveform"
      waveformBackgroundClassName="timeline-waveform-background sub"
      scrollbars={["horizontal", "vertical"]}
      scrollAreaType="always"
      wheelScope="waveform"
      rangeLayer={({ width }) => [
        ...props.state.lanes.filter((lane) => lane.id !== props.state.active_lane_id),
        ...props.state.lanes.filter((lane) => lane.id === props.state.active_lane_id),
      ].flatMap((lane) =>
        lane.segments.map((segment) => (
          <rect
            key={`${lane.id}-${segment.id}`}
            className={`sub-waveform-segment ${
              lane.id === props.state.active_lane_id ? "active-lane" : ""
            } ${props.selectedSegmentIds.has(segment.id) ? "selected" : ""}`}
            x={(segment.start / safeDuration) * width}
            y={10}
            width={Math.max(2, ((segment.end - segment.start) / safeDuration) * width)}
            height={66}
            pointerEvents="none"
          />
        ))
      )}
    >
      {({ width }) => {
        const laneHeights = new Map(
          props.state.lanes.map((lane) => {
            const levels = labelStackLevels(lane.segments);
            const editingSegment = lane.segments.find((segment) => segment.id === props.editingSegmentId);
            const editingLevel = editingSegment ? levels.get(editingSegment.id) ?? 0 : null;
            return [lane.id, lyricsLaneHeight(lane.segments, editingLevel)] as const;
          })
        );
        const draggingLaneIndex = draggingBoundary
          ? props.state.lanes.findIndex((lane) => lane.id === draggingBoundary.laneId)
          : -1;
        const draggingLaneOffset = draggingLaneIndex > 0
          ? props.state.lanes
            .slice(0, draggingLaneIndex)
            .reduce((offset, lane) => offset + (laneHeights.get(lane.id) ?? lyricsLaneHeight(lane.segments)), 0)
          : 0;
        const draggingSegment = draggingBoundary && draggingLaneIndex >= 0
          ? props.state.lanes[draggingLaneIndex]?.segments.find(
              (segment) => segment.id === draggingBoundary.segmentId
            )
          : null;
        const draggingBoundaryX = draggingSegment && draggingBoundary
          ? ((draggingBoundary.edge === "start" ? draggingSegment.start : draggingSegment.end) / safeDuration) * width
          : null;
        return (
          <>
            {draggingBoundaryX !== null ? (
              <div
                className={`sub-boundary-drag-guide ${
                  props.selectedSegmentIds.has(draggingBoundary?.segmentId ?? "") ? "selected" : ""
                }`}
                style={{
                  left: draggingBoundaryX,
                  height: 86 + draggingLaneOffset + Math.min(
                    46,
                    laneHeights.get(draggingBoundary?.laneId ?? "") ?? 46,
                  ),
                }}
              />
            ) : null}
            {props.state.rhythm_grid.slice(0, 6000).map((point) => (
              <span
                key={`${point.time}-${point.grid}`}
                className={`rhythm-grid-line grid-${point.grid}`}
                style={{ left: `${(point.time / safeDuration) * width}px` }}
              />
            ))}
            {props.state.lanes.map((lane) => {
              const levels = labelStackLevels(lane.segments);
              const labelWidths = new Map(
                lane.segments.map((segment, index) => {
                  const level = levels.get(segment.id) ?? 0;
                  const nextAtSameLevel = lane.segments
                    .slice(index + 1)
                    .find((candidate) => (levels.get(candidate.id) ?? 0) === level);
                  const left = (segment.start / safeDuration) * width;
                  const nextLeft = nextAtSameLevel
                    ? (nextAtSameLevel.start / safeDuration) * width
                    : width;
                  return [segment.id, Math.max(20, Math.min(360, nextLeft - left - 8))];
                })
              );
              return (
                <div
                  key={lane.id}
                  className={`lyrics-lane ${lane.id === props.state.active_lane_id ? "active" : ""}`}
                  style={{ height: laneHeights.get(lane.id) ?? lyricsLaneHeight(lane.segments) }}
                  onPointerDown={() =>
                    props.onStateChange({ ...props.state, active_lane_id: lane.id })
                  }
                >
                  <div className="lyrics-lane-header">
                    {editingLaneId === lane.id ? (
                      <Input
                        autoFocus
                        className="lyrics-lane-name-input"
                        aria-label={tr("sub.renameTimeline", { name: lane.name })}
                        value={laneNameDraft}
                        onChange={(event) => setLaneNameDraft(event.target.value)}
                        onCompositionStart={() => { laneNameComposingRef.current = true; }}
                        onCompositionEnd={() => { laneNameComposingRef.current = false; }}
                        onBlur={() => finishLaneNameEdit(false)}
                        onKeyDown={(event) => {
                          const action = laneNameEditKeyAction({
                            key: event.key,
                            isComposing: event.nativeEvent.isComposing || laneNameComposingRef.current,
                            keyCode: event.keyCode,
                          });
                          if (action === "commit") {
                            event.preventDefault();
                            finishLaneNameEdit(false);
                          } else if (action === "cancel") {
                            event.preventDefault();
                            finishLaneNameEdit(true);
                          }
                        }}
                      />
                    ) : (
                      <span
                        className="lyrics-lane-name"
                        title={tr("sub.renameTimeline", { name: lane.name })}
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          beginLaneNameEdit(lane.id, lane.name);
                        }}
                      >
                        {lane.name}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      title={`Style ${lane.style.alignment}`}
                      aria-label={`Style ${lane.style.alignment}`}
                      onClick={() => props.onStyle(lane.id)}
                    >
                      Style
                      <SubtitleAlignmentIcon alignment={lane.style.alignment} />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => props.onRemoveLane(lane.id)} disabled={props.state.lanes.length <= 1}><Trash2 size={14} /></Button>
                  </div>
                  <div className="lyrics-segment-track">
                    {lane.segments.map((segment) => (
                      <LyricsSegmentView
                        key={segment.id}
                        segment={segment}
                        level={levels.get(segment.id) ?? 0}
                        labelWidth={labelWidths.get(segment.id) ?? 20}
                        width={width}
                        duration={safeDuration}
                        selected={props.selectedSegmentIds.has(segment.id)}
                        timingEditable={props.selectedSegmentIds.size === 1 && props.selectedSegmentIds.has(segment.id)}
                        editing={segment.id === props.editingSegmentId}
                        onSelect={(modifiers) => props.onSelectSegment(lane.id, segment, modifiers)}
                        onEdit={() => {
                          props.onTextEditingEnter(lane.id, segment.id);
                          props.onEditingSegmentId(segment.id);
                        }}
                        onEditCommit={(text) => {
                          props.onEditingSegmentId(null);
                          props.onTextCommit(lane.id, segment.id, segment.text, text);
                        }}
                        onEditCancel={() => {
                          props.onEditingSegmentId(null);
                          props.onTextEditingExitWithoutChange(lane.id, segment.id);
                        }}
                        onBoundaryPreview={(edge, time) =>
                          props.onBoundaryPreview(lane.id, segment.id, edge, time)
                        }
                        onBoundaryCancel={(_edge, _time, startSegment) =>
                          props.onBoundaryCancel(lane.id, segment.id, startSegment)
                        }
                        onBoundaryEditingEnter={() => props.onBoundaryEditingEnter(lane.id, segment.id)}
                        onBoundaryCommit={(startSegment) => props.onBoundaryCommit(lane.id, segment.id, startSegment)}
                        onEditingChange={props.onHandleEditingChange}
                        onDraggingBoundary={(edge) =>
                          setDraggingBoundary(
                            edge ? { laneId: lane.id, segmentId: segment.id, edge } : null
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        );
      }}
    </TimelineSurface>
  );
}

/** `LyricsSegmentView`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
function LyricsSegmentView(props: {
  segment: LyricsSegment;
  level: number;
  labelWidth: number;
  width: number;
  duration: number;
  selected: boolean;
  timingEditable: boolean;
  editing: boolean;
  onSelect: (modifiers: SegmentSelectionModifiers) => void;
  onEdit: () => void;
  onEditCommit: (text: string) => void;
  onEditCancel: () => void;
  onBoundaryPreview: (edge: "start" | "end", time: number) => void;
  onBoundaryCancel: (
    edge: "start" | "end",
    time: number,
    segment: LyricsSegment,
  ) => void;
  onBoundaryEditingEnter: () => void;
  onBoundaryCommit: (startSegment: LyricsSegment) => void;
  onEditingChange: (editing: boolean) => void;
  onDraggingBoundary: (edge: "start" | "end" | null) => void;
}) {
  const left = (props.segment.start / props.duration) * props.width;
  const right = (props.segment.end / props.duration) * props.width;
  const boundaryLocked = isDisplayElementBoundaryLocked(props.segment);
  const startBoundaryEditable = props.timingEditable
    && isDisplayElementLineBoundaryEditable(props.segment, "start");
  const endBoundaryEditable = props.timingEditable
    && isDisplayElementLineBoundaryEditable(props.segment, "end");
  const lockText = tr("segmentInspector.displayElementBoundaryLocked");
  const [draft, setDraft] = useState(props.segment.text);
  const editFinishedRef = useRef(false);
  const composingRef = useRef(false);
  const boundaryEdgeRef = useRef<"start" | "end" | null>(null);
  const boundaryStartTimeRef = useRef<number | null>(null);
  const boundaryStartSegmentRef = useRef<LyricsSegment | null>(null);
  const boundaryContentRef = useRef<HTMLElement | null>(null);
  const segmentActionFocusProps = useEditorActionFocusProps<HTMLButtonElement>((event) => {
    event.stopPropagation();
    props.onSelect(segmentSelectionModifiers(event));
  });
  const drag = useBoundaryDrag({
    onPreview: (clientX) => {
      const content = boundaryContentRef.current;
      const edge = boundaryEdgeRef.current;
      if (!content || !edge) return;
      const rect = content.getBoundingClientRect();
      const time = clamp(((clientX - rect.left) / rect.width) * props.duration, 0, props.duration);
      props.onBoundaryPreview(edge, time);
    },
    onCommit: () => {
      const startSegment = boundaryStartSegmentRef.current;
      if (startSegment) props.onBoundaryCommit(startSegment);
      clearBoundarySnapshot();
    },
    onCancel: () => {
      const edge = boundaryEdgeRef.current;
      const startTime = boundaryStartTimeRef.current;
      const startSegment = boundaryStartSegmentRef.current;
      if (edge && startTime !== null && startSegment) {
        props.onBoundaryCancel(edge, startTime, startSegment);
      }
      clearBoundarySnapshot();
    },
    onEditingChange: (editing) => {
      props.onEditingChange(editing);
      if (!editing) {
        props.onDraggingBoundary(null);
      }
    },
  });

  /** 行境界dragの開始snapshotを破棄する。 */
  function clearBoundarySnapshot() {
    boundaryEdgeRef.current = null;
    boundaryStartTimeRef.current = null;
    boundaryStartSegmentRef.current = null;
    boundaryContentRef.current = null;
  }

  /** `prepareDrag`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  function prepareDrag(edge: "start" | "end", target: EventTarget | null) {
    // Pointer-capable browsers dispatch a compatibility mousedown after
    // pointerdown. Do not let that second event clear the active drag guide.
    if (drag.isActive()) return false;
    const content = target instanceof Element
      ? target.closest(".sub-timeline-content") as HTMLElement | null
      : null;
    if (!content) return false;
    boundaryEdgeRef.current = edge;
    boundaryStartTimeRef.current = props.segment[edge];
    boundaryStartSegmentRef.current = { ...props.segment };
    boundaryContentRef.current = content;
    props.onBoundaryEditingEnter();
    props.onDraggingBoundary(edge);
    return true;
  }

  /** `beginPointerDrag`で複数段階の入力flowを次または前の状態へ遷移させる。 */
  function beginPointerDrag(event: React.PointerEvent, edge: "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    if (prepareDrag(edge, event.currentTarget) && !drag.startPointer(event)) {
      props.onDraggingBoundary(null);
      const startSegment = boundaryStartSegmentRef.current;
      if (startSegment) props.onBoundaryCancel(edge, startSegment[edge], startSegment);
      clearBoundarySnapshot();
    }
  }

  /** `beginMouseDrag`で複数段階の入力flowを次または前の状態へ遷移させる。 */
  function beginMouseDrag(event: React.MouseEvent, edge: "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    if (prepareDrag(edge, event.currentTarget) && !drag.startMouse(event)) {
      props.onDraggingBoundary(null);
      const startSegment = boundaryStartSegmentRef.current;
      if (startSegment) props.onBoundaryCancel(edge, startSegment[edge], startSegment);
      clearBoundarySnapshot();
    }
  }
  return (
    <>
      <button
        {...segmentActionFocusProps}
        type="button"
        className={`lyrics-segment ${props.selected ? "selected" : ""} ${props.segment.low_confidence_outlier ? "confidence-warning" : ""}`}
        style={{ left, width: Math.max(4, right - left) }}
        title={`${props.segment.text}\nconfidence ${props.segment.confidence.toFixed(3)}${boundaryLocked ? `\n${lockText}` : ""}`}
        aria-label={boundaryLocked ? `${props.segment.text}; ${lockText}` : props.segment.text}
        data-boundary-locked={boundaryLocked || undefined}
      >
        {boundaryLocked ? <Lock className="lyrics-segment-boundary-lock" size={14} aria-hidden="true" /> : null}
      </button>
      {startBoundaryEditable ? (
          <span
            className={`lyrics-handle start ${props.selected ? "selected" : ""}`}
            style={{ left: left - 5, top: -1 }}
            onPointerDown={(event) => beginPointerDrag(event, "start")}
            onMouseDown={(event) => beginMouseDrag(event, "start")}
            onDoubleClick={(event) => event.stopPropagation()}
          />
      ) : null}
      {endBoundaryEditable ? (
          <span
            className={`lyrics-handle end ${props.selected ? "selected" : ""}`}
            style={{ left: right - 5, right: "auto", top: -1 }}
            onPointerDown={(event) => beginPointerDrag(event, "end")}
            onMouseDown={(event) => beginMouseDrag(event, "end")}
            onDoubleClick={(event) => event.stopPropagation()}
          />
      ) : null}
      <div
        className={`lyrics-label ${props.selected ? "selected" : ""} ${props.editing ? "editing" : ""} ${props.segment.low_confidence_outlier ? "confidence-warning" : ""} ${props.segment.style_override && props.segment.effect_override ? "custom-style" : ""}`}
        style={{ left, top: LYRICS_LABEL_TOP + props.level * LYRICS_LEVEL_STEP, width: props.labelWidth }}
        onClick={(event) => props.onSelect(segmentSelectionModifiers(event))}
        onDoubleClick={(event) => {
          event.stopPropagation();
          props.onSelect({ additive: false, range: false });
          editFinishedRef.current = false;
          composingRef.current = false;
          setDraft(props.segment.text);
          props.onEdit();
        }}
      >
        <span className="lyrics-connector" />
        {props.editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onBlur={() => finishTextEdit(false)}
            onKeyDown={(event) => {
              const action = lyricsTextEditKeyAction({
                key: event.key,
                isComposing: event.nativeEvent.isComposing || composingRef.current,
                keyCode: event.keyCode,
              });
              if (action === "commit") {
                event.preventDefault();
                finishTextEdit(false);
              }
              if (action === "cancel") {
                setDraft(props.segment.text);
                finishTextEdit(true);
              }
            }}
          />
        ) : (
          props.segment.text
        )}
      </div>
    </>
  );

  /** 本文編集をcommitまたは取消として一度だけ終了する。 */
  function finishTextEdit(cancelled: boolean) {
    if (editFinishedRef.current) return;
    editFinishedRef.current = true;
    const resolution = resolveLyricsTextEdit(props.segment.text, draft, cancelled);
    if (resolution.action === "commit") props.onEditCommit(resolution.text);
    else props.onEditCancel();
  }
}

import { useRef, useState } from "react";
import type * as React from "react";
import { Trash2 } from "lucide-react";

import { TimelineSurface } from "@/components/TimelineSurface";
import { Button } from "@/components/ui/button";
import { useEditorActionFocusProps } from "@/components/ui/editor-focus";
import { Input } from "@/components/ui/input";
import {
  labelStackLevels,
  type LyricsSegment,
  type SubtitleProjectState,
} from "@/lib/subtitles";
import { clamp } from "@/lib/time";
import { useBoundaryDrag } from "@/lib/useBoundaryDrag";
import type { ModeMediaViewModel } from "@/lib/modeViewModel";

export type SubTimelineEditorProps = ModeMediaViewModel & {
  state: SubtitleProjectState;
  selectedSegment: LyricsSegment | null;
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
  onBoundaryCommit: () => void;
  onStyle: (laneId: string) => void;
  onRemoveLane: (laneId: string) => void;
  onSelectSegment: (laneId: string, segment: LyricsSegment) => void;
  onEditTiming: (laneId: string, segmentId: string) => void;
};

export type SubTimelineDomainProps = Omit<SubTimelineEditorProps, keyof ModeMediaViewModel>;

/** Sub-only timeline surface, lane presentation, and direct segment editing. */
export function SubTimelineEditor(props: SubTimelineEditorProps) {
  const safeDuration = Math.max(0.001, props.duration);
  const [draggingBoundary, setDraggingBoundary] = useState<{
    laneId: string;
    segmentId: string;
    edge: "start" | "end";
  } | null>(null);
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
            } ${segment.id === props.state.selected_segment_id ? "selected" : ""}`}
            x={(segment.start / safeDuration) * width}
            y={10}
            width={Math.max(2, ((segment.end - segment.start) / safeDuration) * width)}
            height={66}
          />
        ))
      )}
    >
      {({ width }) => {
        const draggingLaneIndex = draggingBoundary
          ? props.state.lanes.findIndex((lane) => lane.id === draggingBoundary.laneId)
          : -1;
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
                  draggingBoundary?.segmentId === props.state.selected_segment_id ? "selected" : ""
                }`}
                style={{
                  left: draggingBoundaryX,
                  height: 86 + draggingLaneIndex * 240 + 46,
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
                  onPointerDown={() =>
                    props.onStateChange({ ...props.state, active_lane_id: lane.id })
                  }
                >
                  <div className="lyrics-lane-header">
                    <span>{lane.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => props.onStyle(lane.id)}>Style {lane.style.alignment}</Button>
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
                        selected={segment.id === props.state.selected_segment_id}
                        editing={segment.id === props.editingSegmentId}
                        onSelect={() => props.onSelectSegment(lane.id, segment)}
                        onEditTiming={() => props.onEditTiming(lane.id, segment.id)}
                        onEdit={() => props.onEditingSegmentId(segment.id)}
                        onEditDone={(text) => {
                          props.onEditingSegmentId(null);
                          props.onStateChange({
                            ...props.state,
                            lanes: props.state.lanes.map((item) =>
                              item.id === lane.id
                                ? {
                                    ...item,
                                    segments: item.segments.map((candidate) =>
                                      candidate.id === segment.id ? { ...candidate, text } : candidate
                                    ),
                                  }
                                : item
                            ),
                          });
                        }}
                        onBoundaryPreview={(edge, time) =>
                          props.onBoundaryPreview(lane.id, segment.id, edge, time)
                        }
                        onBoundaryCancel={(_edge, _time, startSegment) =>
                          props.onBoundaryCancel(lane.id, segment.id, startSegment)
                        }
                        onBoundaryCommit={props.onBoundaryCommit}
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

function LyricsSegmentView(props: {
  segment: LyricsSegment;
  level: number;
  labelWidth: number;
  width: number;
  duration: number;
  selected: boolean;
  editing: boolean;
  onSelect: () => void;
  onEditTiming: () => void;
  onEdit: () => void;
  onEditDone: (text: string) => void;
  onBoundaryPreview: (edge: "start" | "end", time: number) => void;
  onBoundaryCancel: (
    edge: "start" | "end",
    time: number,
    segment: LyricsSegment,
  ) => void;
  onBoundaryCommit: () => void;
  onEditingChange: (editing: boolean) => void;
  onDraggingBoundary: (edge: "start" | "end" | null) => void;
}) {
  const selectActionFocusProps = useEditorActionFocusProps<HTMLButtonElement>((event) => {
    event.stopPropagation();
    props.onSelect();
  });
  const left = (props.segment.start / props.duration) * props.width;
  const right = (props.segment.end / props.duration) * props.width;
  const [draft, setDraft] = useState(props.segment.text);
  const boundaryEdgeRef = useRef<"start" | "end" | null>(null);
  const boundaryStartTimeRef = useRef<number | null>(null);
  const boundaryStartSegmentRef = useRef<LyricsSegment | null>(null);
  const boundaryContentRef = useRef<HTMLElement | null>(null);
  const drag = useBoundaryDrag({
    onPreview: (clientX) => {
      const content = boundaryContentRef.current;
      const edge = boundaryEdgeRef.current;
      if (!content || !edge) return;
      const rect = content.getBoundingClientRect();
      const time = clamp(((clientX - rect.left) / rect.width) * props.duration, 0, props.duration);
      props.onBoundaryPreview(edge, time);
    },
    onCommit: props.onBoundaryCommit,
    onCancel: () => {
      const edge = boundaryEdgeRef.current;
      const startTime = boundaryStartTimeRef.current;
      const startSegment = boundaryStartSegmentRef.current;
      if (edge && startTime !== null && startSegment) {
        props.onBoundaryCancel(edge, startTime, startSegment);
      }
    },
    onEditingChange: (editing) => {
      props.onEditingChange(editing);
      if (!editing) {
        props.onDraggingBoundary(null);
        boundaryEdgeRef.current = null;
        boundaryStartTimeRef.current = null;
        boundaryStartSegmentRef.current = null;
        boundaryContentRef.current = null;
      }
    },
  });

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
    props.onDraggingBoundary(edge);
    return true;
  }

  function beginPointerDrag(event: React.PointerEvent, edge: "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    if (prepareDrag(edge, event.currentTarget) && !drag.startPointer(event)) {
      props.onDraggingBoundary(null);
    }
  }

  function beginMouseDrag(event: React.MouseEvent, edge: "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    if (prepareDrag(edge, event.currentTarget) && !drag.startMouse(event)) {
      props.onDraggingBoundary(null);
    }
  }
  return (
    <>
      <button
        {...selectActionFocusProps}
        type="button"
        className={`lyrics-segment ${props.selected ? "selected" : ""} ${props.segment.low_confidence_outlier ? "confidence-warning" : ""}`}
        style={{ left, width: Math.max(4, right - left) }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onSelect();
          props.onEditTiming();
        }}
        title={`${props.segment.text}\nconfidence ${props.segment.confidence.toFixed(3)}`}
      >
        <span
          className="lyrics-handle start"
          onPointerDown={(event) => beginPointerDrag(event, "start")}
          onMouseDown={(event) => beginMouseDrag(event, "start")}
          onDoubleClick={(event) => event.stopPropagation()}
        />
        <span
          className="lyrics-handle end"
          onPointerDown={(event) => beginPointerDrag(event, "end")}
          onMouseDown={(event) => beginMouseDrag(event, "end")}
          onDoubleClick={(event) => event.stopPropagation()}
        />
      </button>
      <div
        className={`lyrics-label ${props.selected ? "selected" : ""} ${props.editing ? "editing" : ""} ${props.segment.low_confidence_outlier ? "confidence-warning" : ""}`}
        style={{ left, top: 38 + props.level * 27, width: props.labelWidth }}
        onClick={props.onSelect}
        onDoubleClick={() => {
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
            onBlur={() => props.onEditDone(draft.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onEditDone(draft.trim());
              if (event.key === "Escape") props.onEditDone(props.segment.text);
            }}
          />
        ) : (
          props.segment.text
        )}
      </div>
    </>
  );
}

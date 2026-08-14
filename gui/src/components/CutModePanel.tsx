import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import {
  Copy,
  Scissors,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CutAnalyzeGuideDialog } from "@/components/CutAnalyzeGuideDialog";
import type { TaskStatusMetaItem } from "@/components/ProjectInformation";
import { ModeToolbar } from "@/components/ModeToolbar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditorActionFocusProps } from "@/components/ui/editor-focus";
import { TimelineSurface } from "@/components/TimelineSurface";
import { formatTime } from "@/lib/time";
import {
  segmentSelectionModifiers,
  type SegmentSelectionModifiers,
} from "@/lib/segmentSelection";
import { useBoundaryDrag } from "@/lib/useBoundaryDrag";
import type { CutWaveformAmplitudeProfile } from "@/lib/waveform";
import type { ModeMediaViewModel, ModePanelViewModel } from "@/lib/modeViewModel";
import { tr } from "@/i18n";
import type { Segment } from "@/types";

export type CutTimelineProps = ModeMediaViewModel & {
  waveformAmplitudeProfile: CutWaveformAmplitudeProfile;
  segments: Segment[];
  selectedSegment: Segment | null;
  selectedIds: ReadonlySet<string>;
  onSelect: (segment: Segment, modifiers: SegmentSelectionModifiers) => void;
  onBoundaryPreview: (edge: "start" | "end", time: number) => void;
  onChangeCommitted: () => void;
};

export type CutTimelineDomainProps = Omit<CutTimelineProps, keyof ModeMediaViewModel>;

export type CutSegmentsProps = {
  segments: Segment[];
  selectedId: string | null;
  selectedIds: ReadonlySet<string>;
  onSelect: (segment: Segment, modifiers: SegmentSelectionModifiers) => void;
  onToggle: (segment: Segment, checked: boolean) => void;
  onTitleChange: (segment: Segment, title: string) => void;
  onTranscript: (segment: Segment) => void;
  titleForSegment: (segment: Segment) => string;
};

export type CutModePanelProps = {
  view: ModePanelViewModel;
  apiReady: boolean;
  checkedCount: number;
  onLoad: () => void;
  onAnalyze: (guideText: string) => void;
  onExport: () => void;
  onExportTimestamp: () => void;
  onSettings: () => void;
  guideText: string;
  renderTaskStatus: (modeMeta?: TaskStatusMetaItem[]) => React.ReactNode;
  timeline: CutTimelineDomainProps;
  segments: CutSegmentsProps;
};

/** `CutModePanel`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function CutModePanel(props: CutModePanelProps) {
  const [analyzeGuideOpen, setAnalyzeGuideOpen] = useState(false);

  return (
    <>
      <ModeToolbar
        transport={props.view.transport}
        information={props.renderTaskStatus()}
        load={{ onClick: props.onLoad }}
        analyze={{
          onClick: () => setAnalyzeGuideOpen(true),
          disabled: !props.view.media.sourceAvailable || !props.apiReady,
        }}
        exportAction={{
          onClick: props.onExport,
          disabled: props.checkedCount === 0 || !props.view.media.sourceAvailable,
          icon: <Scissors size={16} />,
        }}
        settings={{ onClick: props.onSettings }}
      >
        <Button variant="secondary" onClick={props.onExportTimestamp} disabled={props.checkedCount === 0}>
          <Copy size={16} />
          {tr("common.exportTs")}
        </Button>
      </ModeToolbar>
      <CutAnalyzeGuideDialog
        open={analyzeGuideOpen}
        guideText={props.guideText}
        onCancel={() => setAnalyzeGuideOpen(false)}
        onConfirm={(guideText) => {
          setAnalyzeGuideOpen(false);
          props.onAnalyze(guideText);
        }}
      />
      <TimelineStack {...props.view.media} {...props.timeline} />
      <SegmentList {...props.segments} />
    </>
  );
}

function TimelineStack(props: CutTimelineProps) {
  return (
    <TimelineSurface
      surfaceClassName="timeline-scroll-area"
      contentClassName="timeline-content"
      duration={props.duration}
      waveform={props.waveform}
      progressiveWaveformChunks={props.progressiveWaveformChunks}
      waveformPhase={props.waveformPhase}
      waveformProgress={props.waveformProgress}
      waveformDisplayMode={props.waveformDisplayMode}
      waveformAmplitudeProfile={props.waveformAmplitudeProfile === "singing-mc-contrast" ? "cut-legacy" : "adaptive"}
      currentTime={props.currentTime}
      playing={props.playing}
      zoom={props.zoom}
      focusRequest={props.focusRequest}
      focusRange={props.selectedSegment}
      editing={props.editing}
      onSeek={props.onSeek}
      onScrub={props.onScrub}
      onSeekingChange={props.onSeekingChange}
      minimumWidth={400}
      scrollbars={["horizontal"]}
      wheelScope="surface"
      waveformClassName="waveform-timeline timeline-row"
      rangeLayer={({ width }) => [
        ...props.segments.filter((segment) => !props.selectedIds.has(segment.id)),
        ...props.segments.filter((segment) => props.selectedIds.has(segment.id)),
      ].map((segment) => (
        <rect
          key={segment.id}
          className={`cut-waveform-segment ${props.selectedIds.has(segment.id) ? "selected" : ""}`}
          x={(segment.start / Math.max(0.001, props.duration)) * width}
          y="10"
          width={Math.max(1, ((segment.end - segment.start) / Math.max(0.001, props.duration)) * width)}
          height="66"
          fill={props.selectedIds.has(segment.id) ? "rgba(67, 190, 155, 0.42)" : "rgba(69, 179, 157, 0.26)"}
          pointerEvents="none"
        />
      ))}
    >
      {({ width, viewportRef }) => (
        <SegmentTimeline
          duration={props.duration}
          segment={props.selectedSegment}
          currentTime={props.currentTime}
          width={width}
          viewportRef={viewportRef}
          onBoundaryPreview={props.onBoundaryPreview}
          onChangeCommitted={props.onChangeCommitted}
          onEditingChange={props.onHandleEditingChange}
        />
      )}
    </TimelineSurface>
  );
}

function SegmentTimeline(props: {
  duration: number;
  segment: Segment | null;
  currentTime: number;
  width: number;
  viewportRef: React.RefObject<HTMLDivElement>;
  onBoundaryPreview: (edge: "start" | "end", time: number) => void;
  onChangeCommitted: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const safeDuration = Math.max(0.001, props.duration);
  const segment = props.segment;
  const [draggingEdge, setDraggingEdge] = useState<"start" | "end" | null>(null);
  const startX = segment ? (segment.start / safeDuration) * props.width : 0;
  const endX = segment ? (segment.end / safeDuration) * props.width : 0;
  const draggingX = draggingEdge === "start" ? startX : draggingEdge === "end" ? endX : null;
  const previewBoundary = (edge: "start" | "end", time: number) => {
    if (!segment) return;
    props.onBoundaryPreview(edge, time);
  };
  const setHandleEditing = (edge: "start" | "end", editing: boolean) => {
    setDraggingEdge(editing ? edge : null);
    props.onEditingChange(editing);
  };
  return (
    <div className="segment-timeline timeline-row" style={{ width: props.width }}>
      <div className="segment-track" style={{ width: props.width }}>
        {segment ? (
          <>
            {draggingX !== null ? <div className="cut-boundary-drag-guide" style={{ left: draggingX }} /> : null}
            <div
              className="segment-range"
              style={{ left: startX, width: Math.max(2, endX - startX) }}
              aria-hidden="true"
            />
            <DragHandle
              left={startX}
              label="start"
              width={props.width}
              duration={safeDuration}
              viewportRef={props.viewportRef}
              onEditingChange={(editing) => setHandleEditing("start", editing)}
              onChange={(time) => previewBoundary("start", time)}
              onChangeCommitted={props.onChangeCommitted}
            />
            <DragHandle
              left={endX}
              label="end"
              width={props.width}
              duration={safeDuration}
              viewportRef={props.viewportRef}
              onEditingChange={(editing) => setHandleEditing("end", editing)}
              onChange={(time) => previewBoundary("end", time)}
              onChangeCommitted={props.onChangeCommitted}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function DragHandle(props: {
  left: number;
  label: string;
  width: number;
  duration: number;
  viewportRef: React.RefObject<HTMLDivElement>;
  onEditingChange: (editing: boolean) => void;
  onChange: (time: number) => void;
  onChangeCommitted: () => void;
}) {
  const dragHandleFocusProps = useEditorActionFocusProps<HTMLButtonElement>();
  const updateFromClientX = (clientX: number) => {
    const viewport = props.viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left + viewport.scrollLeft;
    props.onChange((x / props.width) * props.duration);
  };
  const drag = useBoundaryDrag({
    onPreview: updateFromClientX,
    onCommit: props.onChangeCommitted,
    onEditingChange: props.onEditingChange,
    // Cut historically committed the preview even when the pointer emitted
    // pointercancel; retain that behavior while sharing listener cleanup.
    commitOnCancel: true,
  });

  return (
    <button
      {...dragHandleFocusProps}
      type="button"
      className="drag-handle"
      style={{ left: props.left }}
      aria-label={props.label}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        drag.startPointer(event);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        drag.startMouse(event);
      }}
    />
  );
}

function SegmentList(props: CutSegmentsProps) {
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const selectedRow = selectedRowRef.current;
    if (!viewport || !selectedRow) return;

    const viewportRect = viewport.getBoundingClientRect();
    const rowRect = selectedRow.getBoundingClientRect();
    if (rowRect.top < viewportRect.top) {
      viewport.scrollTop -= viewportRect.top - rowRect.top;
    } else if (rowRect.bottom > viewportRect.bottom) {
      viewport.scrollTop += rowRect.bottom - viewportRect.bottom;
    }
  }, [props.selectedId]);

  return (
    <div className="segment-list">
      <table className="segment-list-table segment-list-header-table">
        <SegmentColumnGroup />
        <thead>
          <tr>
            <th>{tr("segments.export")}</th>
            <th>{tr("segments.title")}</th>
            <th>ID</th>
            <th>{tr("segments.start")}</th>
            <th>{tr("segments.end")}</th>
            <th>{tr("segments.duration")}</th>
            <th>{tr("segments.confidence")}</th>
            <th>{tr("segments.text")}</th>
          </tr>
        </thead>
      </table>
      <ScrollArea className="segment-list-body" viewportRef={viewportRef} scrollbars={["vertical"]}>
        <table className="segment-list-table segment-list-body-table">
          <SegmentColumnGroup />
          <tbody>
            {props.segments.map((segment) => (
              <tr
                key={segment.id}
                ref={segment.id === props.selectedId ? selectedRowRef : undefined}
                className={props.selectedIds.has(segment.id) ? "selected" : ""}
                aria-selected={props.selectedIds.has(segment.id)}
                onClick={(event) => props.onSelect(segment, segmentSelectionModifiers(event))}
              >
                <td>
                  <Checkbox
                    checked={segment.checked !== false}
                    onChange={(event) => props.onToggle(segment, event.currentTarget.checked)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </td>
                <td>
                  <EditableTitleCell
                    segment={segment}
                    titleForSegment={props.titleForSegment}
                    onChange={(title) => props.onTitleChange(segment, title)}
                  />
                </td>
                <td>{segment.id}</td>
                <td>{formatTime(segment.start)}</td>
                <td>{formatTime(segment.end)}</td>
                <td>{formatTime(segment.end - segment.start)}</td>
                <td>{Math.round(segment.confidence * 100)}%</td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onTranscript(segment);
                    }}
                  >
                    {tr("common.view")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function SegmentColumnGroup() {
  return (
    <colgroup>
      <col className="segment-col-export" />
      <col className="segment-col-title" />
      <col className="segment-col-id" />
      <col className="segment-col-time" />
      <col className="segment-col-time" />
      <col className="segment-col-duration" />
      <col className="segment-col-confidence" />
      <col className="segment-col-text" />
    </colgroup>
  );
}

function EditableTitleCell(props: {
  segment: Segment;
  titleForSegment: (segment: Segment) => string;
  onChange: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.segment.title?.trim() ?? "");
  const displayTitle = props.titleForSegment(props.segment);
  const editTitleFocusProps = useEditorActionFocusProps<HTMLButtonElement>((event) => {
    event.preventDefault();
    event.stopPropagation();
    setDraft(props.segment.title?.trim() ?? "");
    setEditing(true);
  });

  useEffect(() => {
    if (!editing) setDraft(props.segment.title?.trim() ?? "");
  }, [editing, props.segment.title]);

  const commit = (value = draft) => {
    props.onChange(value.trim());
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        className="title-edit-input"
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.currentTarget.value)}
        onClick={(event) => event.stopPropagation()}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(props.segment.title?.trim() ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      {...editTitleFocusProps}
      type="button"
      className="title-edit-button"
      title={tr("segments.editTitle")}
    >
      {displayTitle}
    </button>
  );
}

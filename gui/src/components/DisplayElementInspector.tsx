import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Lock,
  LockOpen,
  Maximize2,
  Merge,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useEditorActionFocusProps } from "@/components/ui/editor-focus";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DISPLAY_ELEMENT_BLANK_DURATION_SECONDS,
  DISPLAY_ELEMENT_MIN_DURATION_SECONDS,
  activeDisplayElementId,
  addBlankDisplayElementLeft,
  addBlankDisplayElementRight,
  commitDisplayElementBoundary,
  deleteDisplayElement,
  displayElementPercentRange,
  editDisplayElementText,
  isDisplayElementBoundaryLocked,
  mergeDisplayElementRight,
  previewDisplayElementBoundary,
  type DisplayElementUpdate,
} from "@/lib/displayElements";
import type { DisplayElement, LyricsSegment } from "@/lib/subtitles";
import { useBoundaryDrag } from "@/lib/useBoundaryDrag";

export type DisplayElementInspectorLabels = {
  empty: string;
  blank: string;
  zoomEdit: string;
  zoomDisabled: string;
  lockBoundaries: string;
  unlockBoundaries: string;
  mergeRight: string;
  mergeDisabled: string;
  addBlankRight: string;
  addBlankLeft: string;
  addBlankDisabled: string;
  deleteElement: string;
  deleteDisabled: string;
  deleteConfirm: string;
  editText: string;
  timeline: string;
  list: string;
  boundary: string;
};

export type DisplayElementInspectorProps = {
  segment: LyricsSegment;
  currentTime: number;
  labels: DisplayElementInspectorLabels;
  onPreview: (elements: DisplayElement[]) => void;
  onCancel: (elements: DisplayElement[]) => void;
  onCommit: (update: DisplayElementUpdate) => void;
  onBoundaryLockChange?: (locked: boolean) => void;
  onOpenZoom?: () => void;
  timelineRange?: Pick<LyricsSegment, "start" | "end">;
  confirmDelete?: (element: DisplayElement) => boolean;
  showPlayhead?: boolean;
  status?: "waiting" | "running" | "cancelling" | "stale" | "conflict" | "failed";
  statusText?: string;
  statusError?: string;
  onEditingEnter?: () => void;
  onEditingExitWithoutChange?: () => void;
};

function ElementActionButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { onClick, ...buttonProps } = props;
  const actionFocusProps = useEditorActionFocusProps<HTMLButtonElement>(onClick);
  return <button {...buttonProps} {...actionFocusProps} />;
}

function disabledReason(
  action: "merge" | "blank" | "delete",
  segment: LyricsSegment,
  selectedId: string | null,
  labels: DisplayElementInspectorLabels,
) {
  if (!selectedId || !segment.display_elements?.length) {
    if (action === "merge") return labels.mergeDisabled;
    return action === "delete" ? labels.deleteDisabled : labels.addBlankDisabled;
  }
  const index = segment.display_elements.findIndex((element) => element.stable_id === selectedId);
  if (index < 0) {
    if (action === "merge") return labels.mergeDisabled;
    return action === "delete" ? labels.deleteDisabled : labels.addBlankDisabled;
  }
  if (action === "merge") {
    return index < segment.display_elements.length - 1 ? null : labels.mergeDisabled;
  }
  if (action === "delete") return segment.display_elements.length > 1 ? null : labels.deleteDisabled;
  return segment.display_elements[index].end - segment.display_elements[index].start
    >= DISPLAY_ELEMENT_BLANK_DURATION_SECONDS + DISPLAY_ELEMENT_MIN_DURATION_SECONDS - 1e-6
    ? null
    : labels.addBlankDisabled;
}

/** 文字を持つ表示素だけ、削除前の確認を必要とする。 */
export function displayElementDeleteNeedsConfirmation(element: Pick<DisplayElement, "text">) {
  return element.text.length > 0;
}

/** 選択行の表示素一覧、100%幅timeline、隣接編集操作を描画する。 */
export function DisplayElementInspector(props: DisplayElementInspectorProps) {
  const elements = props.segment.display_elements ?? [];
  const reanalysisBusy = props.status === "waiting"
    || props.status === "running"
    || props.status === "cancelling";
  const timelineRange = props.timelineRange ?? props.segment;
  const [selectedId, setSelectedId] = useState<string | null>(elements[0]?.stable_id ?? null);
  const [textEdit, setTextEdit] = useState<{ id: string; draft: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const textEditFinishingRef = useRef(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const boundaryIndexRef = useRef<number | null>(null);
  const boundaryTimeRef = useRef<number | null>(null);
  const startElementsRef = useRef<DisplayElement[] | null>(null);
  const activeId = activeDisplayElementId(elements, props.currentTime);
  const clearDragSnapshot = () => {
    boundaryIndexRef.current = null;
    boundaryTimeRef.current = null;
    startElementsRef.current = null;
  };

  useEffect(() => {
    setSelectedId((current) => (
      current && elements.some((element) => element.stable_id === current)
        ? current
        : elements[0]?.stable_id ?? null
    ));
  }, [props.segment.id, props.segment.display_element_revision]);

  const beginTextEdit = (element: DisplayElement) => {
    if (reanalysisBusy) return;
    textEditFinishingRef.current = false;
    setSelectedId(element.stable_id);
    setTextEdit({ id: element.stable_id, draft: element.text });
    props.onEditingEnter?.();
  };

  const finishTextEdit = (commit: boolean) => {
    if (!textEdit || textEditFinishingRef.current) return;
    textEditFinishingRef.current = true;
    const current = textEdit;
    setTextEdit(null);
    if (reanalysisBusy) {
      props.onEditingExitWithoutChange?.();
      return;
    }
    if (!commit) {
      props.onEditingExitWithoutChange?.();
      return;
    }
    const update = editDisplayElementText(props.segment, current.id, current.draft);
    if (update) {
      setSelectedId(update.selectedId);
      props.onCommit(update);
    } else props.onEditingExitWithoutChange?.();
  };

  const drag = useBoundaryDrag({
    onPreview: (clientX) => {
      const timeline = timelineRef.current;
      const boundaryIndex = boundaryIndexRef.current;
      if (!timeline || boundaryIndex === null) return;
      const rect = timeline.getBoundingClientRect();
      const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
      const proposedTime = timelineRange.start + ratio * (timelineRange.end - timelineRange.start);
      const preview = previewDisplayElementBoundary(props.segment, boundaryIndex, proposedTime);
      if (!preview) return;
      boundaryTimeRef.current = preview[boundaryIndex].end;
      props.onPreview(preview);
    },
    onCommit: () => {
      const boundaryIndex = boundaryIndexRef.current;
      const boundaryTime = boundaryTimeRef.current;
      if (boundaryIndex === null || boundaryTime === null) return;
      const snapshotSegment = startElementsRef.current
        ? { ...props.segment, display_elements: startElementsRef.current }
        : props.segment;
      const update = commitDisplayElementBoundary(snapshotSegment, boundaryIndex, boundaryTime);
      if (update) props.onCommit(update);
      else if (startElementsRef.current) props.onCancel(startElementsRef.current);
      clearDragSnapshot();
    },
    onCancel: () => {
      if (startElementsRef.current) props.onCancel(startElementsRef.current);
      clearDragSnapshot();
    },
    onEditingChange: (editing) => {
      setDragging(editing);
    },
  });

  useEffect(() => {
    if (!dragging) return;
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      drag.cancel();
    };
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [drag, dragging]);

  const beginPointerDrag = (event: React.PointerEvent, boundaryIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (reanalysisBusy) return;
    if (drag.isActive()) return;
    props.onEditingEnter?.();
    boundaryIndexRef.current = boundaryIndex;
    startElementsRef.current = elements.map((element) => ({ ...element }));
    boundaryTimeRef.current = elements[boundaryIndex].end;
    if (!drag.startPointer(event)) {
      clearDragSnapshot();
      props.onEditingExitWithoutChange?.();
    }
  };

  const beginMouseDrag = (event: React.MouseEvent, boundaryIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (reanalysisBusy) return;
    if (drag.isActive()) return;
    props.onEditingEnter?.();
    boundaryIndexRef.current = boundaryIndex;
    startElementsRef.current = elements.map((element) => ({ ...element }));
    boundaryTimeRef.current = elements[boundaryIndex].end;
    if (!drag.startMouse(event)) {
      clearDragSnapshot();
      props.onEditingExitWithoutChange?.();
    }
  };

  const mergeReason = disabledReason("merge", props.segment, selectedId, props.labels);
  const blankReason = disabledReason("blank", props.segment, selectedId, props.labels);
  const deleteReason = disabledReason("delete", props.segment, selectedId, props.labels);
  const mergeTitle = mergeReason ?? props.labels.mergeRight;
  const blankLeftTitle = blankReason ?? props.labels.addBlankLeft;
  const blankRightTitle = blankReason ?? props.labels.addBlankRight;
  const deleteTitle = deleteReason ?? props.labels.deleteElement;
  const zoomDisabled = elements.length === 0;
  const zoomTitle = zoomDisabled ? props.labels.zoomDisabled : props.labels.zoomEdit;
  const boundaryLocked = isDisplayElementBoundaryLocked(props.segment);
  const boundaryLockTitle = boundaryLocked ? props.labels.unlockBoundaries : props.labels.lockBoundaries;
  const lineDuration = Math.max(0, timelineRange.end - timelineRange.start);
  const playheadPercent = lineDuration > 0
    ? Math.max(0, Math.min(100, ((props.currentTime - timelineRange.start) / lineDuration) * 100))
    : 0;

  return (
    <div
      className={`display-element-inspector${reanalysisBusy ? " reanalysis-busy" : ""}`}
      aria-busy={reanalysisBusy}
      data-reanalysis-busy={reanalysisBusy || undefined}
    >
      {props.status && props.statusText ? (
        <p className={`display-element-reanalysis-status ${props.status}`} role="status" data-status={props.status}>
          {props.statusText}{props.statusError ? `: ${props.statusError}` : ""}
        </p>
      ) : null}
      {!elements.length ? <p className="display-element-empty">{props.labels.empty}</p> : null}
      <div className="display-element-toolbar" role="toolbar" aria-label={props.labels.timeline}>
        {props.onBoundaryLockChange ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="display-element-boundary-lock-button"
            aria-label={boundaryLockTitle}
            aria-pressed={boundaryLocked}
            title={boundaryLockTitle}
            disabled={elements.length === 0 || reanalysisBusy}
            onClick={() => props.onBoundaryLockChange?.(!boundaryLocked)}
          >
            {boundaryLocked
              ? <Lock size={17} aria-hidden="true" />
              : <LockOpen size={17} aria-hidden="true" />}
          </Button>
        ) : null}
        {props.onOpenZoom ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={props.labels.zoomEdit}
            title={zoomTitle}
            disabled={zoomDisabled || reanalysisBusy}
            onClick={props.onOpenZoom}
          >
            <Maximize2 size={17} aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={props.labels.mergeRight}
          title={mergeTitle}
          disabled={Boolean(mergeReason) || reanalysisBusy}
          onClick={() => {
            if (!selectedId) return;
            props.onEditingEnter?.();
            const update = mergeDisplayElementRight(props.segment, selectedId);
            if (update) {
              setSelectedId(update.selectedId);
              props.onCommit(update);
            } else props.onEditingExitWithoutChange?.();
          }}
        >
          <Merge size={17} aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={props.labels.addBlankLeft}
          title={blankLeftTitle}
          disabled={Boolean(blankReason) || reanalysisBusy}
          onClick={() => {
            if (!selectedId) return;
            props.onEditingEnter?.();
            const update = addBlankDisplayElementLeft(props.segment, selectedId);
            if (update) {
              setSelectedId(update.selectedId);
              props.onCommit(update);
            } else props.onEditingExitWithoutChange?.();
          }}
        >
          <ArrowLeftToLine size={17} aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={props.labels.addBlankRight}
          title={blankRightTitle}
          disabled={Boolean(blankReason) || reanalysisBusy}
          onClick={() => {
            if (!selectedId) return;
            props.onEditingEnter?.();
            const update = addBlankDisplayElementRight(props.segment, selectedId);
            if (update) {
              setSelectedId(update.selectedId);
              props.onCommit(update);
            } else props.onEditingExitWithoutChange?.();
          }}
        >
          <ArrowRightToLine size={17} aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={props.labels.deleteElement}
          title={deleteTitle}
          disabled={Boolean(deleteReason) || reanalysisBusy}
          onClick={() => {
            if (!selectedId) return;
            const selected = elements.find((element) => element.stable_id === selectedId);
            if (!selected) return;
            props.onEditingEnter?.();
            const confirmed = !displayElementDeleteNeedsConfirmation(selected) || (
              props.confirmDelete?.(selected)
              ?? (typeof globalThis.confirm === "function" && globalThis.confirm(props.labels.deleteConfirm))
            );
            if (!confirmed) {
              props.onEditingExitWithoutChange?.();
              return;
            }
            const update = deleteDisplayElement(props.segment, selectedId);
            if (update) {
              setSelectedId(update.selectedId);
              props.onCommit(update);
            } else props.onEditingExitWithoutChange?.();
          }}
        >
          <Trash2 size={17} aria-hidden="true" />
        </Button>
      </div>
      <div
        ref={timelineRef}
        className="display-element-timeline"
        role="group"
        aria-label={props.labels.timeline}
      >
        {elements.map((element, index) => {
          const range = displayElementPercentRange(timelineRange, element);
          const selected = element.stable_id === selectedId;
          const active = element.stable_id === activeId;
          return (
            <div
              key={element.stable_id}
              className={[
                "display-element-block",
                element.text ? "" : "blank",
                selected ? "selected" : "",
                active ? "active" : "",
              ].filter(Boolean).join(" ")}
              style={{ left: `${range.left}%`, width: `${range.width}%` }}
            >
              <ElementActionButton
                type="button"
                className="display-element-select"
                aria-pressed={selected}
                aria-label={element.text || props.labels.blank}
                title={element.text || props.labels.blank}
                onClick={() => setSelectedId(element.stable_id)}
              >
                {element.text || "∅"}
              </ElementActionButton>
              {index < elements.length - 1 ? (
                <span
                  className={`display-element-boundary${reanalysisBusy ? " disabled" : ""}`}
                  role="separator"
                  aria-orientation="vertical"
                  aria-disabled={reanalysisBusy || undefined}
                  aria-label={props.labels.boundary}
                  title={props.labels.boundary}
                  onPointerDown={(event) => beginPointerDrag(event, index)}
                  onMouseDown={(event) => beginMouseDrag(event, index)}
                />
              ) : null}
            </div>
          );
        })}
        {props.showPlayhead ? (
          <span
            className="display-element-playhead"
            style={{ left: `var(--display-element-zoom-playhead-percent, ${playheadPercent}%)` }}
            aria-hidden="true"
          />
        ) : null}
      </div>
      <ScrollArea
        className="display-element-list-scroll"
        viewportClassName="display-element-list-scroll-viewport"
        scrollbars={["vertical"]}
        type="always"
      >
        <ol className="display-element-list" aria-label={props.labels.list}>
          {elements.map((element) => {
            const className = [
              "display-element-list-item",
              element.stable_id === selectedId ? "selected" : "",
              element.stable_id === activeId ? "active" : "",
              textEdit?.id === element.stable_id ? "editing" : "",
            ].filter(Boolean).join(" ");
            const time = (
              <span className="display-element-list-time">
                {(element.start - props.segment.start).toFixed(3)}–{(element.end - props.segment.start).toFixed(3)}s
              </span>
            );
            return (
              <li key={element.stable_id}>
                {textEdit?.id === element.stable_id ? (
                  <div className={className}>
                    <Input
                      className="display-element-list-text-input"
                      value={textEdit.draft}
                      aria-label={props.labels.editText}
                      autoFocus
                      disabled={reanalysisBusy}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setTextEdit({ id: element.stable_id, draft: event.currentTarget.value })}
                      onBlur={() => finishTextEdit(true)}
                      onKeyDown={(event) => {
                        if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          finishTextEdit(true);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          finishTextEdit(false);
                        }
                      }}
                    />
                    {time}
                  </div>
                ) : (
                  <ElementActionButton
                    type="button"
                    className={className}
                    aria-pressed={element.stable_id === selectedId}
                    title={props.labels.editText}
                    onClick={() => setSelectedId(element.stable_id)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (reanalysisBusy) return;
                      beginTextEdit(element);
                    }}
                  >
                    <span className="display-element-list-text">{element.text || props.labels.blank}</span>
                    {time}
                  </ElementActionButton>
                )}
              </li>
            );
          })}
        </ol>
      </ScrollArea>
    </div>
  );
}

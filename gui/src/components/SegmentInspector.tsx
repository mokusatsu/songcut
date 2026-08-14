import { useEffect, useId, useMemo, useRef, useState } from "react";
import type * as React from "react";

import {
  DisplayElementInspector,
  type DisplayElementInspectorProps,
} from "@/components/DisplayElementInspector";
import { Input } from "@/components/ui/input";
import { useEditorActionFocusProps } from "@/components/ui/editor-focus";
import {
  createCutBoundaryPolicy,
  type BoundaryPolicy,
} from "@/lib/boundaries";
import {
  formatTimeInput,
  parseTimeInput,
  evaluateSegmentTiming,
  type SegmentTimingTarget,
} from "@/lib/segmentTiming";
import {
  createSubtitleBoundaryPolicy,
  type RhythmGridPoint,
} from "@/lib/subtitles";

/** The two editor modes that share the right-hand inspector. */
export type SegmentInspectorMode = "cut" | "sub";

/** Labels are supplied by the mode owner so this common component has no new i18n keys. */
export type SegmentInspectorLabels = {
  noSelection: string;
  multipleSelection: string;
  timeline: string;
  timing: string;
  style: string;
  displayElements: string;
  start: string;
  end: string;
  duration: string;
  specification: string;
  durationMode: string;
  endMode: string;
};

/** Content for the Sub-only Style section, either as a value or selected-segment render prop. */
export type SegmentInspectorStyleContent =
  | React.ReactNode
  | ((segment: SegmentTimingTarget) => React.ReactNode);

export type SegmentInspectorProps = {
  mode: SegmentInspectorMode;
  segment: SegmentTimingTarget | null;
  mediaDuration: number;
  previousEnd?: number;
  nextStart?: number;
  rhythmGrid?: readonly RhythmGridPoint[];
  labels: SegmentInspectorLabels;
  selectionCount?: number;
  onTimingCommit: (start: number, end: number) => void;
  onTimingEditingEnter?: () => void;
  onTimingEditingExitWithoutChange?: () => void;
  style?: SegmentInspectorStyleContent;
  timeline?: React.ReactNode;
  displayElementInspector?: DisplayElementInspectorProps;
};

type RangeMode = "duration" | "end";

export type SegmentInspectorTimingDraft = {
  startInput: string;
  extentInput: string;
  rangeMode: RangeMode;
};

/** 選択中セグメントの時刻から、入力欄用の初期文字列を作る。 */
export function createSegmentInspectorTimingDraft(
  segment: Pick<SegmentTimingTarget, "start" | "end">,
): SegmentInspectorTimingDraft {
  return {
    startInput: formatTimeInput(segment.start),
    extentInput: formatTimeInput(segment.end - segment.start),
    rangeMode: "duration",
  };
}

/** 入力中の時刻を既存の境界ポリシーで検証し、保存可能な範囲へ変換する。 */
export function resolveSegmentInspectorTimingCommit(input: {
  draft: SegmentInspectorTimingDraft;
  mode: SegmentInspectorMode;
  mediaDuration: number;
  previousEnd?: number;
  nextStart?: number;
  rhythmGrid?: readonly RhythmGridPoint[];
}): { start: number; end: number } | null {
  const grid = input.rhythmGrid ?? [];
  const policy = input.mode === "cut"
    ? createCutBoundaryPolicy("dialog")
    : createSubtitleBoundaryPolicy(grid);
  const evaluation = evaluateSegmentTiming({
    startInput: input.draft.startInput,
    extentInput: input.draft.extentInput,
    rangeMode: input.draft.rangeMode,
    mode: input.mode,
    policy,
    mediaDuration: input.mediaDuration,
    previousEnd: input.mode === "cut" ? 0 : input.previousEnd,
    nextStart: input.mode === "cut" ? input.mediaDuration : input.nextStart,
  });
  if (!evaluation.valid || evaluation.start === null || evaluation.end === null) return null;
  return { start: evaluation.start, end: evaluation.end };
}

/** IME変換中ではないEnterだけを確定操作として扱う。 */
export function shouldCommitSegmentInspectorEnter(input: {
  key: string;
  isComposing: boolean;
  keyCode: number;
}): boolean {
  return input.key === "Enter" && !input.isComposing && input.keyCode !== 229;
}

/** 保存せずに、入力欄を選択中セグメントの現在値へ戻す。 */
export function resetSegmentInspectorTimingDraft(
  segment: Pick<SegmentTimingTarget, "start" | "end">,
): SegmentInspectorTimingDraft {
  return createSegmentInspectorTimingDraft(segment);
}

/** Cut/Subで共用する右側セグメントインスペクターを描画する。 */
export function SegmentInspector(props: SegmentInspectorProps) {
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [timingOpen, setTimingOpen] = useState(true);
  const [styleOpen, setStyleOpen] = useState(true);
  const [displayElementsOpen, setDisplayElementsOpen] = useState(true);
  const [draft, setDraft] = useState<SegmentInspectorTimingDraft | null>(
    () => props.segment ? createSegmentInspectorTimingDraft(props.segment) : null,
  );
  const skipNextBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!props.segment) {
      setDraft(null);
      return;
    }
    setDraft(createSegmentInspectorTimingDraft(props.segment));
    skipNextBlurCommitRef.current = false;
  }, [props.mode, props.segment?.id]);

  const grid = props.rhythmGrid ?? [];
  const policy = useMemo<BoundaryPolicy>(
    () => props.mode === "cut"
      ? createCutBoundaryPolicy("dialog")
      : createSubtitleBoundaryPolicy(grid),
    [grid, props.mode],
  );
  const evaluation = useMemo(() => {
    if (!draft) return null;
    return evaluateSegmentTiming({
      startInput: draft.startInput,
      extentInput: draft.extentInput,
      rangeMode: draft.rangeMode,
      mode: props.mode,
      policy,
      mediaDuration: props.mediaDuration,
      previousEnd: props.mode === "cut" ? 0 : props.previousEnd,
      nextStart: props.mode === "cut" ? props.mediaDuration : props.nextStart,
    });
  }, [draft, policy, props.mediaDuration, props.mode, props.nextStart, props.previousEnd]);

  const inspectorId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const timelineHeaderId = `${inspectorId}-timeline-header`;
  const timelinePanelId = `${inspectorId}-timeline-panel`;
  const timingHeaderId = `${inspectorId}-timing-header`;
  const timingPanelId = `${inspectorId}-timing-panel`;
  const styleHeaderId = `${inspectorId}-style-header`;
  const stylePanelId = `${inspectorId}-style-panel`;
  const displayElementsHeaderId = `${inspectorId}-display-elements-header`;
  const displayElementsPanelId = `${inspectorId}-display-elements-panel`;

  const timelineHeaderFocusProps = useEditorActionFocusProps<HTMLButtonElement>(() => (
    setTimelineOpen((open) => !open)
  ));
  const timingHeaderFocusProps = useEditorActionFocusProps<HTMLButtonElement>(() => setTimingOpen((open) => !open));
  const styleHeaderFocusProps = useEditorActionFocusProps<HTMLButtonElement>(() => setStyleOpen((open) => !open));
  const displayElementsHeaderFocusProps = useEditorActionFocusProps<HTMLButtonElement>(() => (
    setDisplayElementsOpen((open) => !open)
  ));
  const selectionCount = props.selectionCount ?? (props.segment ? 1 : 0);

  if (!props.segment || selectionCount === 0 || !draft || !evaluation) {
    return <div className="segment-inspector"><p>{props.labels.noSelection}</p></div>;
  }

  if (props.mode === "cut" && selectionCount > 1) {
    return <div className="segment-inspector"><p>{props.labels.multipleSelection}</p></div>;
  }

  const commitTiming = () => {
    const resolved = resolveSegmentInspectorTimingCommit({
      draft,
      mode: props.mode,
      mediaDuration: props.mediaDuration,
      previousEnd: props.previousEnd,
      nextStart: props.nextStart,
      rhythmGrid: grid,
    });
    if (!resolved) return false;
    setDraft((current) => current ? {
      ...current,
      startInput: formatTimeInput(resolved.start),
      extentInput: formatTimeInput(current.rangeMode === "duration" ? resolved.end - resolved.start : resolved.end),
    } : current);
    props.onTimingCommit(resolved.start, resolved.end);
    return true;
  };

  const restoreSelectedTiming = () => {
    skipNextBlurCommitRef.current = true;
    setDraft(createSegmentInspectorTimingDraft(props.segment!));
  };

  const updateDraft = (patch: Partial<SegmentInspectorTimingDraft>) => {
    skipNextBlurCommitRef.current = false;
    setDraft((current) => current ? { ...current, ...patch } : current);
  };

  const handleTimingKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      restoreSelectedTiming();
      props.onTimingEditingExitWithoutChange?.();
      // Do not preventDefault: Input's shared editor-focus primitive blurs and
      // returns focus to the editor anchor after this Escape handler runs.
      return;
    }
    if (!shouldCommitSegmentInspectorEnter({
      key: event.key,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
    })) return;
    event.preventDefault();
    skipNextBlurCommitRef.current = true;
    commitTiming();
  };

  const sectionContent = (content: React.ReactNode, open: boolean, headerId: string, panelId: string) => (
    <div
      id={panelId}
      className="segment-inspector-panel"
      role="region"
      aria-labelledby={headerId}
      hidden={!open}
    >
      {content}
    </div>
  );

  const styleContent = typeof props.style === "function" ? props.style(props.segment) : props.style;
  const singleSelection = selectionCount === 1;

  return (
    <div className="segment-inspector">
      {props.mode === "sub" && props.timeline ? (
        <section className="segment-inspector-section" data-section="timeline">
          <h2 className="segment-inspector-heading">
            <button
              {...timelineHeaderFocusProps}
              type="button"
              id={timelineHeaderId}
              className="segment-inspector-header"
              aria-expanded={timelineOpen}
              aria-controls={timelinePanelId}
            >
              {props.labels.timeline}
            </button>
          </h2>
          {sectionContent(
            <div className="segment-inspector-timeline">{props.timeline}</div>,
            timelineOpen,
            timelineHeaderId,
            timelinePanelId,
          )}
        </section>
      ) : null}
      {singleSelection ? <section className="segment-inspector-section" data-section="timing">
        <h2 className="segment-inspector-heading">
          <button
            {...timingHeaderFocusProps}
            type="button"
            id={timingHeaderId}
            className="segment-inspector-header"
            aria-expanded={timingOpen}
            aria-controls={timingPanelId}
          >
            {props.labels.timing}
          </button>
        </h2>
        {sectionContent(
          <form
            className="segment-inspector-timing"
            onSubmit={(event) => {
              event.preventDefault();
              commitTiming();
            }}
          >
            <label className="segment-inspector-field">
              <span>{props.labels.start}</span>
              <Input
                value={draft.startInput}
                inputMode="decimal"
                aria-invalid={Boolean(evaluation.startError)}
                onChange={(event) => updateDraft({ startInput: event.currentTarget.value })}
                onBlur={() => {
                  if (skipNextBlurCommitRef.current) {
                    skipNextBlurCommitRef.current = false;
                    return;
                  }
                  if (!commitTiming()) props.onTimingEditingExitWithoutChange?.();
                }}
                onFocus={(event) => {
                  props.onTimingEditingEnter?.();
                  event.currentTarget.select();
                }}
                onKeyDown={handleTimingKeyDown}
              />
              {evaluation.startError ? <span className="segment-inspector-error" role="alert">{evaluation.startError}</span> : null}
            </label>
            <fieldset className="segment-inspector-range-mode">
              <legend>{props.labels.specification}</legend>
              <label>
                <input
                  type="radio"
                  name={`${inspectorId}-range-mode`}
                  checked={draft.rangeMode === "duration"}
                  onFocus={props.onTimingEditingEnter}
                  onBlur={props.onTimingEditingExitWithoutChange}
                  onChange={() => {
                    const start = parseTimeInput(draft.startInput);
                    const extent = parseTimeInput(draft.extentInput);
                    if (start !== null && extent !== null && draft.rangeMode === "end") {
                      updateDraft({ extentInput: formatTimeInput(extent - start) });
                    }
                    updateDraft({ rangeMode: "duration" });
                  }}
                />
                {props.labels.durationMode}
              </label>
              <label>
                <input
                  type="radio"
                  name={`${inspectorId}-range-mode`}
                  checked={draft.rangeMode === "end"}
                  onFocus={props.onTimingEditingEnter}
                  onBlur={props.onTimingEditingExitWithoutChange}
                  onChange={() => {
                    const start = parseTimeInput(draft.startInput);
                    const extent = parseTimeInput(draft.extentInput);
                    if (start !== null && extent !== null && draft.rangeMode === "duration") {
                      updateDraft({ extentInput: formatTimeInput(start + extent) });
                    }
                    updateDraft({ rangeMode: "end" });
                  }}
                />
                {props.labels.endMode}
              </label>
            </fieldset>
            <label className="segment-inspector-field">
              <span>{draft.rangeMode === "duration" ? props.labels.duration : props.labels.end}</span>
              <Input
                value={draft.extentInput}
                inputMode="decimal"
                aria-invalid={Boolean(evaluation.extentError)}
                onChange={(event) => updateDraft({ extentInput: event.currentTarget.value })}
                onBlur={() => {
                  if (skipNextBlurCommitRef.current) {
                    skipNextBlurCommitRef.current = false;
                    return;
                  }
                  if (!commitTiming()) props.onTimingEditingExitWithoutChange?.();
                }}
                onFocus={(event) => {
                  props.onTimingEditingEnter?.();
                  event.currentTarget.select();
                }}
                onKeyDown={handleTimingKeyDown}
              />
              {evaluation.extentError ? <span className="segment-inspector-error" role="alert">{evaluation.extentError}</span> : null}
            </label>
            {evaluation.rangeError ? <p className="segment-inspector-error" role="alert">{evaluation.rangeError}</p> : null}
            {evaluation.start !== null && evaluation.end !== null ? (
              <dl className="segment-inspector-summary">
                <div><dt>{props.labels.start}</dt><dd>{formatTimeInput(evaluation.start)}</dd></div>
                <div><dt>{props.labels.end}</dt><dd>{formatTimeInput(evaluation.end)}</dd></div>
                <div><dt>{props.labels.duration}</dt><dd>{formatTimeInput(evaluation.end - evaluation.start)}</dd></div>
              </dl>
            ) : null}
          </form>,
          timingOpen,
          timingHeaderId,
          timingPanelId,
        )}
      </section> : null}
      {props.mode === "sub" && singleSelection ? (
        <section className="segment-inspector-section" data-section="display-elements">
          <h2 className="segment-inspector-heading">
            <button
              {...displayElementsHeaderFocusProps}
              type="button"
              id={displayElementsHeaderId}
              className="segment-inspector-header"
              aria-expanded={displayElementsOpen}
              aria-controls={displayElementsPanelId}
            >
              {props.labels.displayElements}
            </button>
          </h2>
          {sectionContent(
            props.displayElementInspector ? (
              <DisplayElementInspector {...props.displayElementInspector} />
            ) : <p className="display-element-empty">{props.labels.noSelection}</p>,
            displayElementsOpen,
            displayElementsHeaderId,
            displayElementsPanelId,
          )}
        </section>
      ) : null}
      {props.mode === "sub" && styleContent ? (
        <section className="segment-inspector-section" data-section="style">
          <h2 className="segment-inspector-heading">
            <button
              {...styleHeaderFocusProps}
              type="button"
              id={styleHeaderId}
              className="segment-inspector-header"
              aria-expanded={styleOpen}
              aria-controls={stylePanelId}
            >
              {props.labels.style}
            </button>
          </h2>
          {sectionContent(<div className="segment-inspector-style">{styleContent}</div>, styleOpen, styleHeaderId, stylePanelId)}
        </section>
      ) : null}
    </div>
  );
}

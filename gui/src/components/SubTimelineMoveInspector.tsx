import { useEffect, useId, useMemo, useState } from "react";
import { MoveRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useEditorActionFocusProps } from "@/components/ui/editor-focus";
import { Select } from "@/components/ui/select";

export type SubTimelineMoveOption = {
  id: string;
  name: string;
  disabled: boolean;
  disabledReason?: string;
};

export type SubTimelineMoveInspectorLabels = {
  current: string;
  target: string;
  move: string;
  unavailable: string;
};

/** 選択肢から最初に移動可能なTimeline IDを返す。 */
export function firstMovableTimeline(options: readonly SubTimelineMoveOption[]): string {
  return options.find((option) => !option.disabled)?.id ?? "";
}

/** Subの選択セグメントについて、現在Timeline表示と明示的なMove操作を描画する。 */
export function SubTimelineMoveInspector(props: {
  selectionKey: string;
  currentTimeline: string;
  options: readonly SubTimelineMoveOption[];
  labels: SubTimelineMoveInspectorLabels;
  onMove: (targetTimelineId: string) => void;
}) {
  const optionKey = useMemo(
    () => props.options.map((option) => `${option.id}:${option.disabled ? 1 : 0}`).join("|"),
    [props.options],
  );
  const [targetTimelineId, setTargetTimelineId] = useState(() => firstMovableTimeline(props.options));
  const moveFocusProps = useEditorActionFocusProps<HTMLButtonElement>();
  const inspectorId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const currentHeadingId = `${inspectorId}-current-heading`;
  const targetHeadingId = `${inspectorId}-target-heading`;
  const targetSelectId = `${inspectorId}-target-select`;
  const disabledReasonId = `${inspectorId}-move-reason`;

  useEffect(() => {
    setTargetTimelineId((current) => (
      props.options.some((option) => option.id === current && !option.disabled)
        ? current
        : firstMovableTimeline(props.options)
    ));
  }, [optionKey, props.selectionKey]);

  const selectedOption = props.options.find((option) => option.id === targetTimelineId);
  const disabled = !selectedOption || selectedOption.disabled;
  const disabledReason = selectedOption?.disabledReason ?? props.labels.unavailable;

  return (
    <div
      className="segment-timeline-move"
      role="group"
      aria-labelledby={`${currentHeadingId} ${targetHeadingId}`}
    >
      <div className="segment-timeline-move-headings">
        <span id={currentHeadingId} className="segment-timeline-move-heading segment-timeline-move-heading-current">
          {props.labels.current}
        </span>
        <span id={targetHeadingId} className="segment-timeline-move-heading segment-timeline-move-heading-target">
          {props.labels.target}
        </span>
      </div>
      <div className="segment-timeline-move-row">
        <span className="segment-timeline-current" aria-labelledby={currentHeadingId}>
          <span className="segment-timeline-current-name">{props.currentTimeline}</span>
        </span>
        <MoveRight className="segment-timeline-move-arrow" size={15} aria-hidden="true" />
        <Select
          id={targetSelectId}
          className="segment-timeline-move-select"
          value={targetTimelineId}
          aria-label={props.labels.target}
          aria-labelledby={targetHeadingId}
          onChange={(event) => setTargetTimelineId(event.currentTarget.value)}
        >
          {props.options.map((option) => (
            <option key={option.id} value={option.id} disabled={option.disabled}>
              {option.name}
            </option>
          ))}
        </Select>
        <Button
          {...moveFocusProps}
          type="button"
          className="segment-timeline-move-button"
          variant="secondary"
          disabled={disabled}
          title={disabled ? disabledReason : props.labels.move}
          aria-label={props.labels.move}
          aria-describedby={disabled ? disabledReasonId : undefined}
          onClick={() => {
            if (!disabled) props.onMove(targetTimelineId);
          }}
        >
          <MoveRight size={15} aria-hidden="true" />
          {props.labels.move}
        </Button>
      </div>
      {disabled ? (
        <p id={disabledReasonId} className="segment-timeline-move-reason" role="status">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}

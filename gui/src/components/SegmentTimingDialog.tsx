import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  adjacentRhythmTime,
  cutTimeArrowStep,
  formatTimeInput,
  isOnRhythmGrid,
  nearestRhythmTime,
  parseTimeInput,
} from "@/lib/segmentTiming";
import type { RhythmGridPoint } from "@/lib/subtitles";
import { tr } from "@/i18n";

export type SegmentTimingTarget = {
  id: string;
  start: number;
  end: number;
};

type RangeMode = "duration" | "end";

export function SegmentTimingDialog(props: {
  open: boolean;
  mode: "cut" | "sub";
  segment: SegmentTimingTarget | null;
  mediaDuration: number;
  previousEnd?: number;
  nextStart?: number;
  rhythmGrid?: readonly RhythmGridPoint[];
  onClose: () => void;
  onApply: (start: number, end: number) => void;
}) {
  const [rangeMode, setRangeMode] = useState<RangeMode>("duration");
  const [startInput, setStartInput] = useState("0:00.000");
  const [extentInput, setExtentInput] = useState("0:00.000");
  const grid = props.rhythmGrid ?? [];

  useEffect(() => {
    if (!props.open || !props.segment) return;
    setRangeMode("duration");
    setStartInput(formatTimeInput(props.segment.start));
    setExtentInput(formatTimeInput(props.segment.end - props.segment.start));
  }, [props.open, props.segment]);

  const evaluation = useMemo(
    () => evaluateTiming({
      startInput,
      extentInput,
      rangeMode,
      mode: props.mode,
      mediaDuration: props.mediaDuration,
      previousEnd: props.previousEnd,
      nextStart: props.nextStart,
    }),
    [
      extentInput,
      props.mediaDuration,
      props.mode,
      props.nextStart,
      props.previousEnd,
      rangeMode,
      startInput,
    ],
  );
  const startNearest = evaluation.start === null ? null : nearestRhythmTime(grid, evaluation.start);
  const endNearest = evaluation.end === null ? null : nearestRhythmTime(grid, evaluation.end);

  const normalizeStart = () => {
    const value = parseTimeInput(startInput);
    if (value !== null) setStartInput(formatTimeInput(value));
  };
  const normalizeExtent = () => {
    const value = parseTimeInput(extentInput);
    if (value !== null) setExtentInput(formatTimeInput(value));
  };

  const changeStartByKeyboard = (direction: -1 | 1, event: React.KeyboardEvent<HTMLInputElement>) => {
    const currentStart = parseTimeInput(startInput) ?? props.segment?.start ?? 0;
    const currentExtent = parseTimeInput(extentInput);
    if (props.mode === "cut") {
      const step = cutTimeArrowStep(event.shiftKey, event.ctrlKey);
      const fixedEnd = rangeMode === "end" ? currentExtent : null;
      const duration = rangeMode === "duration" ? currentExtent : null;
      const maximum = duration !== null
        ? Math.min(props.mediaDuration - duration, (props.nextStart ?? props.mediaDuration) - duration)
        : Math.min((fixedEnd ?? props.mediaDuration) - 0.1, props.mediaDuration);
      setStartInput(formatTimeInput(clamp(currentStart + direction * step, 0, Math.max(0, maximum))));
      return;
    }
    const fixedEnd = rangeMode === "end" ? currentExtent : null;
    const duration = rangeMode === "duration" ? currentExtent : null;
    const minimum = Math.max(0, props.previousEnd ?? 0);
    const maximum = duration !== null
      ? Math.min(props.mediaDuration - duration, (props.nextStart ?? props.mediaDuration) - duration)
      : (fixedEnd ?? props.mediaDuration) - 0.000001;
    const next = adjacentRhythmTime(grid, currentStart, direction, minimum, maximum);
    if (next !== null) setStartInput(formatTimeInput(next));
  };

  const changeExtentByKeyboard = (direction: -1 | 1, event: React.KeyboardEvent<HTMLInputElement>) => {
    const start = parseTimeInput(startInput) ?? props.segment?.start ?? 0;
    const currentExtent = parseTimeInput(extentInput);
    const currentEnd = rangeMode === "duration"
      ? start + (currentExtent ?? Math.max(0, (props.segment?.end ?? start) - start))
      : currentExtent ?? props.segment?.end ?? start;
    if (props.mode === "cut") {
      const step = cutTimeArrowStep(event.shiftKey, event.ctrlKey);
      const minimumEnd = start + 0.001;
      const maximumEnd = Math.min(props.mediaDuration, props.nextStart ?? props.mediaDuration);
      const end = clamp(currentEnd + direction * step, minimumEnd, maximumEnd);
      setExtentInput(formatTimeInput(rangeMode === "duration" ? end - start : end));
      return;
    }
    const minimumEnd = start + 0.000001;
    const maximumEnd = Math.min(props.mediaDuration, props.nextStart ?? props.mediaDuration);
    const next = adjacentRhythmTime(grid, currentEnd, direction, minimumEnd, maximumEnd);
    if (next !== null) setExtentInput(formatTimeInput(rangeMode === "duration" ? next - start : next));
  };

  return (
    <Dialog open={props.open} title={tr("segmentTiming.title")} onClose={props.onClose}>
      <form
        className="segment-timing-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (evaluation.valid && evaluation.start !== null && evaluation.end !== null) {
            props.onApply(evaluation.start, evaluation.end);
          }
        }}
      >
        <TimeField
          label={tr("segmentTiming.start")}
          value={startInput}
          error={evaluation.startError}
          hint={props.mode === "sub" && evaluation.start !== null && startNearest !== null && !isOnRhythmGrid(grid, evaluation.start)
            ? tr("segmentTiming.nearestGrid", { time: formatTimeInput(startNearest) })
            : null}
          onChange={setStartInput}
          onBlur={normalizeStart}
          onArrow={changeStartByKeyboard}
        />
        <fieldset className="segment-timing-mode">
          <legend>{tr("segmentTiming.specification")}</legend>
          <label>
            <input
              type="radio"
              name="segment-timing-mode"
              checked={rangeMode === "duration"}
              onChange={() => {
                if (evaluation.start !== null && evaluation.end !== null) {
                  setExtentInput(formatTimeInput(evaluation.end - evaluation.start));
                }
                setRangeMode("duration");
              }}
            />
            {tr("segmentTiming.durationMode")}
          </label>
          <label>
            <input
              type="radio"
              name="segment-timing-mode"
              checked={rangeMode === "end"}
              onChange={() => {
                if (evaluation.end !== null) setExtentInput(formatTimeInput(evaluation.end));
                setRangeMode("end");
              }}
            />
            {tr("segmentTiming.endMode")}
          </label>
        </fieldset>
        <TimeField
          label={rangeMode === "duration" ? tr("segmentTiming.duration") : tr("segmentTiming.end")}
          value={extentInput}
          error={evaluation.extentError}
          hint={null}
          onChange={setExtentInput}
          onBlur={normalizeExtent}
          onArrow={changeExtentByKeyboard}
        />
        {props.mode === "sub" && evaluation.end !== null && endNearest !== null && !isOnRhythmGrid(grid, evaluation.end) ? (
          <span className="settings-field-help">
            {tr("segmentTiming.nearestEndGrid", { time: formatTimeInput(endNearest) })}
          </span>
        ) : null}
        {evaluation.rangeError ? (
          <p className="settings-field-error segment-timing-error" role="alert">{evaluation.rangeError}</p>
        ) : null}
        {evaluation.start !== null && evaluation.end !== null ? (
          <dl className="segment-timing-summary">
            <div><dt>{tr("segmentTiming.start")}</dt><dd>{formatTimeInput(evaluation.start)}</dd></div>
            <div><dt>{tr("segmentTiming.end")}</dt><dd>{formatTimeInput(evaluation.end)}</dd></div>
            <div><dt>{tr("segmentTiming.duration")}</dt><dd>{formatTimeInput(evaluation.end - evaluation.start)}</dd></div>
          </dl>
        ) : null}
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={props.onClose}>{tr("common.cancel")}</Button>
          <Button type="submit" disabled={!evaluation.valid}>{tr("segmentTiming.apply")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function TimeField(props: {
  label: string;
  value: string;
  error: string | null;
  hint: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
  onArrow: (direction: -1 | 1, event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="settings-field segment-timing-field">
      <span>{props.label}</span>
      <Input
        value={props.value}
        inputMode="decimal"
        aria-invalid={Boolean(props.error)}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onBlur={props.onBlur}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          props.onArrow(event.key === "ArrowUp" ? 1 : -1, event);
        }}
      />
      {props.hint ? <span className="settings-field-help">{props.hint}</span> : null}
      {props.error ? <span className="settings-field-error" role="alert">{props.error}</span> : null}
    </label>
  );
}

function evaluateTiming(input: {
  startInput: string;
  extentInput: string;
  rangeMode: RangeMode;
  mode: "cut" | "sub";
  mediaDuration: number;
  previousEnd?: number;
  nextStart?: number;
}) {
  const start = parseTimeInput(input.startInput);
  const extent = parseTimeInput(input.extentInput);
  const startError = start === null ? tr("segmentTiming.invalidTime") : null;
  const extentError = extent === null ? tr("segmentTiming.invalidTime") : null;
  const end = start === null || extent === null
    ? null
    : input.rangeMode === "duration"
      ? start + extent
      : extent;
  let rangeError: string | null = null;
  const minimumLength = input.mode === "cut" ? 0.001 : 0.000001;
  if (start !== null && end !== null) {
    if (end - start < minimumLength) rangeError = tr("segmentTiming.positiveDuration");
    else if (start < 0 || end > input.mediaDuration + 0.000001) rangeError = tr("segmentTiming.outOfMedia");
    else if (input.mode === "sub" && input.previousEnd !== undefined && start < input.previousEnd - 0.000001) {
      rangeError = tr("segmentTiming.previousOverlap");
    } else if (input.mode === "sub" && input.nextStart !== undefined && end > input.nextStart + 0.000001) {
      rangeError = tr("segmentTiming.nextOverlap");
    }
  }
  return {
    start,
    end,
    startError,
    extentError,
    rangeError,
    valid: startError === null && extentError === null && rangeError === null,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

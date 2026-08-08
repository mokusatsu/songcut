import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createCutBoundaryPolicy,
  resolveBoundaryRange,
  type BoundaryPolicy,
} from "@/lib/boundaries";
import {
  adjacentRhythmTime,
  cutTimeArrowStep,
  formatTimeInput,
  isOnRhythmGrid,
  nearestRhythmTime,
  parseTimeInput,
} from "@/lib/segmentTiming";
import {
  createSubtitleBoundaryPolicy,
  normalizeSubtitleStyle,
  type RhythmGridPoint,
  type SubtitleStyle,
} from "@/lib/subtitles";
import {
  normalizeSubtitleEffect,
  type SubtitleEffectSettings,
} from "@/lib/subtitleEffects";
import { TIME_RANGE_EPSILON } from "@/lib/timeRange";
import { tr } from "@/i18n";

export type SegmentTimingTarget = {
  id: string;
  start: number;
  end: number;
  style_override?: SubtitleStyle;
  effect_override?: SubtitleEffectSettings;
};

export type SegmentStyleEditorProps = {
  style: SubtitleStyle;
  effect: SubtitleEffectSettings;
  onChange: (style: SubtitleStyle) => void;
  onEffectChange: (effect: SubtitleEffectSettings) => void;
};

export type SegmentStyleDraftState = {
  mode: "inherit" | "custom";
  style: SubtitleStyle;
  effect: SubtitleEffectSettings;
};

type RangeMode = "duration" | "end";

/** `SegmentTimingDialog`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function SegmentTimingDialog(props: {
  open: boolean;
  mode: "cut" | "sub";
  segment: SegmentTimingTarget | null;
  mediaDuration: number;
  previousEnd?: number;
  nextStart?: number;
  rhythmGrid?: readonly RhythmGridPoint[];
  styleOptions?: {
    inheritedStyle: SubtitleStyle;
    inheritedEffect: SubtitleEffectSettings;
    renderEditor: (props: SegmentStyleEditorProps) => React.ReactNode;
  };
  onClose: () => void;
  onApply: (
    start: number,
    end: number,
    styleOverride?: SubtitleStyle,
    effectOverride?: SubtitleEffectSettings,
  ) => void;
}) {
  const [rangeMode, setRangeMode] = useState<RangeMode>("duration");
  const [startInput, setStartInput] = useState("0:00.000");
  const [extentInput, setExtentInput] = useState("0:00.000");
  const [activeTab, setActiveTab] = useState<"timing" | "style">("timing");
  const [styleMode, setStyleMode] = useState<"inherit" | "custom">("inherit");
  const [styleDraft, setStyleDraft] = useState<SubtitleStyle | null>(null);
  const [effectDraft, setEffectDraft] = useState<SubtitleEffectSettings | null>(null);
  const grid = props.rhythmGrid ?? [];
  const policy = useMemo(
    () => props.mode === "cut"
      ? createCutBoundaryPolicy("dialog")
      : createSubtitleBoundaryPolicy(grid),
    [grid, props.mode],
  );

  useEffect(() => {
    if (!props.open || !props.segment) return;
    setRangeMode("duration");
    setActiveTab("timing");
    setStartInput(formatTimeInput(props.segment.start));
    setExtentInput(formatTimeInput(props.segment.end - props.segment.start));
    const styleState = createSegmentStyleDraft(
      props.segment,
      props.styleOptions?.inheritedStyle,
      props.styleOptions?.inheritedEffect,
    );
    setStyleMode(styleState.mode);
    setStyleDraft(styleState.style);
    setEffectDraft(styleState.effect);
  }, [props.open, props.segment?.id]);

  const evaluation = useMemo(
    () => evaluateSegmentTiming({
      startInput,
      extentInput,
      rangeMode,
      mode: props.mode,
      policy,
      mediaDuration: props.mediaDuration,
      previousEnd: props.mode === "cut" ? 0 : props.previousEnd,
      nextStart: props.mode === "cut" ? props.mediaDuration : props.nextStart,
    }),
    [
      extentInput,
      props.mediaDuration,
      props.mode,
      props.nextStart,
      props.previousEnd,
      policy,
      rangeMode,
      startInput,
    ],
  );
  const startNearest = evaluation.proposedStart === null ? null : nearestRhythmTime(grid, evaluation.proposedStart);
  const endNearest = evaluation.proposedEnd === null ? null : nearestRhythmTime(grid, evaluation.proposedEnd);

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
        : Math.min((fixedEnd ?? props.mediaDuration) - policy.minimumDuration, props.mediaDuration);
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
      const minimumEnd = start + policy.minimumDuration;
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
    <Dialog
      open={props.open}
      title={tr(props.styleOptions ? "segmentTiming.settingsTitle" : "segmentTiming.title")}
      className={props.styleOptions ? "segment-settings-dialog" : undefined}
      onClose={props.onClose}
    >
      <form
        className="segment-timing-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (evaluation.valid && evaluation.start !== null && evaluation.end !== null) {
            props.onApply(
              evaluation.start,
              evaluation.end,
              styleMode === "custom" ? styleDraft ?? undefined : undefined,
              styleMode === "custom" ? effectDraft ?? undefined : undefined,
            );
          }
        }}
      >
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "timing" | "style")}>
          {props.styleOptions ? (
            <TabsList className="segment-settings-tabs" aria-label={tr("segmentTiming.tabsLabel")}>
              <TabsTrigger value="timing">{tr("segmentTiming.timingTab")}</TabsTrigger>
              <TabsTrigger value="style">{tr("segmentTiming.styleTab")}</TabsTrigger>
            </TabsList>
          ) : null}
          <TabsContent value="timing" className="segment-settings-content">
            <TimeField
              label={tr("segmentTiming.start")}
              value={startInput}
              error={evaluation.startError}
              hint={props.mode === "sub" && evaluation.proposedStart !== null && startNearest !== null && !isOnRhythmGrid(grid, evaluation.proposedStart)
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
            {props.mode === "sub" && evaluation.proposedEnd !== null && endNearest !== null && !isOnRhythmGrid(grid, evaluation.proposedEnd) ? (
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
          </TabsContent>
          {props.styleOptions && styleDraft && effectDraft ? (
            <TabsContent value="style" className="segment-settings-content segment-style-content">
              <ScrollArea
                className="segment-style-scroll"
                viewportClassName="segment-style-scroll-viewport"
                scrollbars={["vertical"]}
                type="always"
              >
                <div className="segment-style-scroll-content">
                  <fieldset className="segment-style-mode">
                    <legend>{tr("segmentTiming.styleMode")}</legend>
                    <label>
                      <input
                        type="radio"
                        name="segment-style-mode"
                        checked={styleMode === "inherit"}
                        onChange={() => setStyleMode("inherit")}
                      />
                      {tr("segmentTiming.inheritStyle")}
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="segment-style-mode"
                        checked={styleMode === "custom"}
                        onChange={() => setStyleMode("custom")}
                      />
                      {tr("segmentTiming.customStyle")}
                    </label>
                  </fieldset>
                  <fieldset className="segment-style-editor-frame" disabled={styleMode === "inherit"}>
                    {props.styleOptions.renderEditor({
                      style: styleDraft,
                      effect: effectDraft,
                      onChange: setStyleDraft,
                      onEffectChange: setEffectDraft,
                    })}
                  </fieldset>
                </div>
              </ScrollArea>
            </TabsContent>
          ) : null}
        </Tabs>
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={props.onClose}>{tr("common.cancel")}</Button>
          <Button type="submit" disabled={!evaluation.valid}>{tr("segmentTiming.apply")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** ダイアログを開いた時点の継承／独自モードと編集用Style／Effect draftを作る。 */
export function createSegmentStyleDraft(
  segment: SegmentTimingTarget,
  inheritedStyle?: SubtitleStyle,
  inheritedEffect?: SubtitleEffectSettings,
): SegmentStyleDraftState {
  const custom = Boolean(segment.style_override && segment.effect_override);
  return {
    mode: custom ? "custom" : "inherit",
    style: normalizeSubtitleStyle(custom ? segment.style_override : inheritedStyle),
    effect: normalizeSubtitleEffect(custom ? segment.effect_override : inheritedEffect),
  };
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

/** `evaluateSegmentTiming`の現在値を検査し、後続処理に必要な判定結果を返す。 */
export function evaluateSegmentTiming(input: {
  startInput: string;
  extentInput: string;
  rangeMode: RangeMode;
  mode: "cut" | "sub";
  policy: BoundaryPolicy;
  mediaDuration: number;
  previousEnd?: number;
  nextStart?: number;
}) {
  const proposedStart = parseTimeInput(input.startInput);
  const extent = parseTimeInput(input.extentInput);
  const startError = proposedStart === null ? tr("segmentTiming.invalidTime") : null;
  const extentError = extent === null ? tr("segmentTiming.invalidTime") : null;
  const proposedEnd = proposedStart === null || extent === null
    ? null
    : input.rangeMode === "duration"
      ? proposedStart + extent
      : extent;
  let rangeError: string | null = null;
  let resolved: { start: number; end: number } | null = null;
  if (proposedStart !== null && proposedEnd !== null) {
    if (proposedEnd - proposedStart < input.policy.minimumDuration - TIME_RANGE_EPSILON) {
      rangeError = tr("segmentTiming.positiveDuration");
    }
    else if (proposedStart < 0 || proposedEnd > input.mediaDuration + 0.000001) rangeError = tr("segmentTiming.outOfMedia");
    else if (input.mode === "sub" && input.previousEnd !== undefined && proposedStart < input.previousEnd - 0.000001) {
      rangeError = tr("segmentTiming.previousOverlap");
    } else if (input.mode === "sub" && input.nextStart !== undefined && proposedEnd > input.nextStart + 0.000001) {
      rangeError = tr("segmentTiming.nextOverlap");
    } else {
      resolved = resolveBoundaryRange(
        { start: proposedStart, end: proposedEnd },
        input.policy,
        { previousEnd: input.previousEnd, nextStart: input.nextStart },
      );
      if (!resolved) {
        if (input.previousEnd !== undefined && proposedStart <= input.previousEnd + 0.000001) {
          rangeError = tr("segmentTiming.previousOverlap");
        } else if (input.nextStart !== undefined && proposedEnd >= input.nextStart - 0.000001) {
          rangeError = tr("segmentTiming.nextOverlap");
        } else {
          rangeError = tr("segmentTiming.invalidTime");
        }
      }
    }
  }
  return {
    start: resolved?.start ?? null,
    end: resolved?.end ?? null,
    proposedStart,
    proposedEnd,
    startError,
    extentError,
    rangeError,
    valid: startError === null && extentError === null && rangeError === null,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { tr } from "@/i18n";
import {
  addSubtitleSegmentAtPosition,
  type LyricsLane,
  type LyricsSegment,
  type RhythmGridPoint,
  type SubtitleSegmentAddPosition,
  type SubtitleSegmentAddRequest,
} from "@/lib/subtitles";
import { formatTimeInput } from "@/lib/segmentTiming";

export type SelectedSubtitleSegment = {
  laneId: string;
  segment: LyricsSegment;
};

export type SegmentAddDialogProps = {
  open: boolean;
  lanes: readonly LyricsLane[];
  activeLaneId: string;
  selectedSegment: SelectedSubtitleSegment | null;
  currentTime: number;
  rhythmGrid: readonly RhythmGridPoint[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (request: SubtitleSegmentAddRequest) => void;
};

export type SegmentAddPositionOption = {
  value: SubtitleSegmentAddPosition;
  label: string;
  disabled: boolean;
};

/** `SegmentAddDialog`の入力欄と確定／Cancel操作を描画する。 */
export function SegmentAddDialogContent(props: {
  lanes: readonly LyricsLane[];
  targetLaneId: string;
  position: SubtitleSegmentAddPosition;
  positionOptions: readonly SegmentAddPositionOption[];
  candidate: LyricsSegment | null;
  busy: boolean;
  onTargetLaneId: (value: string) => void;
  onPosition: (value: SubtitleSegmentAddPosition) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="segment-add-dialog">
      <label className="segment-add-field">
        <span>{tr("sub.segmentAddTimeline")}</span>
        <Select
          aria-label={tr("sub.segmentAddTimeline")}
          value={props.targetLaneId}
          onChange={(event) => props.onTargetLaneId(event.currentTarget.value)}
        >
          {props.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}
        </Select>
      </label>
      <label className="segment-add-field">
        <span>{tr("sub.segmentAddPosition")}</span>
        <Select
          aria-label={tr("sub.segmentAddPosition")}
          value={props.position}
          onChange={(event) => props.onPosition(event.currentTarget.value as SubtitleSegmentAddPosition)}
        >
          {props.positionOptions.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
      <p className={props.candidate ? "dialog-message" : "segment-add-error"} role={props.candidate ? undefined : "alert"}>
        {props.candidate
          ? tr("sub.segmentAddPreview", {
              start: formatTimeInput(props.candidate.start),
              end: formatTimeInput(props.candidate.end),
            })
          : tr("sub.segmentAddNoSpace")}
      </p>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={props.onClose}>{tr("common.cancel")}</Button>
        <Button onClick={props.onConfirm} disabled={props.busy || !props.candidate}>{tr("sub.segmentAddAction")}</Button>
      </div>
    </div>
  );
}

/** 単一選択の有無に応じて、Dialogの追加位置と無効状態を組み立てる。 */
export function segmentAddPositionOptions(hasSingleSelection: boolean): SegmentAddPositionOption[] {
  return [
    { value: "start", label: tr("sub.segmentAddStart"), disabled: false },
    { value: "before", label: tr("sub.segmentAddBefore"), disabled: !hasSingleSelection },
    { value: "after", label: tr("sub.segmentAddAfter"), disabled: !hasSingleSelection },
    { value: "playback", label: tr("sub.segmentAddPlayback"), disabled: false },
  ];
}

/** Subの追加先Timelineと追加位置を選ぶ共通Dialog。 */
export function SegmentAddDialog(props: SegmentAddDialogProps) {
  const [targetLaneId, setTargetLaneId] = useState(props.activeLaneId);
  const [position, setPosition] = useState<SubtitleSegmentAddPosition>(
    props.selectedSegment ? "after" : "start",
  );

  useEffect(() => {
    if (!props.open) return;
    setTargetLaneId(props.activeLaneId);
    setPosition(props.selectedSegment ? "after" : "start");
  }, [props.open, props.activeLaneId, props.selectedSegment?.segment.id]);

  const targetLane = props.lanes.find((lane) => lane.id === targetLaneId) ?? props.lanes[0] ?? null;
  const candidate = targetLane
    ? addSubtitleSegmentAtPosition(targetLane, position, props.rhythmGrid, {
        anchor: props.selectedSegment?.segment,
        playbackTime: props.currentTime,
      })
    : null;
  const positionOptions = segmentAddPositionOptions(Boolean(props.selectedSegment));

  return (
    <Dialog open={props.open} title={tr("sub.segmentAddTitle")} onClose={props.onClose} className="segment-add-dialog-window">
      <SegmentAddDialogContent
        lanes={props.lanes}
        targetLaneId={targetLane?.id ?? ""}
        position={position}
        positionOptions={positionOptions}
        candidate={candidate}
        busy={props.busy}
        onTargetLaneId={setTargetLaneId}
        onPosition={setPosition}
        onClose={props.onClose}
        onConfirm={() => {
          if (!candidate || !targetLane) return;
          props.onConfirm({
            targetLaneId: targetLane.id,
            position,
            anchorSegmentId: props.selectedSegment?.segment.id ?? null,
            playbackTime: props.currentTime,
          });
        }}
      />
    </Dialog>
  );
}

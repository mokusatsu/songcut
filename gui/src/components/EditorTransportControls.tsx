import {
  ArrowLeft,
  ArrowRight,
  ChevronsLeft,
  ChevronsRight,
  Minus,
  Pause,
  Play,
  Plus,
  Rewind,
  SkipBack,
  SkipForward,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tr } from "@/i18n";

export type BoundaryNudgeConfig =
  | {
      kind: "seconds";
      disabled: boolean;
      value: string;
      onChange: (value: string) => void;
      onBlur: () => void;
      onLeft: () => void;
      onRight: () => void;
    }
  | {
      kind: "rhythm-grid";
      disabled: boolean;
      onLeft: () => void;
      onRight: () => void;
    };

export type EditorTransportControlsProps = {
  saveStatus: string;
  saveStatusClassName?: string;
  boundaryPreview: {
    disabled: boolean;
    value: string;
    onChange: (value: string) => void;
    onBlur: () => void;
    onStart: () => void;
    onEnd: () => void;
  };
  boundaryNudge: BoundaryNudgeConfig;
  playback: {
    onStart: () => void;
    onPrevious: () => void;
    onPlay: () => void;
    onPause: () => void;
    onNext: () => void;
  };
  zoom: {
    value: number;
    onIn: () => void;
    onOut: () => void;
    onReset: () => void;
  };
};

export function EditorTransportControls(props: EditorTransportControlsProps) {
  const nudge = props.boundaryNudge;
  const nudgeLeftTitle = nudge.kind === "seconds" ? tr("controls.nudgeLeft") : tr("controls.nudgeRhythmLeft");
  const nudgeRightTitle = nudge.kind === "seconds" ? tr("controls.nudgeRight") : tr("controls.nudgeRhythmRight");

  return (
    <>
      <span className={`project-save-status${props.saveStatusClassName ? ` ${props.saveStatusClassName}` : ""}`}>
        {props.saveStatus}
      </span>
      <div className="icon-group boundary-controls">
        <Button size="icon" variant="ghost" onClick={props.boundaryPreview.onStart} disabled={props.boundaryPreview.disabled} title={tr("controls.playStart")} aria-keyshortcuts="A">
          <SkipBack size={17} />
        </Button>
        <Button size="icon" variant="ghost" onClick={props.boundaryPreview.onEnd} disabled={props.boundaryPreview.disabled} title={tr("controls.playEnd")} aria-keyshortcuts="D">
          <SkipForward size={17} />
        </Button>
        <Input className="boundary-seconds-input" type="number" min="1" max="60" step="1" inputMode="numeric" pattern="[0-9]*" aria-label={tr("controls.boundarySeconds")} value={props.boundaryPreview.value} onChange={(event) => props.boundaryPreview.onChange(event.currentTarget.value)} onBlur={props.boundaryPreview.onBlur} />
      </div>
      <div className="icon-group boundary-nudge-controls">
        <Button size="icon" variant="ghost" onClick={nudge.onLeft} disabled={nudge.disabled} title={nudgeLeftTitle} aria-keyshortcuts="Q">
          <ArrowLeft size={17} />
        </Button>
        <Button size="icon" variant="ghost" onClick={nudge.onRight} disabled={nudge.disabled} title={nudgeRightTitle} aria-keyshortcuts="E">
          <ArrowRight size={17} />
        </Button>
        {nudge.kind === "seconds" ? (
          <Input className="boundary-nudge-seconds-input" type="number" min="0.1" max="60" step="0.1" inputMode="decimal" aria-label={tr("controls.nudgeSeconds")} value={nudge.value} onChange={(event) => nudge.onChange(event.currentTarget.value)} onBlur={nudge.onBlur} />
        ) : null}
      </div>
      <div className="icon-group">
        <Button size="icon" variant="ghost" onClick={props.playback.onStart} title={tr("controls.start")}><Rewind size={17} /></Button>
        <Button size="icon" variant="ghost" onClick={props.playback.onPrevious} title={tr("controls.previous")} aria-keyshortcuts="Control+A"><ChevronsLeft size={17} /></Button>
        <Button size="icon" variant="ghost" onClick={props.playback.onPlay} title={tr("controls.play")} aria-keyshortcuts="Space"><Play size={17} /></Button>
        <Button size="icon" variant="ghost" onClick={props.playback.onPause} title={tr("controls.pause")} aria-keyshortcuts="Space"><Pause size={17} /></Button>
        <Button size="icon" variant="ghost" onClick={props.playback.onNext} title={tr("controls.next")} aria-keyshortcuts="Control+D"><ChevronsRight size={17} /></Button>
      </div>
      <div className="icon-group">
        <Button size="icon" variant="ghost" onClick={props.zoom.onOut} title={tr("controls.zoomOut")} aria-keyshortcuts="Z"><Minus size={17} /></Button>
        <Button variant="ghost" size="sm" onClick={props.zoom.onReset} title={tr("controls.zoomReset")} aria-keyshortcuts="X">{Math.round(props.zoom.value * 100)}%</Button>
        <Button size="icon" variant="ghost" onClick={props.zoom.onIn} title={tr("controls.zoomIn")} aria-keyshortcuts="C"><Plus size={17} /></Button>
      </div>
    </>
  );
}

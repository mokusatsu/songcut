import type * as React from "react";
import { FolderOpen, Settings2, Wand2 } from "lucide-react";

import { EditorTransportControls } from "@/components/EditorTransportControls";
import { Button } from "@/components/ui/button";
import { tr } from "@/i18n";
import type { ModeTransportViewModel } from "@/lib/modeViewModel";

export type ModeToolbarCommand = {
  onClick: () => void;
  disabled?: boolean;
};

export type ModeToolbarProps = {
  className?: string;
  transport: ModeTransportViewModel;
  load: ModeToolbarCommand;
  analyze: ModeToolbarCommand;
  exportAction: ModeToolbarCommand & { icon: React.ReactNode };
  settings: ModeToolbarCommand;
  children?: React.ReactNode;
};

/** Common command order and transport placement for Cut and Sub editors. */
export function ModeToolbar(props: ModeToolbarProps) {
  const className = ["toolbar", props.className].filter(Boolean).join(" ");
  return (
    <header className={className}>
      <Button onClick={props.load.onClick} disabled={props.load.disabled}>
        <FolderOpen size={16} />
        {tr("common.load")}
      </Button>
      <Button onClick={props.analyze.onClick} disabled={props.analyze.disabled}>
        <Wand2 size={16} />
        {tr("common.analyze")}
      </Button>
      <Button
        variant="secondary"
        onClick={props.exportAction.onClick}
        disabled={props.exportAction.disabled}
      >
        {props.exportAction.icon}
        {tr("common.export")}
      </Button>
      {props.children}
      <Button variant="secondary" onClick={props.settings.onClick} disabled={props.settings.disabled}>
        <Settings2 size={16} />
        {tr("common.settings")}
      </Button>
      <div className="spacer" />
      <EditorTransportControls {...props.transport} />
    </header>
  );
}

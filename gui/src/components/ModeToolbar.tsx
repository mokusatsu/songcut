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
  information: React.ReactNode;
  load: ModeToolbarCommand;
  analyze: ModeToolbarCommand;
  exportAction: ModeToolbarCommand & { icon: React.ReactNode };
  settings: ModeToolbarCommand;
  children?: React.ReactNode;
};

/** Common command order and transport placement for Cut and Sub editors. */
/** `ModeToolbar`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function ModeToolbar(props: ModeToolbarProps) {
  const className = ["mode-workspace-header", props.className].filter(Boolean).join(" ");
  return (
    <header className={className}>
      <div className="mode-workspace-controls">
        <div className="toolbar mode-toolbar-actions">
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
          {props.information}
          <Button variant="secondary" onClick={props.settings.onClick} disabled={props.settings.disabled}>
            <Settings2 size={16} />
            {tr("common.settings")}
          </Button>
        </div>
        <div className="mode-transport-toolbar">
          <EditorTransportControls {...props.transport} />
        </div>
      </div>
    </header>
  );
}

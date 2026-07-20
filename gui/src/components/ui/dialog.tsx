import type { PropsWithChildren } from "react";
import { Button } from "./button";
import { tr } from "@/i18n";

type DialogProps = PropsWithChildren<{
  open: boolean;
  title: string;
  onClose: () => void;
}>;

export function Dialog({ open, title, onClose, children }: DialogProps) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {tr("common.close")}
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

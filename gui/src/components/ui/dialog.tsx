import type { PropsWithChildren } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";
import { tr } from "@/i18n";
import { cn } from "@/lib/utils";

type DialogProps = PropsWithChildren<{
  open: boolean;
  title: string;
  onClose: () => void;
  className?: string;
}>;

export function Dialog({ open, title, onClose, className, children }: DialogProps) {
  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className={cn("dialog", className)} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {tr("common.close")}
          </Button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

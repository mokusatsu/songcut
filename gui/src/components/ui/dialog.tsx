import { useRef, type PropsWithChildren } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";
import { NormalFocusScope, useDialogFocus } from "./editor-focus";
import { tr } from "@/i18n";
import { cn } from "@/lib/utils";

type DialogProps = PropsWithChildren<{
  open: boolean;
  title: string;
  onClose: () => void;
  className?: string;
}>;

export function Dialog({ open, title, onClose, className, children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useDialogFocus({ open, dialogRef, initialFocusRef: closeButtonRef });

  if (!open) return null;
  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <NormalFocusScope>
        <div
          ref={dialogRef}
          className={cn("dialog", className)}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="dialog-header">
            <h2>{title}</h2>
            <Button ref={closeButtonRef} variant="ghost" size="sm" onClick={onClose}>
              {tr("common.close")}
            </Button>
          </div>
          {children}
        </div>
      </NormalFocusScope>
    </div>,
    document.body
  );
}

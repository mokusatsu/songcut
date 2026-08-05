import * as React from "react";
import { cn } from "@/lib/utils";
import { useEditorActionFocusProps } from "./editor-focus";

export const Checkbox = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, tabIndex, onClick, ...props }, ref) => {
    const actionFocus = useEditorActionFocusProps<HTMLInputElement>(onClick, tabIndex);
    return (
      <input
        {...props}
        ref={ref}
        type="checkbox"
        className={cn("checkbox", className)}
        {...actionFocus}
      />
    );
  }
);
Checkbox.displayName = "Checkbox";

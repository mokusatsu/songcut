import * as React from "react";
import { cn } from "@/lib/utils";
import { useEditorActionFocusProps } from "./editor-focus";

/** `Checkbox`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
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

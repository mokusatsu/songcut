import * as React from "react";
import { cn } from "@/lib/utils";
import { useEditorActionFocusProps } from "./editor-focus";

export type ToggleProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
};

export const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
  ({ pressed, onPressedChange, className, tabIndex, onClick, ...props }, ref) => {
    const handleToggleClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
      onPressedChange(!pressed);
      onClick?.(event);
    };
    const actionFocus = useEditorActionFocusProps<HTMLButtonElement>(handleToggleClick, tabIndex);

    return (
      <button
        {...props}
        ref={ref}
        type="button"
        aria-pressed={pressed}
        data-state={pressed ? "on" : "off"}
        className={cn("toggle", className)}
        {...actionFocus}
      />
    );
  }
);
Toggle.displayName = "Toggle";

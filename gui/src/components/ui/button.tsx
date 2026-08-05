import * as React from "react";
import { cn } from "@/lib/utils";
import { useEditorActionFocusProps } from "./editor-focus";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", tabIndex, onClick, ...props }, ref) => {
    const actionFocus = useEditorActionFocusProps<HTMLButtonElement>(onClick, tabIndex);
    return (
      <button
        {...props}
        ref={ref}
        className={cn("button", `button-${variant}`, `button-${size}`, className)}
        {...actionFocus}
      />
    );
  }
);
Button.displayName = "Button";

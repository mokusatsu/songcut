import * as React from "react";
import { cn } from "@/lib/utils";
import { useEditorTextEntryKeyDown } from "./editor-focus";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, onKeyDown, ...props }, ref) => {
    const handleKeyDown = useEditorTextEntryKeyDown<HTMLInputElement>(onKeyDown);
    return <input ref={ref} className={cn("input", className)} onKeyDown={handleKeyDown} {...props} />;
  }
);
Input.displayName = "Input";

export { Input };

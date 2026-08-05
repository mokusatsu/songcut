import * as React from "react";
import { cn } from "@/lib/utils";
import { useEditorTextEntryKeyDown } from "./editor-focus";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, onKeyDown, ...props }, ref) => {
    const handleKeyDown = useEditorTextEntryKeyDown<HTMLTextAreaElement>(onKeyDown);
    return <textarea ref={ref} className={cn("textarea", className)} onKeyDown={handleKeyDown} {...props} />;
  }
);
Textarea.displayName = "Textarea";

export { Textarea };

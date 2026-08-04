import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <span className={cn("select-wrap", className)}>
      <select ref={ref} className="select" {...props}>{children}</select>
      <ChevronDown size={15} aria-hidden="true" />
    </span>
  )
);
Select.displayName = "Select";

export { Select };

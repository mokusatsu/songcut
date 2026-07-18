import * as React from "react";
import { cn } from "@/lib/utils";

export function Checkbox(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} type="checkbox" className={cn("checkbox", props.className)} />;
}

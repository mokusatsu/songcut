import * as React from "react";
import { cn } from "@/lib/utils";

type ToggleProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
};

export function Toggle({ pressed, onPressedChange, className, ...props }: ToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-state={pressed ? "on" : "off"}
      className={cn("toggle", className)}
      onClick={() => onPressedChange(!pressed)}
      {...props}
    />
  );
}

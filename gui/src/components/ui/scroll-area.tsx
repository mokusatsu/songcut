import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/utils";

type ScrollAreaProps = React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportClassName?: string;
  scrollbars?: Array<"horizontal" | "vertical">;
};

const ScrollArea = React.forwardRef<React.ElementRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  ({ className, children, viewportRef, viewportClassName, scrollbars = ["vertical"], ...props }, ref) => (
    <ScrollAreaPrimitive.Root ref={ref} className={cn("scroll-area", className)} {...props}>
      <ScrollAreaPrimitive.Viewport ref={viewportRef} className={cn("scroll-area-viewport", viewportClassName)}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      {scrollbars.includes("vertical") ? <ScrollBar orientation="vertical" /> : null}
      {scrollbars.includes("horizontal") ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner className="scroll-area-corner" />
    </ScrollAreaPrimitive.Root>
  )
);
ScrollArea.displayName = "ScrollArea";

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "scroll-area-scrollbar",
      orientation === "vertical" ? "scroll-area-scrollbar-vertical" : "scroll-area-scrollbar-horizontal",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="scroll-area-thumb" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };

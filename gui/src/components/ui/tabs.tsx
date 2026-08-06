import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useEditorActionFocusProps } from "./editor-focus";
import { useFocusScope } from "./editor-focus";

type TabsProps = Omit<React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>, "onValueChange"> & {
  onValueChange?: (value: string) => void | Promise<void>;
};

/** `Tabs`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export const Tabs = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Root>, TabsProps>(
  ({ onValueChange, ...props }, ref) => {
    const focusScope = useFocusScope();
    const handleValueChange = (value: string) => {
      const result = onValueChange?.(value);
      if (focusScope.kind === "editor") {
        void Promise.resolve(result).finally(() => focusScope.restoreAfterAction());
      }
    };
    return <TabsPrimitive.Root {...props} ref={ref} onValueChange={handleValueChange} />;
  }
);
Tabs.displayName = TabsPrimitive.Root.displayName;

/** `TabsList`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn("tabs-list", className)} {...props} />
));
TabsList.displayName = TabsPrimitive.List.displayName;

/** `TabsTrigger`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, tabIndex, onClick, ...props }, ref) => {
  const actionFocus = useEditorActionFocusProps<HTMLButtonElement>(onClick, tabIndex);
  return (
    <TabsPrimitive.Trigger
      {...props}
      ref={ref}
      className={cn("tabs-trigger", className)}
      {...actionFocus}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = TabsPrimitive.Content;

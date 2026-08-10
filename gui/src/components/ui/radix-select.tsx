import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/** `RadixSelectTrigger`の選択欄をアプリの共通select意匠で描画する。 */
const RadixSelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn("radix-select-trigger", className)}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="radix-select-trigger-icon" size={15} aria-hidden="true" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
RadixSelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

/** `RadixSelectContent`のportalとスクロール可能なoption一覧を描画する。 */
const RadixSelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn("radix-select-content", className)}
      position={position}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="radix-select-scroll-button" aria-hidden="true">
        <ChevronUp size={15} />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className="radix-select-viewport">
        {children}
      </SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="radix-select-scroll-button" aria-hidden="true">
        <ChevronDown size={15} />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
RadixSelectContent.displayName = SelectPrimitive.Content.displayName;

/** `RadixSelectItem`のoption表示と選択済みチェック表示を描画する。 */
const RadixSelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn("radix-select-item", className)}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="radix-select-item-indicator">
      <Check size={15} aria-hidden="true" />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
));
RadixSelectItem.displayName = SelectPrimitive.Item.displayName;

/** `RadixSelectLabel`のeffect category見出しを描画する。 */
const RadixSelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn("radix-select-label", className)} {...props} />
));
RadixSelectLabel.displayName = SelectPrimitive.Label.displayName;

/** `RadixSelect`で利用するRadix rootを公開する。 */
const RadixSelect = SelectPrimitive.Root;

/** `RadixSelectValue`で選択中の表示文字列を公開する。 */
const RadixSelectValue = SelectPrimitive.Value;

/** `RadixSelectGroup`でoption categoryをまとめる。 */
const RadixSelectGroup = SelectPrimitive.Group;

export {
  RadixSelect,
  RadixSelectContent,
  RadixSelectGroup,
  RadixSelectItem,
  RadixSelectLabel,
  RadixSelectTrigger,
  RadixSelectValue,
};

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";

export function HelpTooltip(props: { label: string; children: ReactNode }) {
  const id = `help-${useId().replace(/:/g, "")}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const place = () => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;
    const anchor = trigger.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const gap = 8;
    let top = anchor.bottom + gap;
    if (top + box.height > window.innerHeight - gap) top = anchor.top - box.height - gap;
    setPosition({
      left: Math.max(gap, Math.min(window.innerWidth - box.width - gap, anchor.left + anchor.width / 2 - box.width / 2)),
      top: Math.max(gap, Math.min(window.innerHeight - box.height - gap, top)),
    });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, props.children]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return (
    <span className="help-tooltip-label">
      <span>{props.label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="help-tooltip-trigger"
        aria-label={`${props.label} help`}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <CircleHelp aria-hidden="true" size={15} />
      </button>
      {open
        ? createPortal(
            <div
              ref={tooltipRef}
              id={id}
              role="tooltip"
              className="help-tooltip"
              style={{ left: position.left, top: position.top }}
            >
              {props.children}
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

import { useEffect, useRef } from "react";

/** The small event shape needed by the shared boundary drag lifecycle. */
export type BoundaryDragPoint = {
  clientX: number;
  pointerId?: number;
  preventDefault?: () => void;
};

export type BoundaryDragListener = (event: BoundaryDragPoint) => void;

/**
 * A narrow event-target interface keeps the lifecycle pure-testable without a
 * DOM harness while still accepting `window` in the renderer.
 */
export type BoundaryDragEventTarget = {
  addEventListener: (type: string, listener: BoundaryDragListener) => void;
  removeEventListener: (type: string, listener: BoundaryDragListener) => void;
};

export type BoundaryDragCallbacks = {
  onPreview: (clientX: number) => void;
  onCommit: () => void;
  onEditingChange?: (editing: boolean) => void;
  onCancel?: () => void;
  /** Preserve mode-specific historical cancel semantics when required. */
  commitOnCancel?: boolean;
};

export type BoundaryDragController = {
  startPointer: (event: BoundaryDragPoint & { pointerId: number }) => boolean;
  startMouse: (event: BoundaryDragPoint) => boolean;
  /** Cancel the active drag and run the configured cancel callback. */
  cancel: () => void;
  /** Remove listeners during unmount and roll back an active draft. */
  dispose: () => void;
  isActive: () => boolean;
};

type DragKind = "pointer" | "mouse";

type ActiveDrag = {
  kind: DragKind;
  pointerId: number | null;
};

const defaultEventTarget = (): BoundaryDragEventTarget | null => {
  if (typeof window === "undefined") return null;
  return window as unknown as BoundaryDragEventTarget;
};

/**
 * Create the common start/move/release/cancel lifecycle used by Cut and Sub.
 * Boundary conversion and mode policy stay in the callbacks; this helper only
 * owns global listener lifetime and exactly-once release commit semantics.
 */
export function createBoundaryDragLifecycle(
  callbacks: BoundaryDragCallbacks,
  eventTarget: BoundaryDragEventTarget | null = defaultEventTarget(),
): BoundaryDragController {
  let active: ActiveDrag | null = null;

  const onPointerMove: BoundaryDragListener = (event) => {
    if (!active || active.kind !== "pointer" || event.pointerId !== active.pointerId) return;
    event.preventDefault?.();
    callbacks.onPreview(event.clientX);
  };
  const onPointerUp: BoundaryDragListener = (event) => {
    if (!active || active.kind !== "pointer" || event.pointerId !== active.pointerId) return;
    finish("release");
  };
  const onPointerCancel: BoundaryDragListener = (event) => {
    if (!active || active.kind !== "pointer" || event.pointerId !== active.pointerId) return;
    finish("cancel");
  };
  const onMouseMove: BoundaryDragListener = (event) => {
    if (!active || active.kind !== "mouse") return;
    event.preventDefault?.();
    callbacks.onPreview(event.clientX);
  };
  const onMouseUp: BoundaryDragListener = () => {
    if (!active || active.kind !== "mouse") return;
    finish("release");
  };

  function addListeners(kind: DragKind) {
    if (!eventTarget) return;
    if (kind === "pointer") {
      eventTarget.addEventListener("pointermove", onPointerMove);
      eventTarget.addEventListener("pointerup", onPointerUp);
      eventTarget.addEventListener("pointercancel", onPointerCancel);
      return;
    }
    eventTarget.addEventListener("mousemove", onMouseMove);
    eventTarget.addEventListener("mouseup", onMouseUp);
  }

  function removeListeners(kind: DragKind) {
    if (!eventTarget) return;
    if (kind === "pointer") {
      eventTarget.removeEventListener("pointermove", onPointerMove);
      eventTarget.removeEventListener("pointerup", onPointerUp);
      eventTarget.removeEventListener("pointercancel", onPointerCancel);
      return;
    }
    eventTarget.removeEventListener("mousemove", onMouseMove);
    eventTarget.removeEventListener("mouseup", onMouseUp);
  }

  function finish(reason: "release" | "cancel" | "dispose") {
    const current = active;
    if (!current) return;
    active = null;
    removeListeners(current.kind);

    if (reason === "cancel" || reason === "dispose") callbacks.onCancel?.();
    callbacks.onEditingChange?.(false);
    if (reason === "release" || (reason === "cancel" && callbacks.commitOnCancel)) {
      callbacks.onCommit();
    }
  }

  function start(kind: DragKind, event: BoundaryDragPoint) {
    if (active) return false;
    active = {
      kind,
      pointerId: kind === "pointer" ? event.pointerId ?? null : null,
    };
    callbacks.onEditingChange?.(true);
    callbacks.onPreview(event.clientX);
    addListeners(kind);
    return true;
  }

  return {
    startPointer: (event) => start("pointer", event),
    startMouse: (event) => start("mouse", event),
    cancel: () => finish("cancel"),
    dispose: () => finish("dispose"),
    isActive: () => active !== null,
  };
}

export type UseBoundaryDragOptions = BoundaryDragCallbacks & {
  eventTarget?: BoundaryDragEventTarget | null;
};

/** React adapter for the pure lifecycle. Callbacks are kept current without
 * recreating the controller, so rapid preview renders cannot capture stale
 * mode state or geometry. */
export function useBoundaryDrag(options: UseBoundaryDragOptions): BoundaryDragController {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const controllerRef = useRef<BoundaryDragController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createBoundaryDragLifecycle(
      {
        onPreview: (clientX) => optionsRef.current.onPreview(clientX),
        onCommit: () => optionsRef.current.onCommit(),
        onEditingChange: (editing) => optionsRef.current.onEditingChange?.(editing),
        onCancel: () => optionsRef.current.onCancel?.(),
        commitOnCancel: optionsRef.current.commitOnCancel,
      },
      options.eventTarget === undefined ? defaultEventTarget() : options.eventTarget,
    );
  }
  const controller = controllerRef.current;
  useEffect(() => () => controller.dispose(), [controller]);
  return controller;
}

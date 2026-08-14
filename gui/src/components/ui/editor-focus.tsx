import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type MutableRefObject,
  type MouseEventHandler,
  type Ref,
  type RefObject,
  type SyntheticEvent,
} from "react";

/**
 * The editor intentionally keeps command buttons out of the sequential tab
 * order.  Keyboard commands remain available through the editor shortcut
 * layer, while focus is returned to the editor root after a pointer action.
 * Dialogs use the normal scope so their controls remain tab navigable.
 */
export type FocusScopeKind = "normal" | "editor";

export type FocusReturnTargetDescriptor = {
  tagName: string;
  inputType?: string | null;
  role?: string | null;
};

export type FocusScopeContextValue = {
  kind: FocusScopeKind;
  rootRef: RefObject<HTMLElement | null>;
  resolveActionTabIndex: (requested: number | undefined) => number | undefined;
  restoreAfterAction: (event?: SyntheticEvent<HTMLElement>) => void;
  focusRoot: () => void;
};

const normalFocusScope: FocusScopeContextValue = {
  kind: "normal",
  rootRef: { current: null },
  resolveActionTabIndex: (requested) => requested,
  restoreAfterAction: () => undefined,
  focusRoot: () => undefined,
};

const FocusScopeContext = createContext<FocusScopeContextValue>(normalFocusScope);

/**
 * Resolve the tab stop for an action control without changing an explicit
 * value outside of an editor scope.  This is deliberately pure so it can be
 * tested without a DOM and reused by all action primitives.
 */
/** `resolveActionTabIndex`の候補と条件から、利用すべき値または操作を決定する。 */
export function resolveActionTabIndex(kind: FocusScopeKind, requested: number | undefined): number | undefined {
  return kind === "editor" ? -1 : requested;
}

/** `shouldRestoreEditorRoot`の入力が要求された条件やschemaを満たすか検証する。 */
export function shouldRestoreEditorRoot(kind: FocusScopeKind, target: FocusReturnTargetDescriptor): boolean {
  if (kind !== "editor") return false;
  const tagName = target.tagName.toLowerCase();
  if (tagName === "button") return true;
  if (tagName === "input") {
    return ["button", "checkbox", "color", "file", "image", "radio", "reset", "submit"].includes(
      (target.inputType || "text").toLowerCase()
    );
  }
  const role = target.role?.toLowerCase();
  return role === "button" || role === "checkbox" || role === "radio" || role === "tab";
}

/** `shouldExitEditorTextEntry`の入力が要求された条件やschemaを満たすか検証する。 */
export function shouldExitEditorTextEntry(
  kind: FocusScopeKind,
  event: { key: string; defaultPrevented: boolean; isComposing: boolean; keyCode: number }
): boolean {
  return kind === "editor"
    && event.key === "Escape"
    && !event.defaultPrevented
    && !event.isComposing
    && event.keyCode !== 229;
}

/** Compose a consumer handler with an internal handler while respecting preventDefault. */
/** `composeEventHandlers`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function composeEventHandlers<E extends SyntheticEvent<HTMLElement>>(
  consumer: ((event: E) => void) | undefined,
  internal: ((event: E) => void) | undefined,
  checkForDefaultPrevented = true
): ((event: E) => void) | undefined {
  if (!consumer && !internal) return undefined;
  return (event) => {
    consumer?.(event);
    if (!checkForDefaultPrevented || !event.defaultPrevented) internal?.(event);
  };
}

function focusElement(element: HTMLElement | null): void {
  if (!element || !element.isConnected) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    // A few embedded WebViews expose focus() without FocusOptions support.
    element.focus();
  }
}

/** `useFocusScope`に必要な状態、派生値、副作用をReact hookとしてまとめる。 */
export function useFocusScope(): FocusScopeContextValue {
  return useContext(FocusScopeContext);
}

/** Alias that makes the editor-specific intent explicit at call sites. */
export const useEditorFocus = useFocusScope;

/**
 * Props helper for native action controls that cannot use one of the shared
 * Button/Toggle/Checkbox primitives.  Passing the consumer handler here keeps
 * preventDefault semantics identical to the common controls.
 */
/** `useEditorActionFocusProps`に必要な状態、派生値、副作用をReact hookとしてまとめる。 */
export function useEditorActionFocusProps<E extends HTMLElement = HTMLElement>(
  onClick?: MouseEventHandler<E>,
  tabIndex?: number
): Pick<HTMLAttributes<E>, "tabIndex" | "onClick"> {
  const focusScope = useFocusScope();
  return {
    tabIndex: focusScope.resolveActionTabIndex(tabIndex),
    onClick: composeEventHandlers(
      onClick,
      focusScope.restoreAfterAction as unknown as MouseEventHandler<E>
    ) as MouseEventHandler<E>,
  };
}

/** `useEditorTextEntryKeyDown`に必要な状態、派生値、副作用をReact hookとしてまとめる。 */
export function useEditorTextEntryKeyDown<E extends HTMLElement = HTMLElement>(
  onKeyDown?: KeyboardEventHandler<E>
): KeyboardEventHandler<E> {
  const focusScope = useFocusScope();
  return (event) => {
    onKeyDown?.(event);
    if (!shouldExitEditorTextEntry(focusScope.kind, {
      key: event.key,
      defaultPrevented: event.defaultPrevented,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
    })) return;
    event.preventDefault();
    event.currentTarget.blur();
    focusScope.focusRoot();
  };
}

type EditorFocusProviderProps = PropsWithChildren<{
  rootRef?: RefObject<HTMLElement | null>;
}>;

/**
 * Provide editor focus behavior without inserting a wrapper into the existing
 * layout.  Consumers should pass a ref to the existing editor root.  The
 * root must be focusable (normally `tabIndex={-1}`).
 */
/** `EditorFocusProvider`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function EditorFocusProvider({ rootRef, children }: EditorFocusProviderProps) {
  const fallbackRootRef = useRef<HTMLElement | null>(null);
  const resolvedRootRef = rootRef ?? fallbackRootRef;

  const focusRoot = useCallback(() => {
    if (typeof document !== "undefined" && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    focusElement(resolvedRootRef.current);
  }, [resolvedRootRef]);

  const restoreAfterAction = useCallback(
    (event?: SyntheticEvent<HTMLElement>) => {
      // Keep this asynchronous.  If an action opens a dialog, its layout
      // effect can capture the clicked control before the editor root is
      // focused, allowing normal dialog focus restoration on close.
      void event;
      if (typeof queueMicrotask === "function") queueMicrotask(focusRoot);
      else Promise.resolve().then(focusRoot);
      // Roving-focus widgets such as Radix Tabs may update focus after their
      // click handler while committing the new active item. Re-assert the
      // editor anchor on the next frame; focusRoot skips this when a modal
      // opened as a result of the same action.
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(focusRoot);
    },
    [focusRoot]
  );

  const value = useMemo<FocusScopeContextValue>(
    () => ({
      kind: "editor",
      rootRef: resolvedRootRef,
      resolveActionTabIndex: (requested) => resolveActionTabIndex("editor", requested),
      restoreAfterAction,
      focusRoot,
    }),
    [focusRoot, restoreAfterAction, resolvedRootRef]
  );

  return <FocusScopeContext.Provider value={value}>{children}</FocusScopeContext.Provider>;
}

type EditorFocusScopeProps = PropsWithChildren<
  HTMLAttributes<HTMLDivElement> & {
    rootRef?: Ref<HTMLDivElement>;
  }
>;

/**
 * Convenience scope that owns a focusable editor root.  Use
 * EditorFocusProvider when the editor already has a root element whose DOM
 * shape must remain unchanged.
 */
/** `EditorFocusScope`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function EditorFocusScope({ children, className, rootRef, ...props }: EditorFocusScopeProps) {
  const internalRootRef = useRef<HTMLDivElement | null>(null);
  const setRootRef = useCallback(
    (element: HTMLDivElement | null) => {
      internalRootRef.current = element;
      if (typeof rootRef === "function") rootRef(element);
      else if (rootRef) (rootRef as MutableRefObject<HTMLDivElement | null>).current = element;
    },
    [rootRef]
  );

  return (
    <EditorFocusProvider rootRef={internalRootRef}>
      <div {...props} ref={setRootRef} className={className} tabIndex={-1} data-editor-focus-root>
        {children}
      </div>
    </EditorFocusProvider>
  );
}

/**
 * Reset action-control behavior inside a modal or another ordinary focus
 * region.  The parent editor context remains available to the dialog owner,
 * but controls in this subtree keep their normal tab stops and do not return
 * focus to the editor after activation.
 */
/** `NormalFocusScope`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function NormalFocusScope({ children }: PropsWithChildren) {
  const parent = useFocusScope();
  const value = useMemo<FocusScopeContextValue>(
    () => ({
      ...parent,
      kind: "normal",
      resolveActionTabIndex: (requested) => resolveActionTabIndex("normal", requested),
      restoreAfterAction: () => undefined,
    }),
    [parent]
  );

  return <FocusScopeContext.Provider value={value}>{children}</FocusScopeContext.Provider>;
}

type DialogFocusOptions = {
  open: boolean;
  dialogRef: RefObject<HTMLElement>;
  initialFocusRef?: RefObject<HTMLElement>;
};

/**
 * Capture the opener and restore it when a dialog closes.  The hook is kept
 * independent of the Dialog markup so custom dialog shells can share the
 * same normal-scope behavior.
 */
/** `useDialogFocus`に必要な状態、派生値、副作用をReact hookとしてまとめる。 */
export function useDialogFocus({ open, dialogRef, initialFocusRef }: DialogFocusOptions): void {
  const focusScope = useFocusScope();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const restoreReturnFocus = useCallback((deferEditorRoot: boolean) => {
    const returnFocus = returnFocusRef.current;
    returnFocusRef.current = null;
    const editorRoot = focusScope.rootRef.current;
    const returnToEditorRoot = Boolean(
      returnFocus
      && editorRoot?.contains(returnFocus)
      && shouldRestoreEditorRoot(focusScope.kind, {
        tagName: returnFocus.tagName,
        inputType: returnFocus instanceof HTMLInputElement ? returnFocus.type : null,
        role: returnFocus.getAttribute("role"),
      })
    );
    if (returnToEditorRoot) {
      if (deferEditorRoot && typeof queueMicrotask === "function") queueMicrotask(focusScope.focusRoot);
      else if (deferEditorRoot) Promise.resolve().then(focusScope.focusRoot);
      else focusScope.focusRoot();
      return;
    }
    focusElement(returnFocus);
  }, [focusScope]);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;

    if (open && !wasOpenRef.current) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement && !dialogRef.current?.contains(active) ? active : null;
      wasOpenRef.current = true;
      const initialFocus = initialFocusRef?.current ?? dialogRef.current;
      focusElement(initialFocus);
      return;
    }

    if (!open && wasOpenRef.current) {
      wasOpenRef.current = false;
      restoreReturnFocus(false);
    }
  }, [dialogRef, initialFocusRef, open, restoreReturnFocus]);

  useLayoutEffect(
    () => () => {
      if (!wasOpenRef.current) return;
      wasOpenRef.current = false;
      restoreReturnFocus(true);
    },
    [restoreReturnFocus]
  );
}

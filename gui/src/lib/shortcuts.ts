export type EditorShortcutAction =
  | "play-start-boundary"
  | "play-end-boundary"
  | "previous-segment"
  | "next-segment"
  | "nudge-boundary-left"
  | "nudge-boundary-right"
  | "toggle-playback"
  | "previous-boundary"
  | "next-boundary"
  | "zoom-out"
  | "reset-zoom"
  | "zoom-in";

type ShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "defaultPrevented" | "isComposing" | "keyCode" | "metaKey" | "repeat" | "shiftKey"
>;

const editorTextEntrySelector = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='combobox']",
  "[role='searchbox']",
  "[role='spinbutton']"
].join(",");

const actionInputTypes = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "reset", "submit"]);

export type EditorShortcutControlDescriptor = {
  tagName: string;
  inputType?: string | null;
  role?: string | null;
  contentEditable?: string | null;
  explicitSuppression?: boolean;
};

/**
 * Classifies controls by editing intent rather than by generic interactivity.
 * Editor action buttons intentionally do not suppress WASD/Space shortcuts.
 */
export function isEditorShortcutControlSuppressed(control: EditorShortcutControlDescriptor): boolean {
  if (control.explicitSuppression) return true;
  const tagName = control.tagName.toLowerCase();
  if (tagName === "textarea" || tagName === "select") return true;
  if (tagName === "input") return !actionInputTypes.has((control.inputType || "text").toLowerCase());
  if (control.contentEditable !== null && control.contentEditable !== undefined && control.contentEditable !== "false") return true;
  const role = control.role?.toLowerCase();
  return role === "textbox" || role === "combobox" || role === "searchbox" || role === "spinbutton";
}

export function resolveEditorShortcut(event: ShortcutEvent): EditorShortcutAction | null {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return null;

  const controlOnly = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
  if (controlOnly) {
    if (event.code === "KeyA") return "previous-boundary";
    if (event.code === "KeyD") return "next-boundary";
    return null;
  }

  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;

  switch (event.code) {
    case "KeyA":
      return "play-start-boundary";
    case "KeyD":
      return "play-end-boundary";
    case "KeyW":
      return "previous-segment";
    case "KeyS":
      return "next-segment";
    case "KeyQ":
      return "nudge-boundary-left";
    case "KeyE":
      return "nudge-boundary-right";
    case "Space":
      return "toggle-playback";
    case "KeyZ":
      return "zoom-out";
    case "KeyX":
      return "reset-zoom";
    case "KeyC":
      return "zoom-in";
    default:
      return null;
  }
}

export function isEditorShortcutSuppressed(event: KeyboardEvent): boolean {
  if (document.querySelector("[role='dialog'][aria-modal='true']")) return true;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-editor-shortcuts='suppress']")) return true;
  const control = target.closest(editorTextEntrySelector);
  if (!control) return false;
  return isEditorShortcutControlSuppressed({
    tagName: control.tagName,
    inputType: control instanceof HTMLInputElement ? control.type : null,
    role: control.getAttribute("role"),
    contentEditable: control.getAttribute("contenteditable"),
  });
}

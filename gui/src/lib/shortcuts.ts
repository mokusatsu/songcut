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

const interactiveSelector = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='button']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='slider']",
  "[role='menuitem']"
].join(",");

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
  return target instanceof Element && target.closest(interactiveSelector) !== null;
}

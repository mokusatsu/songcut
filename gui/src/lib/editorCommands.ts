import type { AppMode } from "@/lib/modes";
import type { EditorShortcutAction } from "@/lib/shortcuts";

/**
 * Commands which can be produced by either the Electron menu or the keyboard
 * shortcut resolver.  Menu-only commands are deliberately left out of this
 * normalized union and continue through the menu-specific adapter.
 */
export type NormalizedEditorCommand =
  | { type: "nudge-boundary-left" }
  | { type: "nudge-boundary-right" }
  | { type: "previous-segment" }
  | { type: "next-segment" }
  | { type: "new-segment" }
  | { type: "remove-segment" }
  | { type: "remove-unchecked-segments" }
  | { type: "sort-segments" }
  | { type: "check-all-segments" }
  | { type: "uncheck-all-segments" }
  | { type: "invert-segment-selection" }
  | { type: "zoom-in" }
  | { type: "zoom-out" }
  | { type: "reset-zoom" }
  | { type: "set-zoom"; zoomIndex: number }
  | { type: "start" }
  | { type: "previous-boundary" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "next-boundary" }
  | { type: "play-start-boundary" }
  | { type: "play-end-boundary" }
  | { type: "toggle-playback" }
  | { type: "export-movie" }
  | { type: "export-timestamp"; format: TimestampExportFormat }
  | { type: "show-boundary-refinement-details" };

export type EditorAction = NormalizedEditorCommand;

export type EditorActionAdapter = {
  execute(action: EditorAction): void;
};

const cutOnlyCommands = new Set<EditorAction["type"]>([
  "remove-unchecked-segments",
  "sort-segments",
  "check-all-segments",
  "uncheck-all-segments",
  "invert-segment-selection",
  "export-movie",
  "export-timestamp",
  "show-boundary-refinement-details",
]);

/**
 * Convert a menu or keyboard command into the common editor command shape.
 * Returning null keeps file/settings commands on their existing menu-only
 * path and makes malformed future menu additions harmless to the dispatcher.
 */
export function normalizeEditorCommand(
  command: SongcutMenuCommand | EditorShortcutAction
): NormalizedEditorCommand | null {
  if (typeof command === "string") {
    switch (command) {
      case "nudge-boundary-left":
      case "nudge-boundary-right":
      case "previous-segment":
      case "next-segment":
      case "zoom-in":
      case "zoom-out":
      case "reset-zoom":
      case "previous-boundary":
      case "next-boundary":
      case "play-start-boundary":
      case "play-end-boundary":
        return { type: command };
      case "toggle-playback":
        return { type: "toggle-playback" };
      default:
        return null;
    }
  }
  switch (command.type) {
    case "nudge-boundary-left":
    case "nudge-boundary-right":
    case "previous-segment":
    case "next-segment":
    case "new-segment":
    case "remove-segment":
    case "remove-unchecked-segments":
    case "sort-segments":
    case "check-all-segments":
    case "uncheck-all-segments":
    case "invert-segment-selection":
    case "zoom-in":
    case "zoom-out":
    case "start":
    case "previous-boundary":
    case "play":
    case "pause":
    case "next-boundary":
    case "play-start-boundary":
    case "play-end-boundary":
    case "export-movie":
    case "show-boundary-refinement-details":
      return command;
    case "set-zoom":
      return { type: "set-zoom", zoomIndex: command.zoomIndex };
    case "export-timestamp":
      return { type: "export-timestamp", format: command.format };
    default:
      return null;
  }
}

/**
 * Resolve capability before touching state.  Cut-only segment management and
 * export commands are intentionally unhandled in Sub mode.
 */
export function editorActionFromMenuCommand(
  command: SongcutMenuCommand | EditorShortcutAction,
  mode: AppMode
): EditorAction | null {
  const normalized = normalizeEditorCommand(command);
  if (!normalized) return null;
  if (mode === "sub" && cutOnlyCommands.has(normalized.type)) return null;
  return normalized;
}

/** Execute a resolved action through one adapter shared by menu and keyboard. */
export function executeEditorAction(action: EditorAction, adapter: EditorActionAdapter): void {
  adapter.execute(action);
}

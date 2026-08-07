import { describe, expect, it, vi } from "vitest";
import { editorActionFromMenuCommand, executeEditorAction, normalizeEditorCommand } from "./editorCommands";

describe("editor command dispatch", () => {
  it("normalizes menu and keyboard inputs to the same command", () => {
    expect(normalizeEditorCommand({ type: "zoom-in" })).toEqual({ type: "zoom-in" });
    expect(normalizeEditorCommand({ type: "zoom-in" })).toEqual(normalizeEditorCommand("zoom-in"));
    expect(normalizeEditorCommand("toggle-playback")).toEqual({ type: "toggle-playback" });
    expect(normalizeEditorCommand({ type: "set-zoom", zoomIndex: 3 })).toEqual({ type: "set-zoom", zoomIndex: 3 });
    expect(normalizeEditorCommand({ type: "open-settings" })).toBeNull();
  });

  it("allows cross-mode add/remove while denying Cut-only management and export in Sub", () => {
    expect(editorActionFromMenuCommand({ type: "new-segment" }, "sub")).toEqual({ type: "new-segment" });
    expect(editorActionFromMenuCommand({ type: "remove-segment" }, "sub")).toEqual({ type: "remove-segment" });

    const cutOnly = [
      { type: "remove-unchecked-segments" },
      { type: "sort-segments" },
      { type: "check-all-segments" },
      { type: "uncheck-all-segments" },
      { type: "invert-segment-selection" },
      { type: "export-movie" },
      { type: "export-timestamp", format: "csv" as const },
      { type: "show-boundary-refinement-details" },
    ] as const;
    for (const command of cutOnly) {
      expect(editorActionFromMenuCommand(command, "sub")).toBeNull();
      expect(editorActionFromMenuCommand(command, "cut")).toEqual(command);
    }
  });

  it("routes common actions through the same adapter executor", () => {
    const execute = vi.fn();
    const adapter = { execute };
    const menuAction = editorActionFromMenuCommand({ type: "next-boundary" }, "sub");
    const keyboardAction = editorActionFromMenuCommand("next-boundary", "sub");
    expect(menuAction).toEqual(keyboardAction);
    if (menuAction) executeEditorAction(menuAction, adapter);
    if (keyboardAction) executeEditorAction(keyboardAction, adapter);
    expect(execute).toHaveBeenNthCalledWith(1, { type: "next-boundary" });
    expect(execute).toHaveBeenNthCalledWith(2, { type: "next-boundary" });
  });
});

import { describe, expect, it } from "vitest";
import { isEditorShortcutControlSuppressed, resolveEditorShortcut } from "./shortcuts";

function shortcutEvent(code: string, overrides: Record<string, boolean | number> = {}) {
  return {
    altKey: false,
    code,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    keyCode: 0,
    metaKey: false,
    repeat: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("editor shortcuts", () => {
  it("keeps the shared Cut/Sub editor key map", () => {
    expect(resolveEditorShortcut(shortcutEvent("KeyW"))).toBe("previous-segment");
    expect(resolveEditorShortcut(shortcutEvent("KeyS"))).toBe("next-segment");
    expect(resolveEditorShortcut(shortcutEvent("Space"))).toBe("toggle-playback");
    expect(resolveEditorShortcut(shortcutEvent("KeyD", { ctrlKey: true }))).toBe("next-boundary");
  });

  it("ignores composition, repeat, handled, and modified key events", () => {
    expect(resolveEditorShortcut(shortcutEvent("KeyW", { isComposing: true }))).toBeNull();
    expect(resolveEditorShortcut(shortcutEvent("KeyW", { keyCode: 229 }))).toBeNull();
    expect(resolveEditorShortcut(shortcutEvent("KeyW", { repeat: true }))).toBeNull();
    expect(resolveEditorShortcut(shortcutEvent("KeyW", { defaultPrevented: true }))).toBeNull();
    expect(resolveEditorShortcut(shortcutEvent("KeyW", { altKey: true }))).toBeNull();
  });

  it("suppresses text entry controls but not editor action controls", () => {
    expect(isEditorShortcutControlSuppressed({ tagName: "textarea" })).toBe(true);
    expect(isEditorShortcutControlSuppressed({ tagName: "input", inputType: "text" })).toBe(true);
    expect(isEditorShortcutControlSuppressed({ tagName: "input", inputType: "number" })).toBe(true);
    expect(isEditorShortcutControlSuppressed({ tagName: "select" })).toBe(true);
    expect(isEditorShortcutControlSuppressed({ tagName: "div", contentEditable: "true" })).toBe(true);
    expect(isEditorShortcutControlSuppressed({ tagName: "div", role: "textbox" })).toBe(true);

    expect(isEditorShortcutControlSuppressed({ tagName: "button" })).toBe(false);
    expect(isEditorShortcutControlSuppressed({ tagName: "input", inputType: "checkbox" })).toBe(false);
    expect(isEditorShortcutControlSuppressed({ tagName: "div", role: "button" })).toBe(false);
  });

  it("supports explicit suppression for custom editing controls", () => {
    expect(isEditorShortcutControlSuppressed({ tagName: "div", role: "slider", explicitSuppression: true })).toBe(true);
  });
});

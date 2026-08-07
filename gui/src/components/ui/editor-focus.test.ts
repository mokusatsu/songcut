import type { SyntheticEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  composeEventHandlers,
  resolveActionTabIndex,
  shouldExitEditorTextEntry,
  shouldRestoreEditorRoot,
} from "./editor-focus";

function syntheticEvent(defaultPrevented = false): SyntheticEvent<HTMLElement> {
  return { defaultPrevented } as SyntheticEvent<HTMLElement>;
}

describe("editor focus policy", () => {
  it("removes action controls from the editor tab order only", () => {
    expect(resolveActionTabIndex("editor", undefined)).toBe(-1);
    expect(resolveActionTabIndex("editor", 0)).toBe(-1);
    expect(resolveActionTabIndex("normal", undefined)).toBeUndefined();
    expect(resolveActionTabIndex("normal", 0)).toBe(0);
  });

  it("composes consumer and internal handlers in order", () => {
    const calls: string[] = [];
    const handler = composeEventHandlers(
      () => calls.push("consumer"),
      () => calls.push("internal")
    );

    handler?.(syntheticEvent());
    expect(calls).toEqual(["consumer", "internal"]);
  });

  it("does not run the internal handler after a prevented consumer event", () => {
    const internal = vi.fn();
    const handler = composeEventHandlers(
      (event) => {
        Object.defineProperty(event, "defaultPrevented", { value: true });
      },
      internal
    );

    handler?.(syntheticEvent());
    expect(internal).not.toHaveBeenCalled();
  });

  it("returns dialog focus to the editor root only for editor actions", () => {
    expect(shouldRestoreEditorRoot("editor", { tagName: "button" })).toBe(true);
    expect(shouldRestoreEditorRoot("editor", { tagName: "input", inputType: "checkbox" })).toBe(true);
    expect(shouldRestoreEditorRoot("editor", { tagName: "div", role: "tab" })).toBe(true);
    expect(shouldRestoreEditorRoot("editor", { tagName: "input", inputType: "text" })).toBe(false);
    expect(shouldRestoreEditorRoot("normal", { tagName: "button" })).toBe(false);
  });

  it("exits editor text entry on Escape without interrupting IME or dialogs", () => {
    const escape = { key: "Escape", defaultPrevented: false, isComposing: false, keyCode: 27 };
    expect(shouldExitEditorTextEntry("editor", escape)).toBe(true);
    expect(shouldExitEditorTextEntry("normal", escape)).toBe(false);
    expect(shouldExitEditorTextEntry("editor", { ...escape, isComposing: true })).toBe(false);
    expect(shouldExitEditorTextEntry("editor", { ...escape, keyCode: 229 })).toBe(false);
    expect(shouldExitEditorTextEntry("editor", { ...escape, defaultPrevented: true })).toBe(false);
  });
});

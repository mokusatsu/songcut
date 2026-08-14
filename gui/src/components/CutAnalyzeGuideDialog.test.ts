import { describe, expect, it } from "vitest";

import { shouldCancelAnalyzeGuideOnEscape } from "@/components/CutAnalyzeGuideDialog";

describe("CutAnalyzeGuideDialog keyboard contract", () => {
  const escape = {
    key: "Escape",
    defaultPrevented: false,
    isComposing: false,
    keyCode: 27,
  };

  it("cancels on a normal Escape without starting analysis", () => {
    expect(shouldCancelAnalyzeGuideOnEscape(escape)).toBe(true);
  });

  it.each([
    ["IME composition", { ...escape, isComposing: true }],
    ["IME key code", { ...escape, keyCode: 229 }],
    ["a consumed event", { ...escape, defaultPrevented: true }],
    ["another key", { ...escape, key: "Enter" }],
  ])("does not treat %s as a cancel", (_label, event) => {
    expect(shouldCancelAnalyzeGuideOnEscape(event)).toBe(false);
  });
});

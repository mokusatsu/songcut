import { describe, expect, it } from "vitest";

import { applyFilenameTemplate, DEFAULT_FILENAME_TEMPLATE } from "@/lib/exportNaming";

const items = [
  { id: "export-1", segmentId: "seg-1", title: "First / Song", start: 1, end: 65 },
  { id: "export-2", segmentId: "seg-2", title: "Second Song", start: 65, end: 125 }
];

describe("export filename templates", () => {
  it("renders English placeholders and sanitizes the result", () => {
    const result = applyFilenameTemplate(items, DEFAULT_FILENAME_TEMPLATE);
    expect(result.error).toBeNull();
    expect(result.items.map((item) => item.filename_stem)).toEqual(["01_First - Song", "02_Second Song"]);
  });

  it("supports ids and filesystem-safe time placeholders", () => {
    const result = applyFilenameTemplate(items, "{id}_{start}-{end}");
    expect(result.items[0].filename_stem).toBe("seg-1_0-01-1-05");
  });

  it("reports unsupported placeholders and makes duplicate names unique", () => {
    expect(applyFilenameTemplate(items, "{number}_{title}").error).toContain("{number}");
    expect(applyFilenameTemplate(items, "clip").items.map((item) => item.filename_stem)).toEqual(["clip", "clip_2"]);
  });
});

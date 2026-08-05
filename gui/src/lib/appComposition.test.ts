import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("App composition root contract", () => {
  it("builds Cut and Sub through the symmetric mode session boundary", () => {
    expect(appSource.match(/createModeSession</g)).toHaveLength(2);
    expect(appSource).toContain("view={cutModeSession.view}");
    expect(appSource).toContain("view={subModeSession.view}");
    expect(appSource).not.toContain("operations={subModeSession.operations}");
    expect(appSource).not.toContain("createModeController");
  });

  it("keeps mode-specific API and project transformation implementations outside App", () => {
    for (const forbidden of [
      "composeProjectDocument(",
      "createProjectDocument(",
      "operationRunner.run(",
      "startAnalysis(",
      "startTranscription(",
      "startExport(",
      "startLyricsAnalysis(",
      "startSubtitleExport(",
      "startSubtitleRender(",
    ]) {
      expect(appSource).not.toContain(forbidden);
    }
  });

  it("keeps view-only dialogs and the Cut timing adapter outside App", () => {
    expect(appSource).toContain('from "@/components/AppDialogs"');
    expect(appSource).toContain("<CutSegmentTimingDialog");
    expect(appSource).not.toContain("function OutputDialog(");
    expect(appSource).not.toContain("function SegmentManagementDialog(");
    expect(appSource).not.toContain("<SegmentTimingDialog");
  });
});

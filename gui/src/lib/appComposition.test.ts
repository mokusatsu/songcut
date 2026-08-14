import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const cutModePanelSource = readFileSync(new URL("../components/CutModePanel.tsx", import.meta.url), "utf8");

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

  it("keeps view-only dialogs outside App and hosts the shared segment inspector", () => {
    expect(appSource).toContain('from "@/components/AppDialogs"');
    expect(appSource).toContain("<SegmentInspector");
    expect(appSource).toContain('className="segment-inspector-shell"');
    expect(appSource).not.toContain("<CutSegmentTimingDialog");
    expect(appSource).not.toContain("function OutputDialog(");
    expect(appSource).not.toContain("function SegmentManagementDialog(");
    expect(appSource).not.toContain("<SegmentTimingDialog");
    expect(styleSource).toMatch(
      /\.segment-inspector-toggle\s*\{[\s\S]*?width: 18px;[\s\S]*?min-width: 18px;/,
    );
    expect(styleSource).toMatch(
      /\.segment-inspector-content\s*\{[\s\S]*?width: calc\(100% - 18px\);[\s\S]*?margin-left: 18px;/,
    );
  });

  it("routes bounded playback through the generation-aware range session", () => {
    expect(appSource).toContain('from "@/lib/playbackRange"');
    expect(appSource).toContain("resolvePlaybackRangeTime(playbackRangeRef.current");
    expect(appSource).toContain("preservePlaybackRangeOnPause(playbackRangeRef.current)");
    expect(appSource).not.toContain("playbackStopAtRef");
  });

  it("keeps Cut selection's one-time initial seek", () => {
    const selectionStart = appSource.indexOf("function selectCutSegment(");
    const selectionEnd = appSource.indexOf("function selectAdjacentSegment(", selectionStart);
    const selectionBody = appSource.slice(selectionStart, selectionEnd);

    expect(selectionStart).toBeGreaterThanOrEqual(0);
    expect(selectionEnd).toBeGreaterThan(selectionStart);
    expect(selectionBody).toContain("seek(primary.start)");
  });

  it("keeps Cut range overlays transparent to waveform scrubbing", () => {
    expect(cutModePanelSource).toContain('className={`cut-waveform-segment ${props.selectedIds.has(segment.id) ? "selected" : ""}`}');
    expect(cutModePanelSource).toContain('pointerEvents="none"');
    expect(cutModePanelSource).not.toContain('onPointerDown={(event) => event.stopPropagation()}');
  });

  it("hosts display-element zoom UI while delegating range and stale rules to focused modules", () => {
    expect(appSource).toContain('from "@/components/DisplayElementZoomDialog"');
    expect(appSource).toContain("<DisplayElementZoomDialog");
    expect(appSource).toContain('from "@/lib/displayElementZoomPlayback"');
    expect(appSource).toContain('from "@/lib/displayElementZoomSession"');
    expect(appSource).toContain("lineReanalysisCoordinator.manualConstraintChanged(segmentId)");
    expect(appSource).not.toContain("displayElementZoomTimer");
  });

  it("auto-locks line boundaries only when a display-element edit is committed", () => {
    expect(appSource).toContain("display_element_boundary_locked: update.boundaryLocked");
    expect(appSource).toContain("updateDisplayElementBoundaryLockForTarget(");
    expect(appSource).toContain("onBoundaryLockChange");
  });
});

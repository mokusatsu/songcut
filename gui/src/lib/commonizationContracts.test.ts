import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";

import { sidecarPathForVideo } from "../../electron/project-schema.js";
import { startLyricsAnalysis, startTranscription } from "@/lib/api";
import {
  createOperationRunner,
  type OperationIdentity,
  type OperationRunnerCallbacks,
} from "@/lib/useOperationRunner";
import type { ProjectOperation } from "@/lib/project";
import type { JobRecord } from "@/types";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const appSource = source("../App.tsx");
const cutPanelSource = source("../components/CutModePanel.tsx");
const subPanelSource = source("../components/SubModePanel.tsx");
const subTimelineSource = source("../components/SubTimelineEditor.tsx");
const segmentInspectorSource = source("../components/SegmentInspector.tsx");
const modeOperationsSource = source("./useModeOperations.ts");
const modelPreparationSource = source("./useModelPreparation.ts");
const subOperationsSource = source("./useSubOperations.ts");

function job(kind: string, status: JobRecord["status"] = "running"): JobRecord {
  return {
    id: `${kind}-job`,
    kind,
    status,
    progress: status === "completed" ? 1 : 0,
    message: status,
    created_at: 1,
    updated_at: 1,
  };
}

describe("SCUT-024..028 commonization contracts", () => {
  it("narrows API settings to the fields each mode operation sends", () => {
    type TranscriptionInput = Parameters<typeof startTranscription>[3];
    type LyricsAnalysisInput = Parameters<typeof startLyricsAnalysis>[3];

    expectTypeOf<TranscriptionInput>().toHaveProperty("model");
    expectTypeOf<TranscriptionInput>().not.toHaveProperty("enabled");
    expectTypeOf<TranscriptionInput>().not.toHaveProperty("demucsDevice");
    expectTypeOf<LyricsAnalysisInput>().toHaveProperty("demucsDevice");
    expectTypeOf<LyricsAnalysisInput>().toHaveProperty("lyricsAlignmentAlgorithm");
    expectTypeOf<LyricsAnalysisInput>().not.toHaveProperty("enabled");
  });

  it("keeps mode operation APIs and the runner behind the composition hook", () => {
    for (const panel of [cutPanelSource, subPanelSource]) {
      expect(panel).not.toContain('from "@/lib/useOperationRunner"');
      expect(panel).not.toContain('from "@/lib/useCutOperations"');
      const apiImports = panel
        .split(/\r?\n/)
        .filter((line) => line.includes('from "@/lib/api"'));
      expect(apiImports.every((line) => line.trimStart().startsWith("import type"))).toBe(true);
      expect(panel).not.toContain("operationRunner");
      expect(panel).not.toMatch(/\boperationRunner\.run\s*\(/);
      for (const forbidden of [
        "startAnalysis(",
        "startTranscription(",
        "startExport(",
        "startLyricsAnalysis(",
        "startSubtitleExport(",
        "startSubtitleRender(",
      ]) {
        expect(panel).not.toContain(forbidden);
      }
    }

    for (const forbidden of [
      'from "@/lib/useOperationRunner"',
      'from "@/lib/useCutOperations"',
      'from "@/lib/useSubOperations"',
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

    expect(appSource).toContain('from "@/lib/useModeOperations"');
    expect(appSource).toContain("useModeOperations(");
    expect(modeOperationsSource).toContain('from "@/lib/useOperationRunner"');
    expect(modeOperationsSource).toContain('from "@/lib/useCutOperations"');
    expect(modeOperationsSource).toContain('from "@/lib/useSubOperations"');
    expect(modeOperationsSource).toMatch(/useCutOperations\(\{[\s\S]*operationRunner[\s\S]*\}\)/);
    expect(modeOperationsSource).toMatch(/useSubOperations\(\{[\s\S]*operationRunner[\s\S]*\}\)/);
  });

  it("keeps both presentation panels on the common view and intent boundary", () => {
    expect(cutPanelSource).toContain("view: ModePanelViewModel");
    expect(subPanelSource).toContain("view: ModePanelViewModel");
    for (const panel of [cutPanelSource, subPanelSource]) {
      expect(panel).not.toContain("OperationRunner");
      expect(panel).not.toContain("ModeController");
      expect(panel).not.toContain("CutOperationCoordinator");
      expect(panel).not.toContain("SubOperationCoordinator");
      expect(panel).not.toContain("window.songcut");
      expect(panel).not.toContain("window.confirm");
    }
    expect(subPanelSource).toContain("actions: SubModePanelActions");
    expect(subPanelSource).toContain("operation: SubModePanelOperationView");
  });

  it("keeps model download lifecycle out of the App composition root", () => {
    expect(appSource).toContain('from "@/lib/useModelPreparation"');
    expect(appSource).toContain("useModelPreparation({");
    for (const detail of [
      "whisperDownloadPromiseRef",
      "demucsDownloadPromiseRef",
      "mmsDownloadPromiseRef",
      "startWhisperDownload(",
      "startDemucsDownload(",
      "startMmsDownload(",
    ]) {
      expect(appSource).not.toContain(detail);
    }
    expect(modelPreparationSource).toContain("runModelDownload({");
    expect(modelPreparationSource).toContain("runExclusive(");
  });

  it("shares toolbar and timeline media contracts while keeping boundary policy outside panels", () => {
    expect(cutPanelSource).toContain("<ModeToolbar");
    expect(subPanelSource).toContain("<ModeToolbar");
    expect(subTimelineSource).toContain("export type SubTimelineEditorProps = ModeMediaViewModel &");
    expect(cutPanelSource).not.toContain("CUT_BOUNDARY_POLICY");
    expect(cutPanelSource).not.toContain("resolveBoundaryTime");
  });

  it("shares one persistent segment inspector without mode-specific timing dialogs", () => {
    expect(appSource).toContain("<SegmentInspector");
    expect(segmentInspectorSource).toContain('mode: SegmentInspectorMode');
    expect(segmentInspectorSource).toContain('data-section="timing"');
    expect(segmentInspectorSource).toContain('data-section="style"');
    expect(segmentInspectorSource).not.toContain("<Tabs");
    expect(cutPanelSource).not.toContain("onEditTiming");
    expect(subPanelSource).not.toContain("SegmentTimingDialog");
    expect(subTimelineSource).not.toContain("onEditTiming");
  });

  it("separates Sub timeline editing and keeps panel intent wiring in the composition root", () => {
    expect(subPanelSource).toContain('from "@/components/SubTimelineEditor"');
    expect(subPanelSource).toContain("<SubTimelineEditor");
    expect(subPanelSource).not.toContain("function LyricsSegmentView");
    expect(subPanelSource).not.toContain("useBoundaryDrag");
    expect(subTimelineSource).toContain("export function SubTimelineEditor");
    expect(subTimelineSource).toContain("useBoundaryDrag");

    expect(appSource).not.toContain('from "@/lib/subModePanelAdapter"');
    expect(appSource).not.toContain("createSubModePanelAdapter(");
    expect(appSource).toContain("analyzeLyrics: subModeSession.operations.analyzeLyrics");
    expect(appSource).toContain("selectSegment: selectSubtitleSegmentWithModifiers");
    expect(subPanelSource).not.toContain('from "@/lib/api"');
  });

  it("keeps Cut and Sub project sidecars independent", () => {
    const video = "C:\\media\\song.mp4";
    expect(sidecarPathForVideo(video, "cut")).toBe(`${video}.songcut`);
    expect(sidecarPathForVideo(video, "sub")).toBe(`${video}.sub.songcut`);
    expect(sidecarPathForVideo(video)).toBe(`${video}.songcut`);
  });

  it("keeps subtitle render as a non-persistent, invalidatable task lifecycle", () => {
    expect(subOperationsSource).toContain('updateTask("subtitle-render"');
    expect(subOperationsSource).toContain("invalidateSubtitleRender");
    expect(subOperationsSource).not.toContain('operation: { kind: "subtitle-render"');
  });

  it.each([
    "analysis",
    "transcription",
    "export",
    "lyrics-analysis",
    "subtitle-export",
  ] as const)("runs the shared lifecycle for %s", async (kind) => {
    const tasks: Record<string, JobRecord | null> = {};
    let operation: ProjectOperation = null;
    const callbacks: OperationRunnerCallbacks = {
      updateTask: (slot, next) => { tasks[slot] = next; },
      setProjectOperation: (next) => {
        operation = typeof next === "function" ? next(operation) : next;
      },
      markProjectChanged: () => undefined,
    };
    const runner = createOperationRunner(callbacks);

    const identity = { slot: kind, operation: { kind } } as OperationIdentity;
    await runner.run({
      ...identity,
      pendingMessage: "Preparing",
      failureMessage: "Failed",
      start: async () => job(kind),
      poll: async (_jobId, onProgress) => {
        onProgress(job(kind, "completed"));
        return { kind };
      },
    });

    expect(tasks[kind]?.status).toBe("completed");
    expect(operation).toBeNull();
  });
});

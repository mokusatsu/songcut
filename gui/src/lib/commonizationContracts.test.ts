import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sidecarPathForVideo } from "../../electron/project-schema.js";
import {
  createOperationRunner,
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
const modeOperationsSource = source("./useModeOperations.ts");
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

describe("SCUT-024 commonization contracts", () => {
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

  it("keeps both presentation panels on the common view boundary", () => {
    expect(cutPanelSource).toContain("view: ModePanelViewModel");
    expect(subPanelSource).toContain("view: ModePanelViewModel");
    expect(subPanelSource).toContain("operations: SubOperationCoordinator");
    expect(cutPanelSource).not.toContain("OperationRunner");
    expect(subPanelSource).not.toContain("OperationRunner");
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

    await runner.run({
      slot: kind,
      operation: { kind },
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

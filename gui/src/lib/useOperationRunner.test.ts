import { describe, expect, it, vi } from "vitest";

import {
  createOperationRunner,
  type OperationIdentity,
  type OperationRunnerCallbacks,
} from "@/lib/useOperationRunner";
import type { ProjectOperation } from "@/lib/project";
import type { JobRecord } from "@/types";

function job(status: JobRecord["status"], overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    kind: "analysis",
    status,
    progress: status === "completed" ? 1 : 0,
    message: status,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

function harness() {
  const tasks: Record<string, JobRecord | null> = {};
  const operationHistory: ProjectOperation[] = [];
  let operation: ProjectOperation = null;
  let revisionChanges = 0;
  const callbacks: OperationRunnerCallbacks = {
    updateTask: (slot, next) => {
      tasks[slot] = next;
    },
    setProjectOperation: (next) => {
      operation = typeof next === "function" ? next(operation) : next;
      operationHistory.push(operation);
    },
    markProjectChanged: () => {
      revisionChanges += 1;
    },
  };
  return {
    tasks,
    operationHistory,
    get operation() { return operation; },
    get revisionChanges() { return revisionChanges; },
    callbacks,
  };
}

describe("operation runner", () => {
  it("requires the persistent operation kind to match its task slot", () => {
    const valid: OperationIdentity = {
      slot: "transcription",
      operation: { kind: "transcription", pending_segment_ids: ["segment-1"] },
    };
    // @ts-expect-error An export operation cannot be registered in the analysis slot.
    const invalid: OperationIdentity = {
      slot: "analysis",
      operation: { kind: "export" },
    };
    const lyricsIdentity: OperationIdentity = {
      slot: "lyrics-analysis",
      // @ts-expect-error Only transcription persists resume settings.
      operation: { kind: "lyrics-analysis", settings: {} },
    };
    expect(valid.operation.kind).toBe("transcription");
    expect(invalid).toBeDefined();
    expect(lyricsIdentity).toBeDefined();
  });

  it("registers pending/start/progress and clears the operation on success", async () => {
    const state = harness();
    const runner = createOperationRunner(state.callbacks);
    const progress: number[] = [];
    const result = await runner.run({
      slot: "analysis",
      operation: { kind: "analysis" },
      pendingMessage: "Preparing",
      failureMessage: "Failed",
      start: async () => job("running", { progress: 0.1 }),
      poll: async (_id, onProgress) => {
        onProgress(job("running", { progress: 0.5 }));
        progress.push(0.5);
        onProgress(job("completed", { progress: 1, result: { value: 42 } }));
        return { value: 42 };
      },
    });

    expect(result).toEqual({ value: 42 });
    expect(progress).toEqual([0.5]);
    expect(state.tasks.analysis?.status).toBe("completed");
    expect(state.operationHistory[0]).toMatchObject({ kind: "analysis", status: "running" });
    expect(state.operationHistory.at(-1)).toBeNull();
    expect(state.operation).toBeNull();
    expect(state.revisionChanges).toBe(2);
  });

  it("retains the failed task and records an interrupted operation", async () => {
    const state = harness();
    const runner = createOperationRunner(state.callbacks);
    const error = new Error("network down");

    await expect(
      runner.run({
        slot: "lyrics-analysis",
        operation: { kind: "lyrics-analysis" },
        pendingMessage: "Preparing",
        failureMessage: "Lyrics failed",
        start: async () => job("running", { kind: "lyrics-analysis" }),
        poll: async (_id, onProgress) => {
          onProgress(job("running", { kind: "lyrics-analysis", progress: 0.25 }));
          throw error;
        },
      }),
    ).rejects.toBe(error);

    expect(state.tasks["lyrics-analysis"]?.status).toBe("failed");
    expect(state.tasks["lyrics-analysis"]?.message).toBe("Lyrics failed");
    expect(state.operation).toMatchObject({ kind: "lyrics-analysis", status: "interrupted" });
    expect(state.revisionChanges).toBe(2);
  });

  it("does not start a second job for the same slot", async () => {
    const state = harness();
    const runner = createOperationRunner(state.callbacks);
    let release: (() => void) | undefined;
    const start = vi.fn(async () => job("running"));
    const first = runner.run({
      slot: "export",
      operation: { kind: "export" },
      pendingMessage: "Preparing",
      failureMessage: "Failed",
      start,
      poll: async () => new Promise<void>((resolve) => { release = resolve; }),
    });
    const second = await runner.run({
      slot: "export",
      operation: { kind: "export" },
      pendingMessage: "Preparing",
      failureMessage: "Failed",
      start,
      poll: async () => undefined,
    });
    expect(second).toBeUndefined();
    expect(start).toHaveBeenCalledTimes(1);
    release?.();
    await first;
  });

  it("does not overlap different foreground slots", async () => {
    const state = harness();
    const runner = createOperationRunner(state.callbacks);
    let release: (() => void) | undefined;
    const first = runner.run({
      slot: "analysis",
      operation: { kind: "analysis" },
      pendingMessage: "Preparing",
      failureMessage: "Failed",
      start: async () => job("running"),
      poll: async () => new Promise<void>((resolve) => { release = resolve; }),
    });
    const secondStart = vi.fn(async () => job("running", { kind: "export" }));
    const second = await runner.run({
      slot: "export",
      operation: { kind: "export" },
      pendingMessage: "Preparing",
      failureMessage: "Failed",
      start: secondStart,
      poll: async () => undefined,
    });
    expect(second).toBeUndefined();
    expect(secondStart).not.toHaveBeenCalled();
    release?.();
    await first;
  });

  it("allows a successful operation to leave an interrupted result", async () => {
    const state = harness();
    const runner = createOperationRunner(state.callbacks);
    const operation: Exclude<ProjectOperation, null> = {
      kind: "transcription",
      status: "interrupted",
      pending_segment_ids: ["segment-2"],
    };
    await runner.run({
      slot: "transcription",
      operation: { kind: "transcription", pending_segment_ids: ["segment-1", "segment-2"] },
      pendingMessage: "Preparing",
      failureMessage: "Failed",
      clearOperationOnSuccess: false,
      start: async () => job("running", { kind: "transcription" }),
      poll: async () => ["segment-1"],
      onSuccess: () => operation,
    });
    expect(state.operation).toEqual(operation);
  });
});

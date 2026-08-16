import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LINE_REANALYSIS_DELAY_MILLISECONDS,
  LineReanalysisCoordinator,
  type LineReanalysisResult,
  type LineReanalysisState,
  type ScheduledLineReanalysis,
} from "@/lib/lineReanalysisCoordinator";

type Payload = { text: string };
type Result = { text: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function state(rowId: string, revision = 1, needsReanalysis = true): LineReanalysisState<Payload> {
  return {
    projectEpoch: 2,
    rowId,
    lineRevision: revision,
    displayElementRevision: revision,
    needsReanalysis,
    payload: { text: `${rowId}-${revision}` },
  };
}

function guarded(
  snapshot: ScheduledLineReanalysis<Payload>,
  value: Result,
): LineReanalysisResult<Result> {
  return {
    projectEpoch: snapshot.projectEpoch,
    rowId: snapshot.rowId,
    lineRevision: snapshot.lineRevision,
    displayElementRevision: snapshot.displayElementRevision,
    reanalysisEpoch: snapshot.reanalysisEpoch,
    value,
  };
}

describe("LineReanalysisCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports waiting immediately and fires once at exactly 3,000ms, never at 2,999ms", async () => {
    const states = new Map([["line", state("line")]]);
    const statuses: string[] = [];
    const start = vi.fn(async (snapshot: ScheduledLineReanalysis<Payload>) => (
      guarded(snapshot, { text: "done" })
    ));
    const apply = vi.fn(() => "idle" as const);
    const coordinator = new LineReanalysisCoordinator({
      capture: (rowId) => states.get(rowId) ?? null,
      start,
      cancelJob: vi.fn(async () => undefined),
      apply,
      onStatus: (_rowId, status) => statuses.push(status),
    });
    coordinator.commit("line");
    expect(LINE_REANALYSIS_DELAY_MILLISECONDS).toBe(3_000);
    expect(statuses.at(-1)).toBe("waiting");
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS - 1);
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does not fire while text or a boundary is being edited and reschedules dirty unchanged exit", async () => {
    const states = new Map([["line", state("line")]]);
    const start = vi.fn(async (snapshot: ScheduledLineReanalysis<Payload>) => (
      guarded(snapshot, { text: "done" })
    ));
    const coordinator = new LineReanalysisCoordinator({
      capture: (rowId) => states.get(rowId) ?? null,
      start,
      cancelJob: vi.fn(async () => undefined),
      apply: () => "idle",
    });
    coordinator.commit("line");
    coordinator.enter("line");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(start).not.toHaveBeenCalled();
    expect(coordinator.getStatus("line")).toBe("idle");
    coordinator.exitWithoutChange("line");
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS - 1);
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("same-line reentry aborts polling and cancels the old job before latest-only apply", async () => {
    const states = new Map([["line", state("line")]]);
    const runs = [deferred<LineReanalysisResult<Result>>(), deferred<LineReanalysisResult<Result>>()];
    const signals: AbortSignal[] = [];
    const snapshots: ScheduledLineReanalysis<Payload>[] = [];
    const cancelJob = vi.fn(async () => undefined);
    const apply = vi.fn(() => "idle" as const);
    const start = vi.fn((snapshot: ScheduledLineReanalysis<Payload>, context) => {
      const index = snapshots.length;
      snapshots.push(snapshot);
      signals.push(context.signal);
      context.registerJobId(`job-${index}`);
      return runs[index]!.promise;
    });
    const coordinator = new LineReanalysisCoordinator({
      capture: (rowId) => states.get(rowId) ?? null,
      start,
      cancelJob,
      apply,
    });
    coordinator.commit("line");
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS);
    expect(start).toHaveBeenCalledTimes(1);
    coordinator.enter("line");
    expect(signals[0]?.aborted).toBe(true);
    expect(cancelJob).toHaveBeenCalledWith("job-0");
    states.set("line", state("line", 2));
    coordinator.commit("line");
    runs[0]!.resolve(guarded(snapshots[0]!, { text: "stale" }));
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS);
    expect(start).toHaveBeenCalledTimes(2);
    runs[1]!.resolve(guarded(snapshots[1]!, { text: "latest" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(snapshots[1], { text: "latest" });
  });

  it("keeps another row's timer when the edited row reenters", async () => {
    const states = new Map([
      ["a", state("a")],
      ["b", state("b")],
    ]);
    const start = vi.fn(async (snapshot: ScheduledLineReanalysis<Payload>) => (
      guarded(snapshot, { text: snapshot.rowId })
    ));
    const coordinator = new LineReanalysisCoordinator({
      capture: (rowId) => states.get(rowId) ?? null,
      start,
      cancelJob: vi.fn(async () => undefined),
      apply: () => "idle",
    });
    coordinator.commit("a");
    coordinator.commit("b");
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS / 2);
    coordinator.enter("a");
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS / 2);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0].rowId).toBe("b");
  });

  it("reschedules a dirty row after a manual display constraint but leaves a clean row idle", async () => {
    const states = new Map([
      ["dirty", state("dirty")],
      ["clean", state("clean", 1, false)],
    ]);
    const start = vi.fn(async (snapshot: ScheduledLineReanalysis<Payload>) => (
      guarded(snapshot, { text: snapshot.rowId })
    ));
    const coordinator = new LineReanalysisCoordinator({
      capture: (rowId) => states.get(rowId) ?? null,
      start,
      cancelJob: vi.fn(async () => undefined),
      apply: () => "idle",
    });
    coordinator.commit("dirty");
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS / 2);
    coordinator.enter("dirty");
    coordinator.manualConstraintChanged("dirty");
    coordinator.enter("clean");
    coordinator.manualConstraintChanged("clean");
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS - 1);
    expect(start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]?.[0].rowId).toBe("dirty");
    expect(coordinator.getStatus("clean")).toBe("idle");
  });

  it("cancels only a removed row while retaining another running row", async () => {
    const states = new Map([
      ["removed", state("removed")],
      ["kept", state("kept")],
    ]);
    const cancelJob = vi.fn(async () => undefined);
    const coordinator = new LineReanalysisCoordinator<Payload, Result>({
      capture: (rowId) => states.get(rowId) ?? null,
      start: (snapshot, context) => {
        context.registerJobId(`job-${snapshot.rowId}`);
        return new Promise<LineReanalysisResult<Result>>(() => undefined);
      },
      cancelJob,
      apply: () => "idle",
    });
    coordinator.commit("removed");
    coordinator.commit("kept");
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS);
    coordinator.retainRows(new Set(["kept"]));
    expect(cancelJob).toHaveBeenCalledWith("job-removed");
    expect(cancelJob).not.toHaveBeenCalledWith("job-kept");
  });

  it("does nothing after an unchanged clean edit", async () => {
    const states = new Map([["line", state("line", 1, false)]]);
    const start = vi.fn();
    const coordinator = new LineReanalysisCoordinator<Payload, Result>({
      capture: (rowId) => states.get(rowId) ?? null,
      start,
      cancelJob: vi.fn(async () => undefined),
      apply: () => "idle",
    });
    coordinator.enter("line");
    coordinator.exitWithoutChange("line");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(start).not.toHaveBeenCalled();
  });

  it("marks a timer stale when the reserved revisions no longer match", async () => {
    const states = new Map([["line", state("line")]]);
    const statuses: string[] = [];
    const start = vi.fn();
    const coordinator = new LineReanalysisCoordinator<Payload, Result>({
      capture: (rowId) => states.get(rowId) ?? null,
      start,
      cancelJob: vi.fn(async () => undefined),
      apply: () => "idle",
      onStatus: (_rowId, status) => statuses.push(status),
    });
    coordinator.commit("line");
    states.set("line", state("line", 2));
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS);
    expect(start).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("stale");
  });

  it("marks a completed response stale when any result guard differs", async () => {
    const states = new Map([["line", state("line")]]);
    const statuses: string[] = [];
    const apply = vi.fn(() => "idle" as const);
    const coordinator = new LineReanalysisCoordinator<Payload, Result>({
      capture: (rowId) => states.get(rowId) ?? null,
      start: async (snapshot) => ({
        ...guarded(snapshot, { text: "wrong project" }),
        projectEpoch: snapshot.projectEpoch + 1,
      }),
      cancelJob: vi.fn(async () => undefined),
      apply,
      onStatus: (_rowId, status) => statuses.push(status),
    });
    coordinator.commit("line");
    await vi.advanceTimersByTimeAsync(LINE_REANALYSIS_DELAY_MILLISECONDS);
    expect(apply).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("stale");
  });
});

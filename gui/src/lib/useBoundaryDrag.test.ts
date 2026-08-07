import { describe, expect, it } from "vitest";
import {
  createBoundaryDragLifecycle,
  type BoundaryDragEventTarget,
  type BoundaryDragListener,
} from "./useBoundaryDrag";
import {
  createLyricsLane,
  updateSegmentBoundary,
  type RhythmGridPoint,
} from "./subtitles";

class FakeEventTarget implements BoundaryDragEventTarget {
  private readonly listeners = new Map<string, Set<BoundaryDragListener>>();

  addEventListener(type: string, listener: BoundaryDragListener) {
    const bucket = this.listeners.get(type) ?? new Set<BoundaryDragListener>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: BoundaryDragListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: { clientX: number; pointerId?: number }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  count(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe("boundary drag lifecycle", () => {
  it("previews pointer moves and commits exactly once on release", () => {
    const target = new FakeEventTarget();
    const previews: number[] = [];
    let commits = 0;
    const lifecycle = createBoundaryDragLifecycle(
      {
        onPreview: (clientX) => previews.push(clientX),
        onCommit: () => {
          commits += 1;
        },
      },
      target,
    );

    expect(lifecycle.startPointer({ clientX: 10, pointerId: 7 })).toBe(true);
    target.emit("pointermove", { clientX: 20, pointerId: 7 });
    target.emit("pointermove", { clientX: 30, pointerId: 99 });
    target.emit("pointerup", { clientX: 40, pointerId: 7 });
    target.emit("pointerup", { clientX: 50, pointerId: 7 });

    expect(previews).toEqual([10, 20]);
    expect(commits).toBe(1);
    expect(lifecycle.isActive()).toBe(false);
    expect(target.count("pointermove")).toBe(0);
    expect(target.count("pointerup")).toBe(0);
    expect(target.count("pointercancel")).toBe(0);
  });

  it("uses global mouse listeners and cleans them on release", () => {
    const target = new FakeEventTarget();
    const previews: number[] = [];
    let commits = 0;
    const lifecycle = createBoundaryDragLifecycle(
      {
        onPreview: (clientX) => previews.push(clientX),
        onCommit: () => {
          commits += 1;
        },
      },
      target,
    );

    lifecycle.startMouse({ clientX: 1 });
    expect(target.count("mousemove")).toBe(1);
    expect(target.count("mouseup")).toBe(1);
    target.emit("mousemove", { clientX: 4 });
    target.emit("mouseup", { clientX: 9 });

    expect(previews).toEqual([1, 4]);
    expect(commits).toBe(1);
    expect(target.count("mousemove")).toBe(0);
    expect(target.count("mouseup")).toBe(0);
  });

  it("restores a Sub draft through cancel without committing", () => {
    const target = new FakeEventTarget();
    let value = 2;
    let commits = 0;
    const startValue = value;
    const lifecycle = createBoundaryDragLifecycle(
      {
        onPreview: (clientX) => {
          value = clientX;
        },
        onCancel: () => {
          value = startValue;
        },
        onCommit: () => {
          commits += 1;
        },
      },
      target,
    );

    lifecycle.startPointer({ clientX: 2, pointerId: 1 });
    target.emit("pointermove", { clientX: 8, pointerId: 1 });
    target.emit("pointercancel", { clientX: 8, pointerId: 1 });

    expect(value).toBe(2);
    expect(commits).toBe(0);
    expect(lifecycle.isActive()).toBe(false);
    expect(target.count("pointermove")).toBe(0);
    expect(target.count("pointercancel")).toBe(0);
  });

  it("can preserve Cut's historical commit-on-cancel behavior", () => {
    const target = new FakeEventTarget();
    let commits = 0;
    const lifecycle = createBoundaryDragLifecycle(
      {
        onPreview: () => undefined,
        onCommit: () => {
          commits += 1;
        },
        commitOnCancel: true,
      },
      target,
    );

    lifecycle.startPointer({ clientX: 1, pointerId: 3 });
    target.emit("pointercancel", { clientX: 2, pointerId: 3 });

    expect(commits).toBe(1);
    expect(target.count("pointermove")).toBe(0);
  });

  it("rolls back an active draft when disposed", () => {
    const target = new FakeEventTarget();
    let value = 0;
    let commits = 0;
    const lifecycle = createBoundaryDragLifecycle(
      {
        onPreview: (clientX) => {
          value = clientX;
        },
        onCancel: () => {
          value = 0;
        },
        onCommit: () => {
          commits += 1;
        },
      },
      target,
    );

    lifecycle.startPointer({ clientX: 1, pointerId: 5 });
    target.emit("pointermove", { clientX: 9, pointerId: 5 });
    lifecycle.dispose();

    expect(value).toBe(0);
    expect(commits).toBe(0);
    expect(target.count("pointermove")).toBe(0);
    expect(target.count("pointerup")).toBe(0);
    expect(target.count("pointercancel")).toBe(0);
  });

  it("leaves boundary policy resolution to the mode preview callback", () => {
    const target = new FakeEventTarget();
    const resolved: number[] = [];
    const lifecycle = createBoundaryDragLifecycle(
      {
        onPreview: (clientX) => resolved.push(Math.round(clientX / 10) * 10),
        onCommit: () => undefined,
      },
      target,
    );

    lifecycle.startPointer({ clientX: 13, pointerId: 4 });
    target.emit("pointermove", { clientX: 26, pointerId: 4 });
    target.emit("pointerup", { clientX: 26, pointerId: 4 });

    expect(resolved).toEqual([10, 30]);
  });

  it("delegates Sub rhythm/non-overlap policy while delaying the commit", () => {
    const target = new FakeEventTarget();
    const grid: RhythmGridPoint[] = [0, 1, 1.25, 1.5, 1.75, 2, 2.25, 3, 4, 5].map((time) => ({
      time,
      grid: "quarter-beat",
      attraction_radius: 0,
      grid_penalty: 0,
    }));
    const lane = createLyricsLane();
    lane.segments = [
      { id: "previous", text: "previous", start: 0, end: 1, confidence: 1, source: "lyrics", low_confidence_outlier: false, user_edited: false },
      { id: "target", text: "target", start: 2, end: 4, confidence: 1, source: "lyrics", low_confidence_outlier: false, user_edited: false },
    ];
    let draft = lane;
    let commits = 0;
    const lifecycle = createBoundaryDragLifecycle(
      {
        onPreview: (clientX) => {
          draft = updateSegmentBoundary(draft, "target", "start", clientX, grid);
        },
        onCommit: () => {
          commits += 1;
        },
      },
      target,
    );

    lifecycle.startPointer({ clientX: 1.64, pointerId: 6 });
    expect(draft.segments.find((segment) => segment.id === "target")?.start).toBe(1.75);
    target.emit("pointermove", { clientX: 1.51, pointerId: 6 });
    expect(draft.segments.find((segment) => segment.id === "target")?.start).toBe(1.5);
    expect(commits).toBe(0);
    target.emit("pointerup", { clientX: 1.51, pointerId: 6 });
    expect(commits).toBe(1);
  });
});

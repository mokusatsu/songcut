import { describe, expect, it } from "vitest";

import {
  beginPlaybackRange,
  cancelPlaybackRange,
  createPlaybackRangeState,
  preservePlaybackRangeOnPause,
  resolvePlaybackRangeTime,
  setPlaybackRangeLoop,
} from "@/lib/playbackRange";

describe("playback range session", () => {
  it("preserves the newest stop boundary when an older pause event arrives late", () => {
    let state = beginPlaybackRange(createPlaybackRangeState(), 0, 2);
    const oldGeneration = state.session?.generation;
    state = beginPlaybackRange(state, 0, 1);
    const newGeneration = state.session?.generation;

    state = preservePlaybackRangeOnPause(state);

    expect(newGeneration).toBeGreaterThan(oldGeneration ?? -1);
    expect(state.session?.stopAt).toBe(1);
    expect(resolvePlaybackRangeTime(state, 0.97).kind).toBe("continue");
    const decision = resolvePlaybackRangeTime(state, 0.99);
    expect(decision).toMatchObject({ kind: "stop", time: 1, generation: newGeneration });
    expect(decision.state.session).toBeNull();
  });

  it("keeps a paused range available for resume until explicitly cancelled", () => {
    const active = beginPlaybackRange(createPlaybackRangeState(), 3, 4);
    expect(preservePlaybackRangeOnPause(active)).toBe(active);
    const cancelled = cancelPlaybackRange(active);
    expect(cancelled.session).toBeNull();
    expect(cancelled.generation).toBeGreaterThan(active.generation);
  });

  it("returns the range start at the end when loop playback is enabled", () => {
    const active = setPlaybackRangeLoop(
      beginPlaybackRange(createPlaybackRangeState(), 5, 6),
      true,
    );
    const decision = resolvePlaybackRangeTime(active, 6);
    expect(decision).toMatchObject({ kind: "loop", time: 5 });
    expect(decision.state.session).toEqual(active.session);
  });

  it("rejects invalid or zero-length ranges", () => {
    expect(beginPlaybackRange(createPlaybackRangeState(), 1, 1).session).toBeNull();
    expect(beginPlaybackRange(createPlaybackRangeState(), Number.NaN, 2).session).toBeNull();
    expect(beginPlaybackRange(createPlaybackRangeState(), 1, null).session).toBeNull();
  });
});

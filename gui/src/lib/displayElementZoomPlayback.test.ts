import { describe, expect, it } from "vitest";

import {
  closeDisplayElementZoomPlayback,
  openDisplayElementZoomPlayback,
  seekDisplayElementZoomPlayback,
  toggleDisplayElementZoomPlayback,
  type DisplayElementZoomMedia,
} from "@/lib/displayElementZoomPlayback";
import { createPlaybackRangeState } from "@/lib/playbackRange";

function fakeMedia(time: number, paused = true) {
  let pauseCount = 0;
  let playCount = 0;
  const media: DisplayElementZoomMedia = {
    currentTime: time,
    paused,
    pause() {
      pauseCount += 1;
      Object.defineProperty(media, "paused", { configurable: true, value: true, writable: true });
    },
    play() {
      playCount += 1;
      Object.defineProperty(media, "paused", { configurable: true, value: false, writable: true });
      return Promise.resolve();
    },
  };
  return { media, pauseCount: () => pauseCount, playCount: () => playCount };
}

describe("display element zoom playback", () => {
  it("stops on open and resets outside or end positions to the range start", () => {
    const fake = fakeMedia(12);
    const result = openDisplayElementZoomPlayback(fake.media, createPlaybackRangeState(), 10, 12, 0);

    expect(fake.pauseCount()).toBe(1);
    expect(fake.media.currentTime).toBe(10);
    expect(result.time).toBe(10);
    expect(result.state.session).toBeNull();
  });

  it("starts a bounded loop session and pauses without losing its stop boundary", () => {
    const fake = fakeMedia(11);
    const started = toggleDisplayElementZoomPlayback(fake.media, createPlaybackRangeState(), 10, 12, true);
    expect(fake.playCount()).toBe(1);
    expect(started.state.session).toMatchObject({ start: 10, stopAt: 12, loop: true });

    const paused = toggleDisplayElementZoomPlayback(fake.media, started.state, 10, 12, true);
    expect(fake.pauseCount()).toBe(1);
    expect(paused.state).toBe(started.state);
  });

  it("clamps pointer seeks and invalidates the old generation on close", () => {
    const fake = fakeMedia(10.5);
    const seeked = seekDisplayElementZoomPlayback(fake.media, createPlaybackRangeState(), 10, 12, 50, false);
    expect(seeked.time).toBe(12);
    expect(fake.media.currentTime).toBe(12);

    const closed = closeDisplayElementZoomPlayback(fake.media, seeked.state);
    expect(fake.media.currentTime).toBe(12);
    expect(closed.session).toBeNull();
    expect(closed.generation).toBeGreaterThan(seeked.state.generation);
  });

  it("can open an edit-only session without media", () => {
    const result = openDisplayElementZoomPlayback(null, createPlaybackRangeState(), 10, 12, 11);
    expect(result.time).toBe(11);
    expect(result.state.session).toBeNull();
  });
});

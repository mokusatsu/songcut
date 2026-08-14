import { afterEach, describe, expect, it, vi } from "vitest";

import { logMediaDiagnostic, mediaDiagnosticSnapshot } from "@/lib/mediaDiagnostics";

function mediaFixture() {
  return {
    currentTime: 42.12349,
    duration: Number.NaN,
    paused: false,
    ended: false,
    seeking: true,
    readyState: 3,
    networkState: 2,
    error: { code: 3, message: "decoder stalled" }
  } as unknown as HTMLMediaElement;
}

afterEach(() => vi.restoreAllMocks());

describe("media diagnostics", () => {
  it("records the bounded media state without a source path", () => {
    expect(mediaDiagnosticSnapshot("video", "waiting", mediaFixture(), { result: "started" })).toEqual({
      target: "video",
      event: "waiting",
      currentTime: 42.123,
      duration: null,
      paused: false,
      ended: false,
      seeking: true,
      readyState: 3,
      networkState: 2,
      error: { code: 3, message: "decoder stalled" },
      details: { result: "started" }
    });
  });

  it("uses the renderer marker consumed by the Electron main process", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logMediaDiagnostic("scratch-proxy-audio", "play-result", mediaFixture(), { result: "cancelled" });

    expect(info).toHaveBeenCalledWith(
      "[songcut-media]",
      JSON.stringify(mediaDiagnosticSnapshot("scratch-proxy-audio", "play-result", mediaFixture(), { result: "cancelled" }))
    );
  });
});

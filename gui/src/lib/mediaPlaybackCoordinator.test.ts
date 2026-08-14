import { describe, expect, it, vi } from "vitest";

import { MediaPlaybackCoordinator } from "@/lib/mediaPlaybackCoordinator";

type TestMedia = {
  paused: boolean;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
};

function immediatelyPlayableMedia(): TestMedia {
  const media = {} as TestMedia;
  media.paused = true;
  media.play = vi.fn(async () => {
    media.paused = false;
  });
  media.pause = vi.fn(() => {
    media.paused = true;
  });
  return media;
}

describe("MediaPlaybackCoordinator", () => {
  it("waits for an interrupted scratch request before starting normal playback", async () => {
    let rejectScratch: ((error: unknown) => void) | null = null;
    const scratch = {} as TestMedia;
    scratch.paused = true;
    scratch.play = vi.fn(
      () => new Promise<void>((_resolve, reject) => {
        rejectScratch = reject;
      }),
    );
    scratch.pause = vi.fn(() => {
      scratch.paused = true;
      rejectScratch?.(new Error("scratch request interrupted"));
    });
    const normal = immediatelyPlayableMedia();
    const coordinator = new MediaPlaybackCoordinator();

    const scratchRequest = coordinator.request(scratch);
    await Promise.resolve();
    expect(scratch.play).toHaveBeenCalledTimes(1);

    coordinator.pause(scratch);
    const normalRequest = coordinator.request(normal);
    expect(normal.play).not.toHaveBeenCalled();

    await expect(scratchRequest).resolves.toEqual({ status: "cancelled" });
    await expect(normalRequest).resolves.toEqual({ status: "started" });
    expect(normal.play).toHaveBeenCalledTimes(1);
  });

  it("does not report an interrupted old request as a failure", async () => {
    let rejectPlay: ((error: unknown) => void) | null = null;
    const media = {} as TestMedia;
    media.paused = true;
    media.play = vi.fn(
      () => new Promise<void>((_resolve, reject) => {
        rejectPlay = reject;
      }),
    );
    media.pause = vi.fn(() => {
      media.paused = true;
      rejectPlay?.(new Error("interrupted"));
    });
    const coordinator = new MediaPlaybackCoordinator();

    const request = coordinator.request(media);
    await Promise.resolve();
    coordinator.pause(media);

    await expect(request).resolves.toEqual({ status: "cancelled" });
  });

  it("returns the current normal-playback failure for the caller to display", async () => {
    const error = new Error("decoder unavailable");
    const media = {} as TestMedia;
    media.paused = true;
    media.play = vi.fn(async () => {
      throw error;
    });
    media.pause = vi.fn(() => {
      media.paused = true;
    });
    const coordinator = new MediaPlaybackCoordinator();

    await expect(coordinator.request(media)).resolves.toEqual({ status: "failed", error });
  });
});

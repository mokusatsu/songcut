import { describe, expect, it } from "vitest";

import { MEDIA_ERR_DECODE, planVideoDecodeRecovery } from "@/lib/mediaDecodeRecovery";

describe("planVideoDecodeRecovery", () => {
  it("rebuilds a decoded video only once for each source load", () => {
    expect(planVideoDecodeRecovery({
      errorCode: MEDIA_ERR_DECODE,
      hasSource: true,
      sourceLoadGeneration: 4,
      attemptedSourceLoadGeneration: null,
      currentTime: 148.412,
      resumePlayback: true,
    })).toEqual({
      kind: "recover",
      recovery: {
        sourceLoadGeneration: 4,
        restoreTime: 148.412,
        resumePlayback: true,
      },
    });

    expect(planVideoDecodeRecovery({
      errorCode: MEDIA_ERR_DECODE,
      hasSource: true,
      sourceLoadGeneration: 4,
      attemptedSourceLoadGeneration: 4,
      currentTime: 148.412,
      resumePlayback: true,
    })).toEqual({ kind: "ignore", reason: "already-attempted" });
  });

  it("does not rebuild for other media errors and normalizes invalid recovery time", () => {
    expect(planVideoDecodeRecovery({
      errorCode: 4,
      hasSource: true,
      sourceLoadGeneration: 1,
      attemptedSourceLoadGeneration: null,
      currentTime: 12,
      resumePlayback: false,
    })).toEqual({ kind: "ignore", reason: "not-decode-error" });

    expect(planVideoDecodeRecovery({
      errorCode: MEDIA_ERR_DECODE,
      hasSource: true,
      sourceLoadGeneration: 2,
      attemptedSourceLoadGeneration: null,
      currentTime: Number.NaN,
      resumePlayback: false,
    })).toEqual({
      kind: "recover",
      recovery: {
        sourceLoadGeneration: 2,
        restoreTime: 0,
        resumePlayback: false,
      },
    });
  });
});

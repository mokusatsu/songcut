/** HTML media specification defines code 3 as a decoding failure after the resource became usable. */
export const MEDIA_ERR_DECODE = 3;

export type VideoDecodeRecovery = {
  sourceLoadGeneration: number;
  restoreTime: number;
  resumePlayback: boolean;
};

export type VideoDecodeRecoveryPlan =
  | { kind: "recover"; recovery: VideoDecodeRecovery }
  | { kind: "ignore"; reason: "not-decode-error" | "already-attempted" | "no-source" };

/**
 * `MEDIA_ERR_DECODE`の自動復旧を一つの読み込み世代に一度だけ許可する。
 * 同じ壊れたdecoderへ無限に再試行しないため、次の動画読み込みまで再構築は行わない。
 */
export function planVideoDecodeRecovery(input: {
  errorCode: number | null | undefined;
  hasSource: boolean;
  sourceLoadGeneration: number;
  attemptedSourceLoadGeneration: number | null;
  currentTime: number;
  resumePlayback: boolean;
}): VideoDecodeRecoveryPlan {
  if (input.errorCode !== MEDIA_ERR_DECODE) return { kind: "ignore", reason: "not-decode-error" };
  if (!input.hasSource) return { kind: "ignore", reason: "no-source" };
  if (input.attemptedSourceLoadGeneration === input.sourceLoadGeneration) {
    return { kind: "ignore", reason: "already-attempted" };
  }
  return {
    kind: "recover",
    recovery: {
      sourceLoadGeneration: input.sourceLoadGeneration,
      restoreTime: normalizeRestoreTime(input.currentTime),
      resumePlayback: input.resumePlayback,
    },
  };
}

/** `currentTime`が不正でも新しいvideoへ安全に渡せる時刻へ正規化する。 */
function normalizeRestoreTime(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

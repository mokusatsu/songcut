export type MediaDiagnosticTarget = "video" | "scratch-proxy-audio";
export type MediaDiagnosticDetails = Record<string, boolean | number | string | null>;

type DiagnosticMedia = Pick<
  HTMLMediaElement,
  "currentTime" | "duration" | "ended" | "error" | "networkState" | "paused" | "readyState" | "seeking"
>;

export type MediaDiagnosticSnapshot = {
  target: MediaDiagnosticTarget;
  event: string;
  currentTime: number | null;
  duration: number | null;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  readyState: number;
  networkState: number;
  error: { code: number; message: string | null } | null;
  details: MediaDiagnosticDetails;
};

function roundedMediaTime(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

/** 媒体の停止原因を追跡するため、個人パスを含めない状態snapshotを作る。 */
export function mediaDiagnosticSnapshot(
  target: MediaDiagnosticTarget,
  event: string,
  media: DiagnosticMedia,
  details: MediaDiagnosticDetails = {}
): MediaDiagnosticSnapshot {
  const error = media.error;
  return {
    target,
    event,
    currentTime: roundedMediaTime(media.currentTime),
    duration: roundedMediaTime(media.duration),
    paused: media.paused,
    ended: media.ended,
    seeking: media.seeking,
    readyState: media.readyState,
    networkState: media.networkState,
    error: error ? { code: error.code, message: error.message || null } : null,
    details
  };
}

/** renderer consoleを介して配布ランチャーログへ媒体状態を転送する。 */
export function logMediaDiagnostic(
  target: MediaDiagnosticTarget,
  event: string,
  media: DiagnosticMedia,
  details: MediaDiagnosticDetails = {}
) {
  console.info("[songcut-media]", JSON.stringify(mediaDiagnosticSnapshot(target, event, media, details)));
}

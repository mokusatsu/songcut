import type {
  AnalysisResult,
  ExportRenderPlan,
  FfmpegCheckResult,
  JobRecord,
  ScratchProxyResult,
  Segment,
  VideoInfo,
  WaveformUpdate
} from "@/types";
import type { BoundaryRefinementSettings } from "@/lib/boundaryRefinement";
import {
  normalizeSubtitleStyle,
  type LyricsLane,
  type SubtitleRenderRequestItem,
} from "@/lib/subtitles";

export type AnalysisDevice = "auto" | "npu" | "gpu" | "cpu";
export type WhisperDevice = "auto" | "npu" | "gpu" | "cpu";
export type DemucsDevice = "auto" | "npu" | "gpu" | "cpu";
export type MmsDevice = "auto" | "gpu" | "cpu";
export type WhisperModelKey = "tiny" | "base" | "small" | "whisper-large-v3-turbo-int8-ov";
export type LyricsAlignmentAlgorithm = "songcut-standard" | "uta-align";
export type WhisperSettings = {
  enabled: boolean;
  model: WhisperModelKey;
  language: string;
  device: WhisperDevice;
  demucsDevice: DemucsDevice;
  mmsDevice: MmsDevice;
  lyricsAlignmentAlgorithm: LyricsAlignmentAlgorithm;
};

export type TranscriptionSettings = Pick<WhisperSettings, "model" | "language" | "device">;
export type LyricsAnalysisSettings = Pick<
  WhisperSettings,
  "model" | "language" | "device" | "demucsDevice" | "mmsDevice" | "lyricsAlignmentAlgorithm"
>;

export type WhisperModelStatus = {
  key: WhisperModelKey;
  display_name: string;
  model_id: string;
  repo_id: string;
  ready: boolean;
  source: "bundled" | "downloaded" | null;
  model_dir: string;
  installed_bytes: number | null;
  speed: string;
  quality: string;
};

export type WhisperStatus = {
  default_model: WhisperModelKey;
  models: WhisperModelStatus[];
  languages: { code: string; label: string }[];
  devices: Record<WhisperDevice, { device_used?: string; error?: string }>;
  model_id: string;
  ready: boolean;
};

export type DemucsStatus = {
  model: string;
  repo_id: string;
  ready: boolean;
  source: "bundled" | "downloaded" | null;
  model_dir: string;
  installed_bytes: number | null;
};

export type MmsStatus = {
  model: string;
  variant: string;
  repo_id: string;
  ready: boolean;
  source: "bundled" | "downloaded" | null;
  model_dir: string;
  installed_bytes: number | null;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: unknown
  ) {
    super(message);
  }
}

/** `postJson`でJSON bodyを送信し、HTTP失敗を詳細付き例外へ変換する。 */
export async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    let detail: unknown = text;
    try {
      detail = JSON.parse(text) as unknown;
    } catch {
      // Preserve the plain response.
    }
    throw new ApiError(text || response.statusText, response.status, detail);
  }
  return (await response.json()) as T;
}

/** `getJson`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
export async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

/** `deleteJson`の対象を取り除き、関連する一時状態やresourceを後始末する。 */
export async function deleteJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

/** `probeVideo`でmediaを解析し、再生時間・stream・codec情報を取得する。 */
export function probeVideo(baseUrl: string, filePath: string) {
  return postJson<VideoInfo>(baseUrl, "/videos/probe", { path: filePath });
}

/** `startAnalysis`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startAnalysis(
  baseUrl: string,
  filePath: string,
  guideText: string,
  analysisDevice: AnalysisDevice,
  boundaryRefinement: BoundaryRefinementSettings
) {
  return postJson<JobRecord>(baseUrl, "/analysis/jobs", {
    path: filePath,
    guide_text: guideText,
    timestamp_source: "auto",
    device: analysisDevice,
    boundary_refinement: boundaryRefinement,
    transcribe: false
  });
}

/** `startWaveform`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startWaveform(baseUrl: string, filePath: string) {
  return postJson<JobRecord>(baseUrl, "/waveform/jobs", { path: filePath });
}

/** `getWaveformUpdates`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
export function getWaveformUpdates(baseUrl: string, jobId: string, cursor: number, limit = 2048) {
  const query = new URLSearchParams({ cursor: String(cursor), limit: String(limit) });
  return getJson<WaveformUpdate>(baseUrl, `/waveform/jobs/${encodeURIComponent(jobId)}/updates?${query}`);
}

/** `cancelOrReleaseWaveform`の入力が要求された条件やschemaを満たすか検証する。 */
export function cancelOrReleaseWaveform(baseUrl: string, jobId: string) {
  return deleteJson<JobRecord>(baseUrl, `/waveform/jobs/${encodeURIComponent(jobId)}`);
}

/** `getWhisperStatus`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
export function getWhisperStatus(baseUrl: string) {
  return getJson<WhisperStatus>(baseUrl, "/models/whisper");
}

/** `startWhisperDownload`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startWhisperDownload(baseUrl: string, model: WhisperModelKey = "whisper-large-v3-turbo-int8-ov") {
  return postJson<JobRecord>(baseUrl, "/models/whisper/download", { model });
}

/** `getDemucsStatus`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
export function getDemucsStatus(baseUrl: string) {
  return getJson<DemucsStatus>(baseUrl, "/models/demucs");
}

/** `startDemucsDownload`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startDemucsDownload(baseUrl: string) {
  return postJson<JobRecord>(baseUrl, "/models/demucs/download", {});
}

/** `getMmsStatus`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
export function getMmsStatus(baseUrl: string) {
  return getJson<MmsStatus>(baseUrl, "/models/mms");
}

/** `startMmsDownload`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startMmsDownload(baseUrl: string) {
  return postJson<JobRecord>(baseUrl, "/models/mms/download", {});
}

/** `startTranscription`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startTranscription(
  baseUrl: string,
  sourcePath: string,
  segments: Pick<Segment, "id" | "start" | "end">[],
  settings: TranscriptionSettings,
  initialPrompt: string
) {
  return postJson<JobRecord>(baseUrl, "/transcription/jobs", {
    source_path: sourcePath,
    segments: segments.map(({ id, start, end }) => ({ id, start, end })),
    model: settings.model,
    language: settings.language,
    device: settings.device,
    initial_prompt: initialPrompt.trim() || null
  });
}

/** `checkFfmpeg`の現在値を検査し、後続処理に必要な判定結果を返す。 */
export function checkFfmpeg(baseUrl: string) {
  return getJson<FfmpegCheckResult>(baseUrl, "/ffmpeg/check");
}

/** `startExport`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startExport(
  baseUrl: string,
  sourcePath: string,
  outputDir: string,
  items: unknown[],
  timestampCommentText = "",
  createSourceFolder = false
) {
  return postJson<JobRecord>(baseUrl, "/export/jobs", {
    source_path: sourcePath,
    output_dir: outputDir,
    items,
    timestamp_comment_text: timestampCommentText,
    create_source_folder: createSourceFolder
  });
}

/** `startLyricsAnalysis`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startLyricsAnalysis(
  baseUrl: string,
  sourcePath: string,
  lyricsText: string,
  settings: LyricsAnalysisSettings
) {
  return postJson<JobRecord>(baseUrl, "/lyrics-analysis/jobs", {
    source_path: sourcePath,
    lyrics_text: lyricsText,
    model: settings.model,
    language: settings.language,
    device: settings.device,
    demucs_device: settings.demucsDevice,
    mms_device: settings.mmsDevice,
    algorithm: settings.lyricsAlignmentAlgorithm,
  });
}

/** `startSubtitleExport`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startSubtitleExport(
  baseUrl: string,
  sourcePath: string,
  outputDir: string,
  videoWidth: number,
  videoHeight: number,
  lanes: LyricsLane[]
) {
  return postJson<JobRecord>(baseUrl, "/subtitle-export/jobs", {
    source_path: sourcePath,
    output_dir: outputDir,
    play_res_x: videoWidth,
    play_res_y: videoHeight,
    lanes: lanes.map((lane) => ({ ...lane, style: normalizeSubtitleStyle(lane.style) })),
  });
}

export type SubtitleRenderResultItem = {
  segment_id: string;
  signature: string;
  png_base64: string;
  width: number;
  height: number;
};

/** `startSubtitleRender`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startSubtitleRender(
  baseUrl: string,
  videoWidth: number,
  videoHeight: number,
  items: SubtitleRenderRequestItem[]
) {
  return postJson<JobRecord>(baseUrl, "/subtitle-render/jobs", {
    play_res_x: videoWidth,
    play_res_y: videoHeight,
    items: items.map((item) => ({ ...item, style: normalizeSubtitleStyle(item.style) })),
  });
}

/** `getExportPlan`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
export function getExportPlan(baseUrl: string, sourcePath: string, items: unknown[]) {
  return postJson<ExportRenderPlan>(baseUrl, "/export/plan", {
    source_path: sourcePath,
    items
  });
}

/** `startScratchProxy`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startScratchProxy(baseUrl: string, sourcePath: string) {
  return postJson<JobRecord>(baseUrl, "/scratch-proxy/jobs", { path: sourcePath });
}

/** `cancelScratchProxy`の入力が要求された条件やschemaを満たすか検証する。 */
export function cancelScratchProxy(baseUrl: string, jobId: string) {
  return deleteJson<JobRecord>(baseUrl, `/scratch-proxy/jobs/${encodeURIComponent(jobId)}`);
}

/** `releaseScratchProxy`の対象を取り除き、関連する一時状態やresourceを後始末する。 */
export function releaseScratchProxy(baseUrl: string, proxyId: string) {
  return deleteJson<{ released: boolean }>(baseUrl, `/scratch-proxies/${encodeURIComponent(proxyId)}`);
}

/** `waitForJob`の完了条件まで待機し、成功時の結果または失敗を返す。 */
export async function waitForJob<T = unknown>(
  baseUrl: string,
  id: string,
  onUpdate: (job: JobRecord) => void,
  pollIntervalMilliseconds = 800
): Promise<T> {
  for (;;) {
    const job = await getJson<JobRecord>(baseUrl, `/jobs/${id}`);
    onUpdate(job);
    if (job.status === "completed") return job.result as T;
    if (job.status === "failed") throw new Error(job.error || "job failed");
    if (job.status === "cancelled") throw new Error("job cancelled");
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMilliseconds));
  }
}

export type { ScratchProxyResult };

/** `isAnalysisResult`の入力が要求された条件やschemaを満たすか検証する。 */
export function isAnalysisResult(value: unknown): value is AnalysisResult {
  return Boolean(value && typeof value === "object" && Array.isArray((value as AnalysisResult).segments));
}

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
  type AlignmentDiagnostics,
  type DisplayElement,
  type LyricsAnalysisArtifact,
  type LyricsLane,
  type SubtitleRenderRequestItem,
} from "@/lib/subtitles";
import {
  normalizeSubtitleEffect,
  type SubtitleEffectCatalog,
} from "@/lib/subtitleEffects";
import type { SubtitleFileExportFormat } from "@/lib/subtitleFileExport";

export type AnalysisDevice = "auto" | "npu" | "gpu" | "cpu";
export type WhisperDevice = "auto" | "npu" | "gpu" | "cpu";
export type DemucsDevice = "auto" | "npu" | "gpu" | "cpu";
export type MmsDevice = "auto" | "gpu" | "cpu";
export type SubtitleFileExportResult = {
  file: string;
  format: SubtitleFileExportFormat;
  output_dir: string;
};
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
export async function postJson<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
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
export async function getJson<T>(baseUrl: string, path: string, signal?: AbortSignal): Promise<T> {
  const response = signal
    ? await fetch(`${baseUrl}${path}`, { signal })
    : await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

/** `getSubtitleEffectCatalog`で全Sub editorが使うbackend catalogを取得する。 */
export function getSubtitleEffectCatalog(baseUrl: string) {
  return getJson<unknown>(baseUrl, "/subtitle-effects/catalog");
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
  createSourceFolder = false,
  normalizeAudio = false,
  targetTruePeakDbtp = -1.0
) {
  return postJson<JobRecord>(baseUrl, "/export/jobs", {
    source_path: sourcePath,
    output_dir: outputDir,
    items,
    timestamp_comment_text: timestampCommentText,
    create_source_folder: createSourceFolder,
    normalize_audio: normalizeAudio,
    target_true_peak_dbtp: targetTruePeakDbtp
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

export type LyricsLineReanalysisSnapshot = {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  alignment_source: string;
  display_elements: DisplayElement[];
  display_element_text?: string;
  line_revision: number;
  display_element_revision: number;
  start_locked: boolean;
  end_locked: boolean;
  needs_reanalysis: boolean;
};

export type LyricsLineContext = {
  text: string;
  start: number;
  end: number;
  confidence: number;
  alignment_source: string;
};

export type LyricsLineAnalysisInput = {
  sourcePath: string;
  sourceFingerprint: LyricsAnalysisArtifact["source_fingerprint"];
  line: LyricsLineReanalysisSnapshot;
  nextLine?: LyricsLineContext;
  language: string;
  demucsDevice: DemucsDevice;
  mmsDevice: MmsDevice;
  expectedLineRevision: number;
  expectedDisplayElementRevision: number;
  projectEpoch: number;
  reanalysisEpoch: number;
};

export type LyricsLineAnalysisResult = {
  outcome: "applied" | "conflict";
  conflict?: string;
  line_id: string;
  project_epoch: number;
  line_revision: number;
  display_element_revision: number;
  reanalysis_epoch: number;
  cache_hit: boolean;
  analysis_artifact: LyricsAnalysisArtifact;
  line?: {
    id: string;
    text: string;
    start: number;
    end: number;
    confidence: number;
    display_elements: DisplayElement[];
    display_element_text: string;
    line_revision: number;
    display_element_revision: number;
    start_locked: boolean;
    end_locked: boolean;
    alignment_diagnostics: AlignmentDiagnostics;
    needs_reanalysis: false;
  };
  reconciliation?: {
    preserved_manual_element_ids: string[];
    orphaned_manual_element_ids: string[];
    dropped_auto_element_ids: string[];
    reconciliation_conflicts: string[];
  };
};

/** 対象歌詞行だけのStandard Align再解析jobを開始する。 */
export function startLyricsLineAnalysis(baseUrl: string, input: LyricsLineAnalysisInput) {
  return postJson<JobRecord>(baseUrl, "/lyrics-analysis/line-jobs", {
    source_path: input.sourcePath,
    source_fingerprint: input.sourceFingerprint,
    line: input.line,
    next_line: input.nextLine,
    language: input.language,
    demucs_device: input.demucsDevice,
    mms_device: input.mmsDevice,
    expected_line_revision: input.expectedLineRevision,
    expected_display_element_revision: input.expectedDisplayElementRevision,
    project_epoch: input.projectEpoch,
    reanalysis_epoch: input.reanalysisEpoch,
  });
}

/** queued/runningの対象行再解析jobを冪等に取り消す。 */
export function cancelLyricsLineAnalysis(baseUrl: string, jobId: string) {
  return deleteJson<JobRecord>(baseUrl, `/lyrics-analysis/line-jobs/${encodeURIComponent(jobId)}`);
}

/** `startSubtitleExport`に対応するバックエンドAPIを呼び出し、開始されたjobを返す。 */
export function startSubtitleExport(
  baseUrl: string,
  sourcePath: string,
  outputDir: string,
  videoWidth: number,
  videoHeight: number,
  lanes: LyricsLane[],
  catalog: SubtitleEffectCatalog,
) {
  return postJson<JobRecord>(baseUrl, "/subtitle-export/jobs", {
    source_path: sourcePath,
    output_dir: outputDir,
    play_res_x: videoWidth,
    play_res_y: videoHeight,
    lanes: lanes.map((lane) => ({
      ...lane,
      style: normalizeSubtitleStyle(lane.style),
      effect: normalizeSubtitleEffect(lane.effect, catalog),
      segments: lane.segments.map((segment) => ({
        ...segment,
        ...(segment.style_override
          ? { style_override: normalizeSubtitleStyle(segment.style_override) }
          : {}),
        ...(segment.effect_override
          ? { effect_override: normalizeSubtitleEffect(segment.effect_override, catalog) }
          : {}),
      })),
    })),
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
  pollIntervalMilliseconds = 800,
  signal?: AbortSignal,
): Promise<T> {
  for (;;) {
    signal?.throwIfAborted();
    const job = await getJson<JobRecord>(baseUrl, `/jobs/${id}`, signal);
    onUpdate(job);
    if (job.status === "completed") return job.result as T;
    if (job.status === "failed") throw new Error(job.error || "job failed");
    if (job.status === "cancelled") throw new DOMException("job cancelled", "AbortError");
    await abortableDelay(pollIntervalMilliseconds, signal);
  }
}

/** 指定時間のpoll待機をAbortSignalで中断可能にする。 */
function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      globalThis.clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** 選択Timelineを一つのSRT／LRC／ASS字幕ファイルへ統合して書き出す。 */
export function exportSubtitleFile(
  baseUrl: string,
  sourcePath: string,
  outputDir: string,
  videoWidth: number,
  videoHeight: number,
  lanes: readonly LyricsLane[],
  format: SubtitleFileExportFormat,
) {
  return postJson<SubtitleFileExportResult>(baseUrl, "/subtitle-files/export", {
    source_path: sourcePath,
    output_dir: outputDir,
    format,
    play_res_x: videoWidth,
    play_res_y: videoHeight,
    lanes: lanes.map((lane) => ({
      id: lane.id,
      name: lane.name,
      style: normalizeSubtitleStyle(lane.style),
      effect: lane.effect,
      segments: lane.segments.map((segment) => ({
        id: segment.id,
        text: segment.text,
        start: segment.start,
        end: segment.end,
        ...(segment.style_override
          ? { style_override: normalizeSubtitleStyle(segment.style_override) }
          : {}),
        ...(segment.effect_override ? { effect_override: segment.effect_override } : {}),
        display_elements: (segment.display_elements ?? []).map((element) => ({
          text: element.text,
          start: element.start,
          end: element.end,
        })),
      })),
    })),
  });
}

export type { ScratchProxyResult };

/** `isAnalysisResult`の入力が要求された条件やschemaを満たすか検証する。 */
export function isAnalysisResult(value: unknown): value is AnalysisResult {
  return Boolean(value && typeof value === "object" && Array.isArray((value as AnalysisResult).segments));
}

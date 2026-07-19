import type { AnalysisResult, FfmpegCheckResult, JobRecord, ScratchProxyResult, Segment, VideoInfo } from "@/types";

export type AnalysisDevice = "auto" | "npu" | "gpu" | "cpu";
export type WhisperDevice = "auto" | "npu" | "gpu" | "cpu";
export type WhisperModelKey = "tiny" | "base" | "small";
export type WhisperSettings = {
  enabled: boolean;
  model: WhisperModelKey;
  language: string;
  device: WhisperDevice;
};

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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: unknown
  ) {
    super(message);
  }
}

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

export async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export async function deleteJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export function probeVideo(baseUrl: string, filePath: string) {
  return postJson<VideoInfo>(baseUrl, "/videos/probe", { path: filePath });
}

export function startAnalysis(
  baseUrl: string,
  filePath: string,
  guideText: string,
  analysisDevice: AnalysisDevice
) {
  return postJson<JobRecord>(baseUrl, "/analysis/jobs", {
    path: filePath,
    guide_text: guideText,
    timestamp_source: "auto",
    device: analysisDevice,
    transcribe: false
  });
}

export function getWhisperStatus(baseUrl: string) {
  return getJson<WhisperStatus>(baseUrl, "/models/whisper");
}

export function startWhisperDownload(baseUrl: string, model: WhisperModelKey = "small") {
  return postJson<JobRecord>(baseUrl, "/models/whisper/download", { model });
}

export function startTranscription(
  baseUrl: string,
  sourcePath: string,
  segments: Pick<Segment, "id" | "start" | "end">[],
  settings: WhisperSettings,
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

export function checkFfmpeg(baseUrl: string) {
  return getJson<FfmpegCheckResult>(baseUrl, "/ffmpeg/check");
}

export function startExport(baseUrl: string, sourcePath: string, outputDir: string, items: unknown[], timestampCommentText = "") {
  return postJson<JobRecord>(baseUrl, "/export/jobs", {
    source_path: sourcePath,
    output_dir: outputDir,
    items,
    timestamp_comment_text: timestampCommentText
  });
}

export function startScratchProxy(baseUrl: string, sourcePath: string) {
  return postJson<JobRecord>(baseUrl, "/scratch-proxy/jobs", { path: sourcePath });
}

export function cancelScratchProxy(baseUrl: string, jobId: string) {
  return deleteJson<JobRecord>(baseUrl, `/scratch-proxy/jobs/${encodeURIComponent(jobId)}`);
}

export function releaseScratchProxy(baseUrl: string, proxyId: string) {
  return deleteJson<{ released: boolean }>(baseUrl, `/scratch-proxies/${encodeURIComponent(proxyId)}`);
}

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

export function isAnalysisResult(value: unknown): value is AnalysisResult {
  return Boolean(value && typeof value === "object" && Array.isArray((value as AnalysisResult).segments));
}

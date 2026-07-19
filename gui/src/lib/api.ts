import type { AnalysisResult, FfmpegCheckResult, JobRecord, ScratchProxyResult, VideoInfo } from "@/types";

export type AnalysisDevice = "auto" | "npu" | "gpu" | "cpu";
export type WhisperDevice = "auto" | "npu" | "gpu" | "cpu";

export async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || response.statusText);
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
  analysisDevice: AnalysisDevice,
  whisperDevice: WhisperDevice
) {
  return postJson<JobRecord>(baseUrl, "/analysis/jobs", {
    path: filePath,
    guide_text: guideText,
    timestamp_source: "auto",
    device: analysisDevice,
    transcribe: true,
    whisper_device: whisperDevice,
    whisper_language: "<|ja|>"
  });
}

export function startWhisperDownload(baseUrl: string) {
  return postJson<JobRecord>(baseUrl, "/models/whisper/download", {});
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

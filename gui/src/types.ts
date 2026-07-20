export type TimestampCommentCandidate = {
  source: "description" | "comment";
  id: string;
  author: string;
  text: string;
  timestamp_count: number;
  like_count: number | null;
};

export type VideoInfo = {
  path: string;
  name: string;
  duration: number;
  bit_rate: number;
  video: { codec?: string; width?: number; height?: number; fps?: string; bit_rate?: number };
  audio: { codec?: string; bit_rate?: number };
  timestamp_comment_candidates: TimestampCommentCandidate[];
  info_json_warning: string | null;
};

export type WaveformPoint = {
  t: number;
  min: number;
  max: number;
  rms: number;
  sample_count: number;
};

export type WaveformMetadata = {
  source_path: string;
  duration: number;
  sample_rate: number;
  channels: number;
  generator: string;
  point_count: number;
};

export type WaveformUpdate = {
  id: string;
  status: JobRecord["status"];
  progress: number;
  message: string;
  message_code?: string;
  message_args?: Record<string, string | number>;
  error: string | null;
  cursor: number;
  points: WaveformPoint[];
  has_more: boolean;
  metadata: WaveformMetadata | null;
};

export type WaveformDisplayMode = "rms" | "peak" | "peak-rms";

export type Transcript = {
  segment_id: string;
  text: string;
  language: string | null;
  chunks: { start: number; end: number; text: string }[];
  backend: string;
  device_used: string;
  model_id: string;
  model_key?: "tiny" | "base" | "small";
  language_requested?: string;
  device_requested?: "auto" | "npu" | "gpu" | "cpu";
  error?: string | null;
};

export type Segment = {
  id: string;
  title?: string;
  filename_stem?: string;
  start: number;
  end: number;
  start_timecode: string;
  end_timecode: string;
  duration: number;
  confidence: number;
  source: string;
  match_source?: string;
  guide_line_number?: number;
  guide_line?: string;
  distance_seconds?: number | null;
  flags: string[];
  user_edited: boolean;
  checked?: boolean;
  transcript?: Transcript;
};

export type ExportCandidate = {
  id: string;
  title: string;
  filename_stem: string;
  start: number;
  end: number;
  duration: number;
  match_source: string;
  checked: boolean;
};

export type AnalysisResult = {
  schema_version: number;
  source_path: string;
  duration: number;
  timestamp_source: string;
  profile?: string;
  model_versions?: Record<string, string>;
  device_used: string;
  device_requested?: string;
  backend: string;
  elapsed_seconds?: number;
  segments: Segment[];
  raw_segments?: Segment[];
  export_candidates: ExportCandidate[];
  waveform: WaveformPoint[];
  frame_scores?: { t: number; score: number; rms: number }[];
  transcription_job_id?: string;
};

export type JobRecord = {
  id: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  message_code?: string;
  message_args?: Record<string, string | number>;
  result?: unknown;
  error?: string | null;
  created_at: number;
  updated_at: number;
};

export type ExportRenderPlanItem = {
  id: string;
  smart_render: boolean;
  output_suffix: string;
  video_codec: string;
  container_family: string;
  copied_seconds: number;
  encoded_seconds: number;
  fallback_reason: string | null;
};

export type ExportRenderPlan = {
  items: ExportRenderPlanItem[];
};

export type ScratchProxyResult = {
  proxy_id: string;
  source_path: string;
  proxy_path: string;
  codec: "aac";
  profile: "LC";
  sample_rate: number;
  channels: number;
  bit_rate: number;
  encoder: "aac_mf" | "aac";
  duration: number;
};

export type FfmpegCheckResult = {
  ok: boolean;
  ffmpeg?: string | null;
  ffprobe?: string | null;
  error?: string | null;
  download_url: string;
};

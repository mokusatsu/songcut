export type VideoInfo = {
  path: string;
  name: string;
  duration: number;
  bit_rate: number;
  video: { codec?: string; width?: number; height?: number; fps?: string; bit_rate?: number };
  audio: { codec?: string; bit_rate?: number };
};

export type WaveformPoint = {
  t: number;
  min: number;
  max: number;
  rms: number;
};

export type Transcript = {
  segment_id: string;
  text: string;
  language: string | null;
  chunks: { start: number; end: number; text: string }[];
  backend: string;
  device_used: string;
  model_id: string;
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
  source_path: string;
  duration: number;
  timestamp_source: string;
  device_used: string;
  backend: string;
  segments: Segment[];
  raw_segments?: Segment[];
  export_candidates: ExportCandidate[];
  waveform: WaveformPoint[];
  transcription_job_id?: string;
};

export type JobRecord = {
  id: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message: string;
  result?: unknown;
  error?: string | null;
};

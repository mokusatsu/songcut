import { describe, expect, it } from "vitest";
import { assertProjectDocument } from "../../electron/project-schema.js";
import {
  DEFAULT_WHISPER_SETTINGS,
  analysisFromProject,
  composeProjectDocument,
  createProjectDocument,
  filenameTemplateFromProject,
  normalizeInterruptedOperation,
  transcriptSettingsAreStale,
  waveformFromProject,
} from "./project";
import { DEFAULT_FILENAME_TEMPLATE } from "./exportNaming";
import type { AnalysisResult, Segment, VideoInfo } from "../types";

const source = {
  path: "C:\\media\\archive.mp4",
  filename: "archive.mp4",
  size_bytes: 1234,
  mtime_ms: 5678,
  fingerprint: { algorithm: "sha256-head-tail-1m-v1" as const, value: "a".repeat(64) },
};

const videoInfo: VideoInfo = {
  path: source.path,
  name: source.filename,
  format_name: "mov,mp4",
  duration: 30,
  bit_rate: 0,
  video: {},
  audio: {},
  timestamp_comment_candidates: [],
  info_json_warning: null,
  smart_render_estimate: {
    smart_render: true,
    source_container: "mp4",
    container_family: "mp4",
    output_suffix: ".mp4",
    video_codec: "h264",
    fallback_reason: null,
  },
};

const segment: Segment = {
  id: "seg-001",
  title: "Song",
  start: 1,
  end: 5,
  start_timecode: "00:01",
  end_timecode: "00:05",
  duration: 4,
  confidence: 0.9,
  source: "audio",
  flags: [],
  user_edited: true,
  checked: true,
  transcript: {
    segment_id: "seg-001",
    text: "hello",
    language: "ja",
    chunks: [],
    backend: "openvino-genai",
    device_used: "CPU",
    model_id: "openai/whisper-small",
    model_key: "small",
    language_requested: "ja",
    device_requested: "auto",
  },
};

const analysis: AnalysisResult = {
  schema_version: 3,
  source_path: source.path,
  duration: 30,
  timestamp_source: "guide",
  device_requested: "auto",
  device_used: "CPU",
  backend: "dsp",
  model_versions: { detector: "1" },
  elapsed_seconds: 2,
  segments: [segment],
  raw_segments: [segment],
  export_candidates: [
    {
      id: "candidate-001",
      title: "Song",
      filename_stem: "01_Song",
      start: 1,
      end: 5,
      duration: 4,
      match_source: "guide",
      checked: true,
    },
  ],
  waveform: [{ t: 0, min: -1, max: 1, rms: 0.5, sample_count: 100 }],
  frame_scores: [{ t: 0, score: 0.8, rms: 0.5 }],
};

describe("project document composition", () => {
  it("round-trips edited segments, transcript, waveform, candidates, and settings", () => {
    const base = createProjectDocument("C:\\media\\archive.mp4.songcut", source, videoInfo);
    const document = composeProjectDocument(base, {
      revision: 7,
      videoPath: source.path,
      duration: 30,
      guideText: "0:01 Song",
      waveform: analysis.waveform,
      analysis,
      segments: [segment],
      exportCandidates: analysis.export_candidates,
      analysisDevice: "gpu",
      whisper: { enabled: true, model: "small", language: "ja", device: "auto" },
      filenameTemplate: "{title}_{start}",
      selectedSegmentId: segment.id,
      currentTime: 2,
      zoomIndex: 3,
      operation: null,
    });

    expect(() => assertProjectDocument(JSON.parse(JSON.stringify(document)))).not.toThrow();
    expect(document.revision).toBe(7);
    expect(document.segments[0].transcript?.text).toBe("hello");
    expect(document.waveform_snapshot).toMatchObject({
      schema_version: 2,
      encoding: "f32le-4-u32le-1-v1",
      point_count: analysis.waveform.length,
    });
    expect(document.waveform_snapshot).not.toHaveProperty("points");
    expect(document.waveform_snapshot?.data_base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(waveformFromProject(document)).toEqual(analysis.waveform);
    expect(document.export_candidates[0].segment_id).toBe("seg-001");
    expect(document.settings.whisper.enabled).toBe(true);
    expect(document.settings.whisper.language).toBe("ja");
    expect(document.settings.export?.filename_template).toBe("{title}_{start}");
    expect(filenameTemplateFromProject(document)).toBe("{title}_{start}");
    expect(analysisFromProject(document)?.segments[0].title).toBe("Song");
  });

  it("round-trips a provisional guide timestamp segment with its guide metadata", () => {
    const provisional: Segment = {
      ...segment,
      id: "guide-002",
      title: "MC",
      filename_stem: "02_MC",
      start: 2240,
      end: 2338,
      start_timecode: "37:20",
      end_timecode: "38:58",
      duration: 98,
      confidence: 0,
      source: "guide-timestamp-fallback",
      match_source: "guide-timestamp-fallback",
      guide_line_number: 2,
      guide_line: "0:37:20 MC",
      distance_seconds: null,
      flags: ["guide", "provisional", "no-detected-singing"],
      transcript: undefined,
    };
    const provisionalAnalysis: AnalysisResult = {
      ...analysis,
      segments: [provisional],
      export_candidates: [
        {
          id: "export-002",
          title: "MC",
          filename_stem: "02_MC",
          start: 2240,
          end: 2338,
          duration: 98,
          match_source: "guide-timestamp-fallback",
          checked: true,
        },
      ],
    };
    const base = createProjectDocument("C:\\media\\archive.mp4.songcut", source, { ...videoInfo, duration: 2400 });
    const document = composeProjectDocument(base, {
      revision: 2,
      videoPath: source.path,
      duration: 2400,
      guideText: "0:37:20 MC",
      waveform: provisionalAnalysis.waveform,
      analysis: provisionalAnalysis,
      segments: [provisional],
      exportCandidates: provisionalAnalysis.export_candidates,
      analysisDevice: "auto",
      whisper: DEFAULT_WHISPER_SETTINGS,
      filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
      selectedSegmentId: provisional.id,
      currentTime: provisional.start,
      zoomIndex: 0,
      operation: null,
    });
    const restored: unknown = JSON.parse(JSON.stringify(document));

    assertProjectDocument(restored);
    expect(analysisFromProject(restored)?.segments[0]).toMatchObject({
      source: "guide-timestamp-fallback",
      match_source: "guide-timestamp-fallback",
      guide_line_number: 2,
      guide_line: "0:37:20 MC",
      flags: ["guide", "provisional", "no-detected-singing"],
      start: 2240,
      end: 2338,
    });
  });

  it("defaults new projects to Whisper off, Small, Japanese, and Auto", () => {
    expect(DEFAULT_WHISPER_SETTINGS).toEqual({ enabled: false, model: "small", language: "ja", device: "auto" });
  });

  it("defaults new and existing v3 projects to the standard filename template", () => {
    const document = createProjectDocument("C:\\media\\archive.mp4.songcut", source, videoInfo);
    expect(filenameTemplateFromProject(document)).toBe(DEFAULT_FILENAME_TEMPLATE);
    delete document.settings.export;
    expect(() => assertProjectDocument(document)).not.toThrow();
    expect(filenameTemplateFromProject(document)).toBe(DEFAULT_FILENAME_TEMPLATE);
  });

  it("accepts user-managed segment order while keeping raw analysis chronologically sorted", () => {
    const document = createProjectDocument("C:\\media\\archive.mp4.songcut", source, videoInfo);
    document.segments = [
      { ...segment, id: "later", start: 10, end: 15, start_timecode: "0:10", end_timecode: "0:15", transcript: undefined },
      { ...segment, id: "earlier", start: 1, end: 5, start_timecode: "0:01", end_timecode: "0:05", transcript: undefined },
    ];
    expect(() => assertProjectDocument(document)).not.toThrow();
  });

  it("marks only model or requested-language changes as transcript-stale", () => {
    expect(transcriptSettingsAreStale(segment, { ...DEFAULT_WHISPER_SETTINGS, enabled: true })).toBe(false);
    expect(transcriptSettingsAreStale(segment, { ...DEFAULT_WHISPER_SETTINGS, device: "gpu" })).toBe(false);
    expect(transcriptSettingsAreStale(segment, { ...DEFAULT_WHISPER_SETTINGS, model: "base" })).toBe(true);
    expect(transcriptSettingsAreStale(segment, { ...DEFAULT_WHISPER_SETTINGS, language: "auto" })).toBe(true);
  });

  it("turns a persisted running operation into an interrupted operation", () => {
    expect(normalizeInterruptedOperation({ kind: "analysis", status: "running" })).toEqual({
      kind: "analysis",
      status: "interrupted",
    });
  });
});

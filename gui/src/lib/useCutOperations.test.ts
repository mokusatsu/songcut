import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BOUNDARY_REFINEMENT_SETTINGS } from "@/lib/boundaryRefinement";
import { DEFAULT_WHISPER_SETTINGS } from "@/lib/project";
import {
  createCutOperationCoordinator,
  type CutOperationOptions,
  type CutOperationServices,
} from "@/lib/useCutOperations";
import type { OperationRunner } from "@/lib/useOperationRunner";
import type { AnalysisResult, JobRecord, Segment, Transcript } from "@/types";

function job(id: string, kind: string): JobRecord {
  return {
    id,
    kind,
    status: "running",
    progress: 0,
    message: "running",
    created_at: 1,
    updated_at: 1,
  };
}

function segment(id = "segment-1"): Segment {
  return {
    id,
    title: "Verse",
    filename_stem: "verse",
    start: 1,
    end: 3,
    start_timecode: "00:00:01.000",
    end_timecode: "00:00:03.000",
    duration: 2,
    confidence: 0.9,
    source: "analysis",
    flags: [],
    user_edited: false,
  };
}

function analysisResult(segments: Segment[]): AnalysisResult {
  return {
    schema_version: 1,
    source_path: "song.mp4",
    duration: 10,
    timestamp_source: "audio",
    device_used: "cpu",
    backend: "test",
    segments,
    export_candidates: [],
    waveform: [],
  };
}

function executingRunner(): OperationRunner {
  let running = false;
  return {
    isRunning: () => running,
    run: async (options) => {
      running = true;
      try {
        const started = await options.start();
        const result = await options.poll(started.id, (nextJob) => options.onProgress?.(nextJob));
        await options.onSuccess?.(result);
        return result;
      } finally {
        running = false;
      }
    },
  };
}

function options(overrides: Partial<CutOperationOptions> = {}): CutOperationOptions {
  return {
    apiBaseUrl: "http://127.0.0.1:8000",
    videoPath: "song.mp4",
    guideText: "guide",
    analysisDevice: "cpu",
    boundaryRefinementSettings: { ...DEFAULT_BOUNDARY_REFINEMENT_SETTINGS },
    whisperSettings: { ...DEFAULT_WHISPER_SETTINGS, enabled: true },
    segments: [],
    projectOperation: null,
    operationRunner: executingRunner(),
    updateTask: vi.fn(),
    applyAnalysisResult: vi.fn(),
    applyTranscripts: vi.fn(),
    updateProjectOperation: vi.fn(),
    onExportStart: vi.fn(),
    onMessage: vi.fn(),
    refreshWhisperStatus: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Cut operation coordinator", () => {
  it("runs analysis and the optional transcription chain through the same coordinator", async () => {
    const detected = segment();
    const transcript: Transcript = {
      segment_id: detected.id,
      text: "hello",
      language: "en",
      chunks: [{ start: 1, end: 3, text: "hello" }],
      backend: "test",
      device_used: "cpu",
      model_id: "test-model",
    };
    const state = options();
    const services: CutOperationServices = {
      startAnalysis: vi.fn(async () => job("analysis-job", "analysis")),
      startTranscription: vi.fn(async () => job("transcription-job", "transcription")),
      startExport: vi.fn(async () => job("export-job", "export")),
      waitForJob: async <T,>(_baseUrl: string, jobId: string) => (
        jobId === "analysis-job"
          ? analysisResult([detected])
          : { transcripts: [transcript] }
      ) as T,
    };
    const coordinator = createCutOperationCoordinator(() => state, services);

    await coordinator.runAnalysis(true, "confirmed guide");

    expect(state.updateTask).toHaveBeenCalledWith("transcription", null);
    expect(state.applyAnalysisResult).toHaveBeenCalledWith(
      expect.objectContaining({ segments: [detected] }),
      [expect.objectContaining({ id: detected.id, checked: true })],
    );
    expect(services.startTranscription).toHaveBeenCalledWith(
      state.apiBaseUrl,
      state.videoPath,
      [expect.objectContaining({ id: detected.id, checked: true })],
      state.whisperSettings,
      "confirmed guide",
    );
    expect(services.startAnalysis).toHaveBeenCalledWith(
      state.apiBaseUrl,
      state.videoPath,
      "confirmed guide",
      state.analysisDevice,
      state.boundaryRefinementSettings,
    );
    expect(state.applyTranscripts).toHaveBeenCalledWith([transcript]);
  });

  it("keeps Cut export validation and request mapping outside App", async () => {
    const state = options();
    const startExport = vi.fn(async () => job("export-job", "export"));
    const services: CutOperationServices = {
      startAnalysis: vi.fn(async () => job("analysis-job", "analysis")),
      startTranscription: vi.fn(async () => job("transcription-job", "transcription")),
      startExport,
      waitForJob: async <T,>() => undefined as T,
    };
    const coordinator = createCutOperationCoordinator(() => state, services);

    await coordinator.exportClips({
      outputDir: "out",
      createSourceFolder: true,
      items: [{
        id: "one",
        segmentId: "segment-1",
        title: "One",
        filename_stem: "one",
        start: 1,
        end: 2,
        checked: true,
      }],
      timestampCommentText: "00:01 One",
      normalizeAudio: true,
      targetTruePeakDbtp: -1.5,
      validationError: "invalid filename",
    });
    expect(startExport).not.toHaveBeenCalled();
    expect(state.onMessage).toHaveBeenLastCalledWith("invalid filename");

    await coordinator.exportClips({
      outputDir: "out",
      createSourceFolder: true,
      items: [
        { id: "one", segmentId: "segment-1", title: "One", filename_stem: "one", start: 1, end: 2, checked: true },
        { id: "two", segmentId: "segment-2", title: "Two", filename_stem: "two", start: 2, end: 3, checked: false },
      ],
      timestampCommentText: "00:01 One",
      normalizeAudio: true,
      targetTruePeakDbtp: -1.5,
    });
    expect(state.onExportStart).toHaveBeenCalledOnce();
    expect(startExport).toHaveBeenCalledWith(
      state.apiBaseUrl,
      state.videoPath,
      "out",
      [expect.objectContaining({ id: "one" })],
      "00:01 One",
      true,
      true,
      -1.5,
    );
  });

  it("owns background transcription polling and ignores results after cleanup", async () => {
    const transcript: Transcript = {
      segment_id: "segment-1",
      text: "partial",
      language: "en",
      chunks: [],
      backend: "test",
      device_used: "cpu",
      model_id: "test-model",
    };
    const state = options();
    let resolvePoll: ((value: { transcripts: Transcript[] }) => void) | undefined;
    let onProgress: ((job: JobRecord) => void) | undefined;
    const startTranscription = vi.fn(async () => job("manual-job", "transcription"));
    const services: CutOperationServices = {
      startAnalysis: vi.fn(async () => job("analysis-job", "analysis")),
      startTranscription,
      startExport: vi.fn(async () => job("export-job", "export")),
      waitForJob: <T,>(
        _baseUrl: string,
        _jobId: string,
        next: (job: JobRecord) => void,
      ) => {
        onProgress = next;
        return new Promise<T>((resolve) => {
          resolvePoll = resolve as (value: { transcripts: Transcript[] }) => void;
        });
      },
    };
    const coordinator = createCutOperationCoordinator(() => state, services);
    const cleanup = coordinator.watchBackgroundTranscription("background-job");

    onProgress?.(job("background-job", "transcription"));
    expect(state.updateTask).toHaveBeenCalledWith(
      "transcription",
      expect.objectContaining({ id: "background-job" }),
    );
    await coordinator.runTranscription([segment()]);
    expect(startTranscription).not.toHaveBeenCalled();
    cleanup();
    expect(state.updateTask).toHaveBeenLastCalledWith("transcription", null);
    resolvePoll?.({ transcripts: [transcript] });
    await Promise.resolve();

    expect(state.applyTranscripts).not.toHaveBeenCalled();
    expect(state.onMessage).not.toHaveBeenLastCalledWith("Transcription complete.");
  });
});

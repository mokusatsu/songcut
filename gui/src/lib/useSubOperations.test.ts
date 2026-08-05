import { describe, expect, it, vi } from "vitest";

import { DEFAULT_WHISPER_SETTINGS } from "@/lib/project";
import { createDefaultSubtitleState, type LyricsAnalysisResult } from "@/lib/subtitles";
import {
  createSubOperationCoordinator,
  type SubOperationOptions,
  type SubOperationServices,
} from "@/lib/useSubOperations";
import type { OperationRunner } from "@/lib/useOperationRunner";
import type { JobRecord } from "@/types";

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

function executingRunner(): OperationRunner {
  return {
    isRunning: () => false,
    run: async (options) => {
      const started = await options.start();
      const result = await options.poll(started.id, (nextJob) => options.onProgress?.(nextJob));
      await options.onSuccess?.(result);
      return result;
    },
  };
}

function lyricsResult(): LyricsAnalysisResult {
  return {
    title: null,
    duration: 20,
    device_used: "cpu",
    algorithm: "songcut-standard",
    whisper_text: "hello",
    tempo_bpm: 120,
    beat_times: [0, 0.5],
    rhythm_grid: [],
    beat_warning: null,
    confidence_statistics: {
      count: 1,
      minimum: 0.9,
      maximum: 0.9,
      mean: 0.9,
      median: 0.9,
      q1: 0.9,
      q3: 0.9,
      lower_outlier_bound: 0.9,
      low_outlier_indexes: [],
    },
    lines: [{
      index: 0,
      text: "hello",
      start: 1,
      end: 2,
      confidence: 0.9,
      source: "whisper",
      matched_characters: 5,
      exact_characters: 5,
      total_characters: 5,
      low_confidence_outlier: false,
    }],
    elapsed_seconds: 1,
  };
}

function options(overrides: Partial<SubOperationOptions> = {}): SubOperationOptions {
  return {
    apiBaseUrl: "http://127.0.0.1:8000",
    videoPath: "song.mp4",
    state: createDefaultSubtitleState(),
    whisperSettings: { ...DEFAULT_WHISPER_SETTINGS, enabled: true },
    operationRunner: executingRunner(),
    analysisJob: null,
    exportJob: null,
    updateTask: vi.fn(),
    setState: vi.fn(),
    markStateChanged: vi.fn(),
    focusSegment: vi.fn(),
    onMessage: vi.fn(),
    confirm: vi.fn(() => true),
    ...overrides,
  };
}

describe("Sub operation coordinator", () => {
  it("runs lyrics analysis and applies the mode-specific placement result", async () => {
    const result = lyricsResult();
    const state = options();
    const services: SubOperationServices = {
      startLyricsAnalysis: vi.fn(async () => job("lyrics-job", "lyrics-analysis")),
      startSubtitleExport: vi.fn(async () => job("export-job", "subtitle-export")),
      startSubtitleRender: vi.fn(async () => job("render-job", "subtitle-render")),
      waitForJob: async <T,>() => result as T,
    };
    const coordinator = createSubOperationCoordinator(() => state, services);

    await coordinator.analyzeLyrics("hello");

    expect(services.startLyricsAnalysis).toHaveBeenCalledWith(
      state.apiBaseUrl,
      state.videoPath,
      "hello",
      state.whisperSettings,
    );
    expect(state.setState).toHaveBeenCalledWith(expect.objectContaining({ tempo_bpm: 120 }));
    expect(state.markStateChanged).toHaveBeenCalledOnce();
    expect(state.focusSegment).toHaveBeenCalledWith(expect.objectContaining({ text: "hello" }));
  });

  it("maps subtitle export dimensions and lanes in the coordinator", async () => {
    const state = options();
    const startSubtitleExport = vi.fn(async () => job("export-job", "subtitle-export"));
    const services: SubOperationServices = {
      startLyricsAnalysis: vi.fn(async () => job("lyrics-job", "lyrics-analysis")),
      startSubtitleExport,
      startSubtitleRender: vi.fn(async () => job("render-job", "subtitle-render")),
      waitForJob: async <T,>() => ({ video: "out.mp4", output_dir: "out" }) as T,
    };
    const coordinator = createSubOperationCoordinator(() => state, services);

    await coordinator.exportSubtitles("out", 1280, 720);

    expect(startSubtitleExport).toHaveBeenCalledWith(
      state.apiBaseUrl,
      state.videoPath,
      "out",
      1280,
      720,
      state.state.lanes,
    );
  });

  it("ignores stale subtitle render results after invalidation", async () => {
    const state = options();
    let resolveRender: ((value: { items: [] }) => void) | undefined;
    const services: SubOperationServices = {
      startLyricsAnalysis: vi.fn(async () => job("lyrics-job", "lyrics-analysis")),
      startSubtitleExport: vi.fn(async () => job("export-job", "subtitle-export")),
      startSubtitleRender: vi.fn(async () => job("render-job", "subtitle-render")),
      waitForJob: <T,>() => new Promise<T>((resolve) => {
        resolveRender = resolve as (value: { items: [] }) => void;
      }),
    };
    const coordinator = createSubOperationCoordinator(() => state, services);
    const pending = coordinator.renderSubtitles({
      width: 1920,
      height: 1080,
      items: [{
        segment_id: "segment-1",
        signature: "signature",
        text: "hello",
        style: state.state.lanes[0].style,
      }],
    });

    await Promise.resolve();
    coordinator.invalidateSubtitleRender();
    resolveRender?.({ items: [] });
    await pending;

    expect(state.setState).not.toHaveBeenCalled();
    expect(state.updateTask).toHaveBeenLastCalledWith("subtitle-render", null);
  });
});

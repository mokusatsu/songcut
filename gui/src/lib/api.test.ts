import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exportSubtitleFile,
  startLyricsLineAnalysis,
  waitForJob,
  type LyricsLineAnalysisInput,
} from "@/lib/api";
import type { LyricsLane } from "@/lib/subtitles";

function response(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
    status: 200,
    statusText: "OK",
  } as Response;
}

describe("lyrics line job API", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("stops polling immediately when its AbortSignal is cancelled", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      id: "job-1",
      kind: "lyrics-line-reanalysis",
      status: "running",
      progress: 0.4,
      message: "running",
      created_at: 0,
      updated_at: 0,
    }));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const pending = waitForJob("http://api", "job-1", () => undefined, 800, controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("serializes every optimistic-concurrency guard into the start request", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      response({ id: "job-1" })
    ));
    vi.stubGlobal("fetch", fetch);
    const input: LyricsLineAnalysisInput = {
      sourcePath: "C:/song.wav",
      sourceFingerprint: { algorithm: "sha256-head-tail-1m-v1", value: "a".repeat(64) },
      line: {
        id: "line-1",
        text: "歌",
        start: 1,
        end: 2,
        confidence: 0.9,
        alignment_source: "whisper-chunk",
        display_elements: [],
        line_revision: 4,
        display_element_revision: 5,
        start_locked: true,
        end_locked: false,
        needs_reanalysis: true,
      },
      language: "ja",
      demucsDevice: "auto",
      mmsDevice: "cpu",
      expectedLineRevision: 4,
      expectedDisplayElementRevision: 5,
      projectEpoch: 6,
      reanalysisEpoch: 7,
    };
    await startLyricsLineAnalysis("http://api", input);
    const request = fetch.mock.calls[0]![1]!;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      expected_line_revision: 4,
      expected_display_element_revision: 5,
      project_epoch: 6,
      reanalysis_epoch: 7,
    });
  });

  it("serializes selected timelines and display-element timings for LRC export", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response({
      file: "C:/out/source-subtitles.lrc",
      format: "lrc",
      output_dir: "C:/out",
    }));
    vi.stubGlobal("fetch", fetch);
    const lanes = [
      {
        id: "lyrics-1",
        name: "Lyrics 1",
        style: {},
        effect: { name: "cut" },
        segments: [
          {
            id: "line-1",
            text: "歌詞",
            start: 1,
            end: 2,
            display_elements: [
              { stable_id: "element-1", text: "歌", start: 1, end: 1.4 },
              { stable_id: "element-2", text: "詞", start: 1.4, end: 2 },
            ],
          },
        ],
      },
    ] as unknown as LyricsLane[];

    await exportSubtitleFile("http://api", "C:/source.mp4", "C:/out", 1280, 720, lanes, "lrc");

    const request = fetch.mock.calls[0]![1]!;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      source_path: "C:/source.mp4",
      output_dir: "C:/out",
      format: "lrc",
      lanes: [
        {
          id: "lyrics-1",
          segments: [
            {
              id: "line-1",
              display_elements: [
                { text: "歌", start: 1, end: 1.4 },
                { text: "詞", start: 1.4, end: 2 },
              ],
            },
          ],
        },
      ],
    });
  });
});

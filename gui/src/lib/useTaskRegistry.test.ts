import { describe, expect, it } from "vitest";

import {
  selectActiveTask,
  selectBlockingTask,
  selectFailedTaskEntries,
  selectRunningTaskEntries,
} from "@/lib/useTaskRegistry";
import type { JobRecord } from "@/types";

function job(kind: string, status: JobRecord["status"]): JobRecord {
  return {
    id: `${kind}-1`,
    kind,
    status,
    progress: 0,
    message: kind,
    result: null,
    error: null,
    created_at: 1,
    updated_at: 1
  };
}

describe("task registry selectors", () => {
  it("keeps background waveform work visible without making it a quit blocker", () => {
    const waveform = job("waveform", "running");
    expect(selectActiveTask({ waveform })).toBe(waveform);
    expect(selectBlockingTask({ waveform })).toBeNull();
  });

  it("prioritizes concurrent user operations over background preparation", () => {
    const waveform = job("waveform", "running");
    const analysis = job("analysis", "running");
    const exporting = job("export", "running");
    expect(selectActiveTask({ waveform, analysis, export: exporting })).toBe(exporting);
    expect(selectBlockingTask({ waveform, analysis, export: exporting })).toBe(exporting);
  });

  it("returns every running task in display priority order", () => {
    const waveform = job("waveform", "running");
    const lyrics = job("lyrics-analysis", "running");
    const preview = job("subtitle-render", "running");

    expect(selectRunningTaskEntries({
      waveform,
      "lyrics-analysis": lyrics,
      "subtitle-render": preview,
    }).map(({ slot }) => slot)).toEqual(["lyrics-analysis", "subtitle-render", "waveform"]);
  });

  it("uses the newest terminal task instead of a stale high-priority task", () => {
    const analysis = { ...job("analysis", "completed"), updated_at: 10 };
    const exporting = { ...job("export", "completed"), updated_at: 20 };

    expect(selectActiveTask({ analysis, export: exporting })).toBe(exporting);
  });

  it("does not let background completion hide a foreground result", () => {
    const analysis = { ...job("lyrics-analysis", "completed"), updated_at: 10 };
    const preview = { ...job("subtitle-render", "completed"), updated_at: 20 };

    expect(selectActiveTask({ "lyrics-analysis": analysis, "subtitle-render": preview })).toBe(analysis);
  });

  it("keeps failed and cancelled tasks available for explicit dismissal", () => {
    const failed = { ...job("subtitle-render", "failed"), updated_at: 20 };
    const cancelled = { ...job("waveform", "cancelled"), updated_at: 10 };

    expect(selectFailedTaskEntries({
      "subtitle-render": failed,
      waveform: cancelled,
    }).map(({ job: item }) => item)).toEqual([failed, cancelled]);
  });

  it("treats the MMS model download as a foreground quit blocker", () => {
    const mms = job("download-mms", "running");
    expect(selectActiveTask({ "download-mms": mms })).toBe(mms);
    expect(selectBlockingTask({ "download-mms": mms })).toBe(mms);
  });
});

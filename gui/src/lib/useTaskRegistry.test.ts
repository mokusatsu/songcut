import { describe, expect, it } from "vitest";

import { selectActiveTask, selectBlockingTask } from "@/lib/useTaskRegistry";
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
});

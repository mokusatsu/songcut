import { describe, expect, it, vi } from "vitest";

import { createModeSession } from "@/lib/modeSession";
import { type ModeMediaViewModel } from "@/lib/modeViewModel";
import type { ModeControllerCapabilities } from "@/lib/modeController";

const capabilities: ModeControllerCapabilities = {
  hasSegments: true,
  hasSelectedSegment: true,
  hasMultipleSegments: true,
  canAddSegment: true,
  canDeleteSelectedSegment: true,
  canSelectPreviousSegment: true,
  canSelectNextSegment: true,
  canJumpBoundary: true,
  canPlayBoundary: true,
  canNudgeBoundary: true,
};

const media = (): ModeMediaViewModel => ({
  sourceAvailable: true,
  videoInfo: null,
  waveform: [],
  progressiveWaveformChunks: [],
  waveformPhase: "idle",
  waveformProgress: 0,
  waveformDisplayMode: "rms",
  duration: 0,
  currentTime: 0,
  playing: false,
  zoom: 1,
  focusRequest: 0,
  editing: false,
  onSeek: vi.fn(),
  onScrub: vi.fn(),
  onSeekingChange: vi.fn(),
  onHandleEditingChange: vi.fn(),
});
const transport = {
  saveStatus: "Saved",
  boundaryPreview: {
    disabled: true,
    value: "1",
    onChange: vi.fn(),
    onBlur: vi.fn(),
    onStart: vi.fn(),
    onEnd: vi.fn(),
  },
  boundaryNudge: {
    kind: "rhythm-grid" as const,
    disabled: true,
    onLeft: vi.fn(),
    onRight: vi.fn(),
  },
  playback: {
    onStart: vi.fn(),
    onPrevious: vi.fn(),
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onNext: vi.fn(),
  },
  zoom: {
    value: 1,
    onIn: vi.fn(),
    onOut: vi.fn(),
    onReset: vi.fn(),
  },
};

describe("mode session", () => {
  it("provides Cut and Sub with the same controller/operation/view boundary", () => {
    const cutSelect = vi.fn();
    const subSelect = vi.fn();
    const cutOperations = { runAnalysis: vi.fn() };
    const subOperations = { analyzeLyrics: vi.fn() };
    const cut = createModeSession({
      mode: "cut",
      capabilities,
      actions: { select: cutSelect },
      operations: cutOperations,
      media: media(),
      transport,
    });
    const sub = createModeSession<{ id: string }, string, typeof subOperations>({
      mode: "sub",
      capabilities,
      actions: { select: subSelect },
      operations: subOperations,
      media: media(),
      transport,
    });

    cut.controller.actions.select({ id: "cut" });
    sub.controller.actions.select({ id: "sub" }, "lane-1");

    expect(cut.mode).toBe("cut");
    expect(sub.mode).toBe("sub");
    expect(cut.operations).toBe(cutOperations);
    expect(sub.operations).toBe(subOperations);
    expect(cut.view.transport).toBe(transport);
    expect(sub.view.transport).toBe(transport);
    expect(cutSelect).toHaveBeenCalledWith({ id: "cut" });
    expect(subSelect).toHaveBeenCalledWith({ id: "sub" }, "lane-1");
  });

  it("retains controller capability guards at the session boundary", () => {
    const add = vi.fn();
    const session = createModeSession({
      mode: "cut",
      capabilities: { ...capabilities, canAddSegment: false },
      actions: { add },
      operations: null,
      media: media(),
      transport,
    });

    session.controller.actions.add();

    expect(add).not.toHaveBeenCalled();
    expect(session.controller.capabilities.canAddSegment).toBe(false);
  });
});

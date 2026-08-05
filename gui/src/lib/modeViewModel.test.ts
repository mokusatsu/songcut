import { describe, expect, it, vi } from "vitest";

import { createModePanelViewModel, type ModeMediaViewModel } from "@/lib/modeViewModel";

function media(): ModeMediaViewModel {
  return {
    sourceAvailable: true,
    videoInfo: null,
    waveform: [],
    progressiveWaveformChunks: [],
    waveformPhase: "ready",
    waveformProgress: 1,
    waveformDisplayMode: "rms",
    duration: 10,
    currentTime: 2,
    playing: false,
    zoom: 1,
    focusRequest: 0,
    editing: false,
    onSeek: vi.fn(),
    onScrub: vi.fn(),
    onSeekingChange: vi.fn(),
    onHandleEditingChange: vi.fn(),
  };
}

function transport() {
  return {
    saveStatus: "Saved",
    boundaryPreview: {
      disabled: false,
      value: "1",
      onChange: vi.fn(),
      onBlur: vi.fn(),
      onStart: vi.fn(),
      onEnd: vi.fn(),
    },
    boundaryNudge: {
      kind: "seconds" as const,
      disabled: false,
      value: "0.1",
      onChange: vi.fn(),
      onBlur: vi.fn(),
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
}

describe("mode panel view model", () => {
  it("keeps common media and transport in one typed boundary", () => {
    const commonMedia = media();
    const commonTransport = transport();
    const view = createModePanelViewModel(commonMedia, commonTransport);

    expect(view.media).toBe(commonMedia);
    expect(view.transport).toBe(commonTransport);
    view.media.onSeek(3);
    view.transport.playback.onPlay();
    expect(commonMedia.onSeek).toHaveBeenCalledWith(3);
    expect(commonTransport.playback.onPlay).toHaveBeenCalledOnce();
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DisplayElementZoomContent,
  clampDisplayElementZoomTime,
  displayElementZoomPlayheadPercent,
  displayElementZoomRange,
  displayElementZoomTimeFromClientX,
  shouldToggleDisplayElementZoomPlaybackKey,
  type DisplayElementZoomLabels,
} from "@/components/DisplayElementZoomDialog";
import type { DisplayElementInspectorLabels } from "@/components/DisplayElementInspector";
import type { DisplayElement, LyricsSegment } from "@/lib/subtitles";

const labels: DisplayElementZoomLabels = {
  title: "Zoom display elements",
  rangeStart: "Range start",
  play: "Play",
  pause: "Pause",
  loopPlayback: "Loop playback",
  waveform: "Waveform",
  waveformUnavailable: "Waveform unavailable",
  playbackUnavailable: "Playback unavailable",
  currentTime: "Current",
  endTime: "End",
};
const inspectorLabels: DisplayElementInspectorLabels = {
  empty: "No elements",
  blank: "Blank",
  zoomEdit: "Zoom",
  zoomDisabled: "No elements",
  lockBoundaries: "Lock boundaries",
  unlockBoundaries: "Unlock boundaries",
  mergeRight: "Merge",
  mergeDisabled: "Cannot merge",
  addBlankLeft: "Add blank left",
  addBlankRight: "Add blank",
  addBlankDisabled: "Cannot add blank",
  deleteElement: "Delete element",
  deleteDisabled: "Cannot delete element",
  deleteConfirm: "Delete text element?",
  editText: "Edit element text",
  timeline: "Element timeline",
  list: "Element list",
  boundary: "Boundary",
};

function element(id: string, start: number, end: number): DisplayElement {
  return {
    stable_id: id,
    text: id,
    start,
    end,
    confidence: 1,
    source: "mms-ctc",
    source_start: 0,
    source_end: 1,
    pronunciation: id,
    token_start: 0,
    token_end: 1,
    origin_key: id,
    manual_start: false,
    manual_end: false,
    manual_structure: false,
    parent_revision: 1,
    conflict: null,
    orphaned_manual: false,
  };
}

const segment: LyricsSegment = {
  id: "line",
  text: "AB",
  start: 10,
  end: 12,
  confidence: 1,
  source: "lyrics",
  low_confidence_outlier: false,
  user_edited: false,
  display_element_revision: 1,
  display_elements: [element("A", 10, 11), element("B", 11, 12)],
};

describe("DisplayElementZoomContent", () => {
  it("renders range transport, cropped waveform, playhead, loop, and the shared element editor", () => {
    const markup = renderToStaticMarkup(
      <DisplayElementZoomContent
        segment={segment}
        mediaDuration={30}
        currentTime={10.5}
        playing={false}
        loop={false}
        canPlayback
        waveform={[
          { t: 9.5, min: -0.1, max: 0.1, rms: 0.05, sample_count: 1 },
          { t: 10.5, min: -0.2, max: 0.2, rms: 0.1, sample_count: 1 },
          { t: 11.5, min: -0.3, max: 0.3, rms: 0.15, sample_count: 1 },
          { t: 12.5, min: -0.1, max: 0.1, rms: 0.05, sample_count: 1 },
        ]}
        waveformDisplayMode="peak-rms"
        labels={labels}
        inspectorLabels={inspectorLabels}
        onPlayPause={() => undefined}
        onSeek={() => undefined}
        onLoopChange={() => undefined}
        onPreview={() => undefined}
        onCancel={() => undefined}
        onCommit={() => undefined}
        onBoundaryLockChange={() => undefined}
      />,
    );

    expect(markup).toContain("role=\"slider\"");
    expect(markup).toContain("aria-valuenow=\"2.5\"");
    expect(markup).toContain("Loop playback");
    expect(markup).toContain("waveform-path-peak");
    expect(markup).toContain("display-element-playhead");
    expect(markup).toContain("display-element-zoom-waveform-stage");
    expect(markup).toContain("--display-element-zoom-playhead-percent:41.66666666666667%");
    expect(markup).toContain("class=\"display-element-zoom-content\"");
    expect(markup).toContain("tabindex=\"0\"");
    expect(markup).toContain("Element list");
    expect(markup).toContain("aria-label=\"Lock boundaries\"");
    expect(markup).not.toContain("aria-label=\"Zoom\"");
  });

  it("keeps display element editing available when waveform data is absent", () => {
    const markup = renderToStaticMarkup(
      <DisplayElementZoomContent
        segment={segment}
        mediaDuration={30}
        currentTime={10}
        playing={false}
        loop
        canPlayback={false}
        waveform={[]}
        waveformDisplayMode="rms"
        labels={labels}
        inspectorLabels={inspectorLabels}
        onPlayPause={() => undefined}
        onSeek={() => undefined}
        onLoopChange={() => undefined}
        onPreview={() => undefined}
        onCancel={() => undefined}
        onCommit={() => undefined}
        onBoundaryLockChange={() => undefined}
      />,
    );
    expect(markup).toContain("Waveform unavailable");
    expect(markup).toContain("Element timeline");
    expect(markup).toContain("title=\"Playback unavailable\"");
  });
});

describe("display element zoom range helpers", () => {
  it("adds two seconds on both sides and clamps seeks to the padded media range", () => {
    const range = displayElementZoomRange(segment, 30);
    expect(range).toEqual({ start: 8, end: 14 });
    expect(displayElementZoomRange({ start: 0.5, end: 2 }, 30)).toEqual({ start: 0, end: 4 });
    expect(displayElementZoomRange({ start: 28, end: 29.5 }, 30)).toEqual({ start: 26, end: 30 });
    expect(clampDisplayElementZoomTime(range, 7)).toBe(8);
    expect(clampDisplayElementZoomTime(range, 15)).toBe(14);
    expect(displayElementZoomTimeFromClientX(range, 50, 0, 100)).toBe(11);
    expect(displayElementZoomTimeFromClientX(range, -50, 0, 100)).toBe(8);
    expect(displayElementZoomTimeFromClientX(range, 150, 0, 100)).toBe(14);
    expect(displayElementZoomPlayheadPercent(range, 10.5)).toBeCloseTo(41.6666667);
    expect(displayElementZoomPlayheadPercent(range, 20)).toBe(100);
  });

  it("accepts Space only outside controls and IME composition", () => {
    class TestElement {
      constructor(private readonly interactive: boolean) {}
      closest() {
        return this.interactive ? this : null;
      }
    }
    expect(shouldToggleDisplayElementZoomPlaybackKey({
      key: " ", isComposing: false, keyCode: 32, defaultPrevented: false, target: new TestElement(false) as never,
    })).toBe(true);
    expect(shouldToggleDisplayElementZoomPlaybackKey({
      key: " ", isComposing: false, keyCode: 32, defaultPrevented: false, target: new TestElement(true) as never,
    })).toBe(false);
    expect(shouldToggleDisplayElementZoomPlaybackKey({
      key: " ", isComposing: true, keyCode: 229, defaultPrevented: false, target: new TestElement(false) as never,
    })).toBe(false);
    expect(shouldToggleDisplayElementZoomPlaybackKey({
      key: " ", isComposing: false, keyCode: 32, defaultPrevented: true, target: new TestElement(false) as never,
    })).toBe(false);
  });
});

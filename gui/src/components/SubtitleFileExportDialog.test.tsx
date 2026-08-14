import { describe, expect, it } from "vitest";
import {
  canExportSubtitleFile,
  initialSubtitleFileExportLaneIds,
  subtitleFileExportableLanes,
} from "@/components/SubtitleFileExportDialog";

const lanes = [
  { id: "lyrics-1", name: "Lyrics 1", segments: [{ id: "line-1" }] },
  { id: "lyrics-2", name: "Lyrics 2", segments: [] },
  { id: "lyrics-3", name: "Lyrics 3", segments: [{ id: "line-3" }] },
] as const;

describe("SubtitleFileExportDialog selection", () => {
  it("offers only timelines containing subtitles and selects all of them initially", () => {
    expect(subtitleFileExportableLanes(lanes).map((lane) => lane.id)).toEqual(["lyrics-1", "lyrics-3"]);
    expect(initialSubtitleFileExportLaneIds(lanes)).toEqual(["lyrics-1", "lyrics-3"]);
  });

  it("requires at least one selected timeline before enabling export", () => {
    expect(canExportSubtitleFile(new Set())).toBe(false);
    expect(canExportSubtitleFile(new Set(["lyrics-1"]))).toBe(true);
  });
});

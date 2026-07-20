import { describe, expect, it } from "vitest";
import { buildTimestampExportText } from "./timestampExport";

const items = [
  { id: "one", segmentId: "segment-one", title: "Opening", start: 0, end: 65.4 },
  { id: "two", segmentId: "segment-two", title: "Second\tSong", start: 65.4, end: 3723.6 },
];

describe("timestamp export", () => {
  it("does not emit a header when there are no selected items", () => {
    expect(buildTimestampExportText([], "tsv-excel")).toBe("");
    expect(buildTimestampExportText([], "csv")).toBe("");
  });

  it("builds timestamp comments with start and end timecodes", () => {
    expect(buildTimestampExportText(items, "timestamp-comment")).toBe(
      "0:00 - 1:05 Opening\n1:05 - 1:02:04 Second\tSong",
    );
  });

  it("builds YouTube chapters from start timecodes", () => {
    expect(buildTimestampExportText(items, "youtube-chapter")).toBe("0:00 Opening\n1:05 Second\tSong");
  });

  it("builds spreadsheet-friendly tab-separated rows with a header", () => {
    expect(buildTimestampExportText(items, "tsv-excel")).toBe(
      "Start\tEnd\tTitle\n0:00\t1:05\tOpening\n1:05\t1:02:04\tSecond Song",
    );
  });

  it("builds comma-separated rows with a header and CSV escaping", () => {
    const csvItems = [
      items[0],
      { ...items[1], title: 'Second, "Special" Song' },
    ];
    expect(buildTimestampExportText(csvItems, "csv")).toBe(
      'Start,End,Title\n0:00,1:05,Opening\n1:05,1:02:04,"Second, ""Special"" Song"',
    );
  });

  it("builds Audacity labels with seconds to millisecond precision", () => {
    expect(buildTimestampExportText(items, "audacity-label")).toBe(
      "0.000\t65.400\tOpening\n65.400\t3723.600\tSecond Song",
    );
  });
});

import { formatTime } from "./time";

export const timestampExportFormats = ["timestamp-comment", "youtube-chapter", "tsv-excel", "csv", "audacity-label"] as const;

export type TimestampExportFormat = (typeof timestampExportFormats)[number];

export type TimestampExportItem = {
  id: string;
  segmentId: string;
  title: string;
  start: number;
  end: number;
};

export function buildTimestampExportText(items: readonly TimestampExportItem[], format: TimestampExportFormat) {
  if (items.length === 0) return "";
  const rows = items.map((item) => formatTimestampExportItem(item, format));
  if (format === "tsv-excel") return ["Start\tEnd\tTitle", ...rows].join("\n");
  if (format === "csv") return ["Start,End,Title", ...rows].join("\n");
  return rows.join("\n");
}

function formatTimestampExportItem(item: TimestampExportItem, format: TimestampExportFormat) {
  const title = normalizedTitle(item);
  switch (format) {
    case "timestamp-comment":
      return `${formatTime(item.start)} - ${formatTime(item.end)} ${title}`;
    case "youtube-chapter":
      return `${formatTime(item.start)} ${title}`;
    case "tsv-excel":
      return `${formatTime(item.start)}\t${formatTime(item.end)}\t${singleLine(title)}`;
    case "csv":
      return [formatTime(item.start), formatTime(item.end), title].map(csvCell).join(",");
    case "audacity-label":
      return `${formatAudacitySeconds(item.start)}\t${formatAudacitySeconds(item.end)}\t${singleLine(title)}`;
  }
}

function normalizedTitle(item: TimestampExportItem) {
  return item.title.trim() || item.segmentId || item.id;
}

function singleLine(value: string) {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function formatAudacitySeconds(value: number) {
  return Math.max(0, value).toFixed(3);
}

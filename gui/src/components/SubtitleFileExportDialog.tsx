import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { tr } from "@/i18n";
import type { SubtitleFileExportFormat } from "@/lib/subtitleFileExport";
export type SubtitleFileExportLane = Readonly<{
  id: string;
  name: string;
  segments: readonly unknown[];
}>;

const FORMAT_OPTIONS: readonly SubtitleFileExportFormat[] = ["srt", "lrc", "ass"];

/** 字幕を持つTimelineだけを統合字幕ファイルの対象候補にする。 */
export function subtitleFileExportableLanes(lanes: readonly SubtitleFileExportLane[]) {
  return lanes.filter((lane) => lane.segments.length > 0);
}

/** Dialogを開いた時の初期選択は、字幕を持つ全Timelineとする。 */
export function initialSubtitleFileExportLaneIds(lanes: readonly SubtitleFileExportLane[]) {
  return subtitleFileExportableLanes(lanes).map((lane) => lane.id);
}

/** 少なくとも一つのTimelineを選択した場合だけ書き出しを許可する。 */
export function canExportSubtitleFile(laneIds: ReadonlySet<string>) {
  return laneIds.size > 0;
}

type SubtitleFileExportDialogProps = {
  open: boolean;
  lanes: readonly SubtitleFileExportLane[];
  disabled?: boolean;
  onClose: () => void;
  onExport: (format: SubtitleFileExportFormat, laneIds: readonly string[]) => Promise<boolean>;
};

/** `SubtitleFileExportDialog`の画面要素を描画し、形式とTimeline選択を親へ通知する。 */
export function SubtitleFileExportDialog({
  open,
  lanes,
  disabled = false,
  onClose,
  onExport,
}: SubtitleFileExportDialogProps) {
  const exportableLanes = useMemo(() => subtitleFileExportableLanes(lanes), [lanes]);
  const laneKey = exportableLanes.map((lane) => lane.id).join("\u0000");
  const [format, setFormat] = useState<SubtitleFileExportFormat>("srt");
  const [selectedLaneIds, setSelectedLaneIds] = useState<ReadonlySet<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const canExport = !disabled && !submitting && canExportSubtitleFile(selectedLaneIds);

  useEffect(() => {
    if (!open) {
      setSubmitting(false);
      return;
    }
    setFormat("srt");
    setSelectedLaneIds(new Set(initialSubtitleFileExportLaneIds(exportableLanes)));
  }, [open, laneKey]);

  function toggleLane(laneId: string, checked: boolean) {
    setSelectedLaneIds((current) => {
      const next = new Set(current);
      if (checked) next.add(laneId);
      else next.delete(laneId);
      return next;
    });
  }

  async function submit() {
    if (!canExport) return;
    setSubmitting(true);
    try {
      if (await onExport(format, [...selectedLaneIds])) onClose();
    } finally {
      setSubmitting(false);
    }
  }

  const selectionErrorId = "subtitle-file-export-selection-error";
  const selectionError = !canExportSubtitleFile(selectedLaneIds);

  return (
    <Dialog open={open} title={tr("sub.subtitleFileExportTitle")} onClose={onClose} className="subtitle-file-export-dialog">
      <form
        className="subtitle-file-export-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset className="subtitle-file-export-section">
          <legend>{tr("sub.subtitleFileFormat")}</legend>
          <div className="subtitle-file-export-options">
            {FORMAT_OPTIONS.map((option) => (
              <label key={option} className="subtitle-file-export-option">
                <input
                  type="radio"
                  name="subtitle-file-export-format"
                  value={option}
                  checked={format === option}
                  onChange={() => setFormat(option)}
                  disabled={disabled || submitting}
                />
                <span>{tr(`sub.subtitleFileFormat${option[0].toUpperCase()}${option.slice(1)}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="subtitle-file-export-section">
          <legend>{tr("sub.subtitleFileTimelines")}</legend>
          <div className="subtitle-file-export-options subtitle-file-export-timelines">
            {exportableLanes.map((lane) => (
              <label key={lane.id} className="subtitle-file-export-option">
                <Checkbox
                  checked={selectedLaneIds.has(lane.id)}
                  onChange={(event) => toggleLane(lane.id, event.target.checked)}
                  disabled={disabled || submitting}
                  aria-describedby={selectionError ? selectionErrorId : undefined}
                />
                <span>{lane.name || lane.id}</span>
              </label>
            ))}
          </div>
          {selectionError ? (
            <p id={selectionErrorId} className="subtitle-file-export-error" role="status">
              {tr("sub.subtitleFileNoTimeline")}
            </p>
          ) : null}
        </fieldset>
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {tr("sub.cancel")}
          </Button>
          <Button type="submit" disabled={!canExport}>
            {submitting ? tr("sub.subtitleFileExporting") : tr("sub.subtitleFileExportAction")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

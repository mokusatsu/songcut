import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  FileOutput,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToolbar } from "@/components/ModeToolbar";
import { SubTimelineEditor } from "@/components/SubTimelineEditor";
import { AlignmentGrid, SubtitleStyleEditor } from "@/components/SubtitleStyleEditor";
import { Dialog } from "@/components/ui/dialog";
import { JobProgressDialog } from "@/components/JobProgressDialog";
import { SubtitleFileExportDialog } from "@/components/SubtitleFileExportDialog";
import type { TaskStatusMetaItem } from "@/components/ProjectInformation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { tr } from "@/i18n";
import {
  normalizeSubtitleEffect,
  type SubtitleEffectCatalog,
} from "@/lib/subtitleEffects";
import {
  useSubtitleEffectCatalogContext,
  type SubtitleEffectCatalogState,
} from "@/lib/subtitleEffectCatalog";
import {
  activeSegmentsAt,
  createLyricsLane,
  resolveSubtitleSegmentStyle,
  selectedSubtitleSegment,
  subtitleRenderSignature,
  type LyricsLane,
  type LyricsSegment,
  type SubtitleProjectState,
  type SubtitleRenderRequest,
} from "@/lib/subtitles";
import type { ModePanelViewModel } from "@/lib/modeViewModel";
import type { SegmentSelectionModifiers } from "@/lib/segmentSelection";
import type { JobRecord } from "@/types";
import type { SubtitleFileExportFormat } from "@/lib/subtitleFileExport";

type SubModePanelOperationView = {
  analysisJob: JobRecord | null;
  exportJob: JobRecord | null;
  busy: "analysis" | "export" | null;
};

type SubModePanelCapabilities = {
  canAddSegment: boolean;
  canDeleteSelectedSegment: boolean;
};

type SubModePanelActions = {
  load: () => void;
  openSettings: () => void;
  prepareAnalysis: () => Promise<void>;
  analyzeLyrics: (lyricsText: string) => Promise<void>;
  exportSubtitles: () => Promise<boolean>;
  exportSubtitleFile: (format: SubtitleFileExportFormat, laneIds: readonly string[]) => Promise<boolean>;
  renderSubtitles: (request: SubtitleRenderRequest) => Promise<void>;
  invalidateSubtitleRender: () => void;
  listSystemFonts: () => Promise<string[]>;
  confirmRemoveLane: (lane: LyricsLane) => boolean;
  selectSegment: (
    laneId: string,
    segment: LyricsSegment,
    modifiers: SegmentSelectionModifiers,
  ) => void;
  addSegment: () => void;
  removeSelectedSegment: () => void;
  showMessage: (message: string) => void;
};

export type SubModePanelProps = {
  view: ModePanelViewModel;
  state: SubtitleProjectState;
  selectedSegmentIds: ReadonlySet<string>;
  capabilities: SubModePanelCapabilities;
  operation: SubModePanelOperationView;
  actions: SubModePanelActions;
  renderTaskStatus: (modeMeta?: TaskStatusMetaItem[]) => React.ReactNode;
  onStateChange: (state: SubtitleProjectState) => void;
  /** Functional boundary preview keeps rapid moves based on the latest draft. */
  onBoundaryPreview: (
    laneId: string,
    segmentId: string,
    edge: "start" | "end",
    time: number,
  ) => void;
  onBoundaryCancel: (
    laneId: string,
    segmentId: string,
    segment: LyricsSegment,
  ) => void;
  onBoundaryEditingEnter: (laneId: string, segmentId: string) => void;
  /** Called once when a boundary drag is released. */
  onBoundaryCommit: (laneId: string, segmentId: string, startSegment: LyricsSegment) => void;
  onTextEditingEnter: (laneId: string, segmentId: string) => void;
  onTextCommit: (laneId: string, segmentId: string, originalText: string, text: string) => void;
  onTextEditingExitWithoutChange: (laneId: string, segmentId: string) => void;
};

/** `SubModePanel`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function SubModePanel(props: SubModePanelProps) {
  const catalogState = useSubtitleEffectCatalogContext();
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsText, setLyricsText] = useState("");
  const [laneDialogOpen, setLaneDialogOpen] = useState(false);
  const [styleLaneId, setStyleLaneId] = useState<string | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [preparingModel, setPreparingModel] = useState(false);
  const [analysisProgressOpen, setAnalysisProgressOpen] = useState(false);
  const [exportProgressOpen, setExportProgressOpen] = useState(false);
  const [subtitleFileExportOpen, setSubtitleFileExportOpen] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null);
  const [fontListError, setFontListError] = useState<string | null>(null);
  const busy = props.operation.busy;
  const media = props.view.media;
  const selected = props.selectedSegmentIds.size === 1 ? selectedSubtitleSegment(props.state) : null;
  const styleLane = props.state.lanes.find((lane) => lane.id === styleLaneId) ?? null;
  const canAddSegment = props.capabilities.canAddSegment;
  const catalogEffectError = useMemo(
    () => catalogState.catalog ? findSubtitleEffectError(props.state, catalogState.catalog) : null,
    [catalogState.catalog, props.state],
  );
  const renderPlan = useMemo(() => {
    const catalog = catalogState.catalog;
    if (!catalog) return [];
    const width = media.videoInfo?.video.width || 1920;
    const height = media.videoInfo?.video.height || 1080;
    return props.state.lanes.flatMap((lane) =>
      lane.segments.flatMap((segment) => {
        const resolved = tryResolveSubtitleSegmentStyle(lane, segment, catalog);
        if (!resolved) return [];
        const style = resolved.style;
        return {
          segment,
          style,
          signature: subtitleRenderSignature(segment.text, style, width, height),
        };
      })
    );
  }, [catalogState.catalog, props.state.lanes, media.videoInfo?.video.width, media.videoInfo?.video.height]);
  const renderPlanKey = renderPlan
    .map(({ segment, signature }) => `${segment.id}\u0000${signature}\u0000${segment.render_cache?.signature ?? ""}`)
    .join("\u0001");

  useEffect(() => {
    if (!media.videoInfo) return;
    const missing = renderPlan.filter(
      ({ segment, signature }) => segment.render_cache?.signature !== signature
    );
    if (!missing.length) return;
    const timer = window.setTimeout(() => {
      const width = media.videoInfo?.video.width || 1920;
      const height = media.videoInfo?.video.height || 1080;
      void props.actions.renderSubtitles({
        width,
        height,
        items: missing.map(({ segment, style, signature }) => ({
          segment_id: segment.id,
          signature,
          text: segment.text,
          style,
        })),
      });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      props.actions.invalidateSubtitleRender();
    };
  }, [media.videoInfo, props.actions.renderSubtitles, props.actions.invalidateSubtitleRender, renderPlanKey]);

  useEffect(() => {
    if (!styleLane || systemFonts || fontListError) return;
    let cancelled = false;
    props.actions.listSystemFonts()
      .then((fonts) => {
        if (!cancelled) setSystemFonts(fonts);
      })
      .catch((error) => {
        if (!cancelled) setFontListError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [styleLane, systemFonts, fontListError, props.actions.listSystemFonts]);

  /** `analyzeLyrics`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function analyzeLyrics() {
    if (!lyricsText.trim()) return;
    setLyricsOpen(false);
    setAnalysisProgressOpen(true);
    await props.actions.analyzeLyrics(lyricsText);
  }

  /** `openLyricsDialog`の対象を利用可能にし、画面表示に必要な状態を同期する。 */
  async function openLyricsDialog() {
    setPreparingModel(true);
    try {
      await props.actions.prepareAnalysis();
      setLyricsOpen(true);
    } catch (error) {
      props.actions.showMessage(tr("sub.modelDownloadFailed", { detail: String(error) }));
    } finally {
      setPreparingModel(false);
    }
  }

  /** `exportSubtitles`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function exportSubtitles() {
    if (await props.actions.exportSubtitles()) setExportProgressOpen(true);
  }

  /** `addLane`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
  function addLane(alignment: number) {
    if (props.state.lanes.length >= 3) return;
    const lane = createLyricsLane(alignment, `Lyrics ${props.state.lanes.length + 1}`);
    props.onStateChange({
      ...props.state,
      lanes: [...props.state.lanes, lane],
      active_lane_id: lane.id,
      selected_segment_id: null,
    });
    setLaneDialogOpen(false);
  }

  /** `removeLane`の対象を取り除き、関連する一時状態やresourceを後始末する。 */
  function removeLane(laneId: string) {
    if (props.state.lanes.length <= 1) return;
    const lane = props.state.lanes.find((item) => item.id === laneId);
    if (lane?.segments.length && !props.actions.confirmRemoveLane(lane)) return;
    const lanes = props.state.lanes.filter((item) => item.id !== laneId);
    props.onStateChange({
      ...props.state,
      lanes,
      active_lane_id: props.state.active_lane_id === laneId ? lanes[0].id : props.state.active_lane_id,
      selected_segment_id:
        lane?.segments.some((segment) => segment.id === props.state.selected_segment_id)
          ? null
          : props.state.selected_segment_id,
    });
  }

  /** `updateLane`で指定された変更を不変更新として状態へ反映する。 */
  function updateLane(laneId: string, lane: LyricsLane, selectedId = props.state.selected_segment_id) {
    props.onStateChange({
      ...props.state,
      lanes: props.state.lanes.map((item) => (item.id === laneId ? lane : item)),
      active_lane_id: laneId,
      selected_segment_id: selectedId,
    });
  }

  /** Timeline名だけを変更し、選択中laneやsegmentは維持する。 */
  function renameLane(laneId: string, nextName: string) {
    const name = nextName.trim();
    const lane = props.state.lanes.find((item) => item.id === laneId);
    if (!lane || !name || lane.name === name) return;
    props.onStateChange({
      ...props.state,
      lanes: props.state.lanes.map((item) => item.id === laneId ? { ...item, name } : item),
    });
  }

  const statusMeta: TaskStatusMetaItem[] = [
    {
      key: "effects",
      label: tr("status.effects"),
      value: catalogEffectError ? (
        <span role="alert" className="warning-text">{tr("sub.effectCatalogInvalid", { error: catalogEffectError })}</span>
      ) : (
        <SubtitleEffectCatalogStatus state={catalogState} />
      ),
    },
    ...(props.state.tempo_bpm > 0 ? [{ key: "bpm", label: tr("status.bpm"), value: props.state.tempo_bpm.toFixed(1) }] : []),
    ...(props.state.confidence_statistics ? [{
      key: "confidence",
      label: tr("status.confidence"),
      value: tr("status.confidenceValue", {
        mean: props.state.confidence_statistics.mean.toFixed(2),
        median: props.state.confidence_statistics.median.toFixed(2),
        outliers: props.state.confidence_statistics.low_outlier_indexes.length,
      }),
    }] : []),
    ...(props.state.beat_warning ? [{ key: "beat-warning", label: tr("status.beat"), value: props.state.beat_warning, className: "warning-text" }] : []),
  ];

  return (
    <>
      <ModeToolbar
        className="sub-toolbar"
        transport={props.view.transport}
        information={props.renderTaskStatus(statusMeta)}
        load={{ onClick: props.actions.load }}
        analyze={{
          onClick: () => void openLyricsDialog(),
          disabled: !media.sourceAvailable || Boolean(busy) || preparingModel,
        }}
        exportAction={{
          onClick: () => void exportSubtitles(),
          disabled: !media.sourceAvailable || !hasSubtitleSegments(props.state) || Boolean(busy),
          icon: <Save size={16} />,
        }}
        settings={{ onClick: props.actions.openSettings }}
      >
        <Button
          variant="secondary"
          onClick={() => setSubtitleFileExportOpen(true)}
          disabled={!media.sourceAvailable || !hasSubtitleSegments(props.state) || Boolean(busy)}
        >
          <FileOutput size={16} />
          {tr("sub.subtitleFileExport")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setLaneDialogOpen(true)}
          disabled={props.state.lanes.length >= 3 || Boolean(busy)}
        >
          <Plus size={16} />
          {tr("sub.timeline")}
        </Button>
        <Button variant="secondary" onClick={props.actions.addSegment} disabled={!canAddSegment || Boolean(busy)}>
          <Plus size={16} />
          {tr("sub.segment")}
        </Button>
        <Button
          variant="secondary"
          onClick={props.actions.removeSelectedSegment}
          disabled={!props.capabilities.canDeleteSelectedSegment || Boolean(busy)}
        >
          <Trash2 size={16} />
        </Button>
      </ModeToolbar>
      <SubTimelineEditor
        {...media}
        state={props.state}
        selectedSegment={selected?.segment ?? null}
        selectedSegmentIds={props.selectedSegmentIds}
        editingSegmentId={editingSegmentId}
        onEditingSegmentId={setEditingSegmentId}
        onStateChange={props.onStateChange}
        onBoundaryPreview={props.onBoundaryPreview}
        onBoundaryCancel={props.onBoundaryCancel}
        onBoundaryEditingEnter={props.onBoundaryEditingEnter}
        onBoundaryCommit={props.onBoundaryCommit}
        onTextEditingEnter={props.onTextEditingEnter}
        onTextCommit={props.onTextCommit}
        onTextEditingExitWithoutChange={props.onTextEditingExitWithoutChange}
        onStyle={(laneId) => setStyleLaneId(laneId)}
        onRenameLane={renameLane}
        onRemoveLane={removeLane}
        onSelectSegment={props.actions.selectSegment}
      />
      <Dialog open={lyricsOpen} title={tr("sub.lyricsPasteTitle")} onClose={() => setLyricsOpen(false)}>
        <Textarea
          value={lyricsText}
          onChange={(event) => setLyricsText(event.target.value)}
          placeholder={tr("sub.lyricsPlaceholder")}
          className="lyrics-input"
        />
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setLyricsOpen(false)}>{tr("sub.cancel")}</Button>
          <Button onClick={() => void analyzeLyrics()} disabled={!lyricsText.trim() || Boolean(busy)}>{tr("sub.analyzeAction")}</Button>
        </div>
      </Dialog>
      <SubtitleFileExportDialog
        open={subtitleFileExportOpen}
        lanes={props.state.lanes}
        disabled={!media.sourceAvailable || Boolean(busy)}
        onClose={() => setSubtitleFileExportOpen(false)}
        onExport={props.actions.exportSubtitleFile}
      />
      <JobProgressDialog
        open={analysisProgressOpen}
        title={tr("sub.lyricsAnalyzeTitle")}
        job={props.operation.analysisJob}
        pendingMessage={tr("sub.lyricsAnalysisPreparing")}
        onClose={() => setAnalysisProgressOpen(false)}
        className="job-progress-dialog"
        bodyClassName="analysis-progress"
        closeAction={{ statuses: "always", activeLabel: tr("sub.closeHidden"), terminalLabel: tr("sub.closeTerminal") }}
      />
      <JobProgressDialog
        open={exportProgressOpen}
        title={tr("sub.subtitleExportTitle")}
        job={props.operation.exportJob}
        pendingMessage={tr("sub.subtitleExportPreparing")}
        onClose={() => setExportProgressOpen(false)}
        className="job-progress-dialog"
        bodyClassName="analysis-progress"
        closeAction={{ statuses: "always", activeLabel: tr("sub.closeHidden"), terminalLabel: tr("sub.closeTerminal") }}
      />
      <Dialog open={laneDialogOpen} title={tr("sub.subtitlePositionTitle")} onClose={() => setLaneDialogOpen(false)}>
        <AlignmentGrid value={2} onChange={addLane} />
      </Dialog>
      <Dialog open={Boolean(styleLane)} title={tr("sub.subtitleStyleTitle")} className="subtitle-style-dialog" onClose={() => setStyleLaneId(null)}>
        {styleLane ? (
          <ScrollArea
            className="subtitle-style-scroll"
            viewportClassName="subtitle-style-scroll-viewport"
            scrollbars={["vertical"]}
            type="always"
          >
            <SubtitleStyleEditor
              style={styleLane.style}
              effect={styleLane.effect}
              fonts={systemFonts}
              fontListError={fontListError}
              onChange={(style) => updateLane(styleLane.id, { ...styleLane, style })}
              onEffectChange={(effect) => updateLane(styleLane.id, { ...styleLane, effect })}
            />
          </ScrollArea>
        ) : null}
      </Dialog>
    </>
  );
}


/** `SubtitleOverlay`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function SubtitleOverlay(props: {
  state: SubtitleProjectState;
  currentTime: number;
  videoWidth: number;
  videoHeight: number;
}) {
  const catalogState = useSubtitleEffectCatalogContext();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const container = overlayRef.current?.parentElement;
    if (!container) return;
    const update = () =>
      setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const sourceWidth = Math.max(1, props.videoWidth);
  const sourceHeight = Math.max(1, props.videoHeight);
  const scale =
    containerSize.width > 0 && containerSize.height > 0
      ? Math.min(containerSize.width / sourceWidth, containerSize.height / sourceHeight)
      : 0;
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  const catalog = catalogState.catalog;
  const active = catalog
    ? activeSegmentsAt(props.state.lanes, props.currentTime)
    : [];
  return (
    <div
      ref={overlayRef}
      className="subtitle-overlay"
      aria-live="off"
      style={{
        left: (containerSize.width - displayWidth) / 2,
        top: (containerSize.height - displayHeight) / 2,
        right: "auto",
        bottom: "auto",
        width: displayWidth,
        height: displayHeight,
        visibility: scale > 0 ? "visible" : "hidden",
      }}
    >
      {active.map(({ lane, segment }) => {
        if (!catalog || !segment.render_cache) return null;
        const resolved = tryResolveSubtitleSegmentStyle(lane, segment, catalog);
        if (!resolved) return null;
        return segment.render_cache.signature === subtitleRenderSignature(
          segment.text,
          resolved.style,
          sourceWidth,
          sourceHeight,
        ) ? (
          <img
            key={segment.id}
            className="subtitle-overlay-image"
            src={`data:image/png;base64,${segment.render_cache.png_base64}`}
            alt=""
            draggable={false}
          />
        ) : null;
      })}
    </div>
  );
}

/** `tryResolveSubtitleSegmentStyle`で不正なproject effectを表示用に明示的に除外する。 */
function tryResolveSubtitleSegmentStyle(
  lane: Parameters<typeof resolveSubtitleSegmentStyle>[0],
  segment: Parameters<typeof resolveSubtitleSegmentStyle>[1],
  catalog: SubtitleEffectCatalog,
) {
  try {
    return resolveSubtitleSegmentStyle(lane, segment, catalog);
  } catch {
    // The owning state remains untouched so the caller can report the invalid
    // stable ID/parameter instead of silently changing it to `cut`.
    return null;
  }
}

/** `findSubtitleEffectError`でcatalog検証に失敗したstable IDまたはparameterを報告する。 */
function findSubtitleEffectError(state: SubtitleProjectState, catalog: SubtitleEffectCatalog) {
  for (const lane of state.lanes) {
    try {
      normalizeSubtitleEffect(lane.effect, catalog);
    } catch (error) {
      return String(error);
    }
    for (const segment of lane.segments) {
      if (!segment.effect_override) continue;
      try {
        normalizeSubtitleEffect(segment.effect_override, catalog);
      } catch (error) {
        return String(error);
      }
    }
  }
  return null;
}

/** `SubtitleEffectCatalogStatus`の取得中／失敗／準備完了を表示する。 */
function SubtitleEffectCatalogStatus(props: { state: SubtitleEffectCatalogState }) {
  if (props.state.status === "ready") return <span role="status">{tr("status.ready")}</span>;
  if (props.state.status === "error") {
    return <span role="alert" className="warning-text">{tr("status.failedWithError", { error: props.state.error })}</span>;
  }
  return <span role="status" className="warning-text">{tr("status.loading")}</span>;
}

/** `hasSubtitleSegments`の入力が要求された条件やschemaを満たすか検証する。 */
function hasSubtitleSegments(state: SubtitleProjectState) {
  return state.lanes.some((lane) => lane.segments.length > 0);
}
